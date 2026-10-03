import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { runTestClassify } from './test-classify';

const request = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  email: { subject: 'Factura', body: 'Cliente: LATERAL IBERIA, S.L. CIF B88300413' },
};

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: { total: 200, noCache: 200, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 40, text: 40, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const verdicts = JSON.stringify({
  categories: [
    { category: 'LATERAL', applies: true, confidence: 0.95, reason: 'Lateral Iberia' },
    { category: 'FOOD BOX', applies: false, confidence: 0.9, reason: 'otra sociedad' },
    { category: 'ARCOBETA', applies: false, confidence: 0.9, reason: 'otra sociedad' },
  ],
});

describe('runTestClassify', () => {
  it('usa el proveedor y modelo de la petición y envía el correo al LLM sin pasar por reglas', async () => {
    const createModel = vi.fn().mockReturnValue(mockModel(verdicts));
    const result = await runTestClassify(request, { keys: {}, createModel });

    expect(createModel).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      {},
    );
    expect(result.status).toBe('ok');
    expect(result.message).toBeNull();
    expect(result.decision).toMatchObject({
      categories: ['LATERAL'],
      source: 'llm',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 40 });
    expect(result.usage?.costUsd).toBeCloseTo((200 * 1 + 40 * 5) / 1_000_000);
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('sin la clave del proveedor devuelve unavailable con el motivo y sin llamar al modelo', async () => {
    const result = await runTestClassify(
      { ...request, provider: 'openrouter', model: 'a/b' },
      {
        keys: {},
      },
    );
    expect(result).toEqual({
      status: 'unavailable',
      message: 'Falta OPENROUTER_API_KEY para el proveedor openrouter',
      decision: null,
      usage: null,
      latencyMs: null,
    });
  });

  it('un modelo que responde basura devuelve failed con los tokens y la latencia', async () => {
    const createModel = vi.fn().mockReturnValue(mockModel('no es json'));
    const result = await runTestClassify(request, { keys: {}, createModel });
    expect(result.status).toBe('failed');
    expect(result.message).toBeTruthy();
    expect(result.decision).toBeNull();
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('rechaza una petición que no cumple el esquema', async () => {
    await expect(
      runTestClassify({ ...request, provider: 'desconocido' }, { keys: {} }),
    ).rejects.toThrow();
    await expect(
      runTestClassify({ ...request, email: { subject: '', body: '' } }, { keys: {} }),
    ).rejects.toThrow();
  });
});
