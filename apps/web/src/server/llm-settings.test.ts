import { describe, expect, it, vi } from 'vitest';

import { llmSelectionSchema, privacyNotice } from '@/lib/llm-providers';

import { setActiveLlm } from './llm-settings';

function fakeDb() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    llmSetting: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)) };
  return { db, tx };
}

describe('setActiveLlm', () => {
  it('desactiva las demás y activa la elegida dentro de una transacción', async () => {
    const { db, tx } = fakeDb();
    // @ts-expect-error doble mínimo de PrismaClient
    await setActiveLlm(db, { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, 'a@b.es');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.llmSetting.updateMany).toHaveBeenCalledWith({
      where: {
        active: true,
        NOT: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      },
      data: { active: false, updatedBy: 'a@b.es' },
    });
    expect(tx.llmSetting.upsert).toHaveBeenCalledWith({
      where: { provider_model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
      create: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        active: true,
        updatedBy: 'a@b.es',
      },
      update: { active: true, updatedBy: 'a@b.es' },
    });
    // El bloqueo de la configuración se toma primero, y la desactivación va antes de la activación.
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.llmSetting.updateMany.mock.invocationCallOrder[0] as number,
    );
    expect(tx.llmSetting.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.llmSetting.upsert.mock.invocationCallOrder[0] as number,
    );
  });

  it('si la transacción falla propaga el error', async () => {
    const db = { $transaction: vi.fn().mockRejectedValue(new Error('boom')) };
    await expect(setActiveLlm(db, { provider: 'google', model: 'x' }, 'a@b.es')).rejects.toThrow(
      'boom',
    );
  });
});

describe('llmSelectionSchema', () => {
  it('acepta un proveedor conocido y recorta el modelo', () => {
    expect(
      llmSelectionSchema.parse({ provider: 'openrouter', model: '  anthropic/claude-haiku-4.5 ' }),
    ).toEqual({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
  });

  it('rechaza proveedores desconocidos, modelos vacíos y caracteres raros', () => {
    expect(llmSelectionSchema.safeParse({ provider: 'otro', model: 'x' }).success).toBe(false);
    expect(llmSelectionSchema.safeParse({ provider: 'google', model: ' ' }).success).toBe(false);
    expect(llmSelectionSchema.safeParse({ provider: 'google', model: 'a b; rm' }).success).toBe(
      false,
    );
  });
});

describe('privacyNotice', () => {
  it('avisa de no-entrenar y ZDR para OpenRouter y de los modelos gratuitos', () => {
    const notice = privacyNotice('openrouter', 'meta/llama:free');
    expect(notice?.level).toBe('warning');
    expect(notice?.text).toMatch(/no-entrenar y ZDR/);
    expect(notice?.text).toMatch(/gratuitos/);
  });

  it('avisa en Gemini y en proveedores compatibles, e informa en Anthropic', () => {
    expect(privacyNotice('google', 'gemini-2.5-flash')?.level).toBe('warning');
    expect(privacyNotice('openai-compatible', 'llama3.1:8b')?.level).toBe('warning');
    expect(privacyNotice('anthropic', 'claude-haiku-4-5-20251001')?.level).toBe('info');
    expect(privacyNotice('desconocido', 'x')).toBeNull();
  });
});
