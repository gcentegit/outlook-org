import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { createLlmClassifier, type LlmSettingRecord } from './llm';
import { ProviderUnavailableError } from './providers';
import { makeAttachment, makeEmail } from './test-fixtures';

const setting: LlmSettingRecord = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };

function mockModel(text: string | (() => never), usage = { input: 120, output: 30 }) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (typeof text === 'function') text();
      return {
        content: [{ type: 'text' as const, text: text as string }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

function classifierWith(model: MockLanguageModelV4, active: LlmSettingRecord | null = setting) {
  const getActive = vi.fn().mockResolvedValue(active);
  const createModel = vi.fn().mockReturnValue(model);
  const llm = createLlmClassifier({ settings: { getActive }, keys: {}, createModel });
  return { llm, getActive, createModel };
}

const email = makeEmail({
  subject: 'Factura',
  bodyText: 'texto',
  attachments: [makeAttachment('Cliente X')],
});

describe('createLlmClassifier', () => {
  it('devuelve el veredicto por categoría y los tokens con coste estimado', async () => {
    const model = mockModel(
      JSON.stringify({
        categories: [
          { category: 'LATERAL', applies: true, confidence: 0.93, reason: 'Lateral Iberia' },
          { category: 'FOOD BOX', applies: false, confidence: 0.9, reason: 'otra sociedad' },
        ],
      }),
    );
    const { llm, createModel } = classifierWith(model);

    const out = await llm(email, ['FOOD BOX', 'LATERAL']);

    expect(createModel).toHaveBeenCalledWith(setting, {});
    expect(out).toEqual({
      status: 'ok',
      latencyMs: expect.any(Number),
      model: 'claude-haiku-4-5-20251001',
      verdicts: {
        LATERAL: { applies: true, confidence: 0.93, reason: 'Lateral Iberia' },
        'FOOD BOX': { applies: false, confidence: 0.9, reason: 'otra sociedad' },
      },
      usage: { inputTokens: 120, outputTokens: 30, costUsd: (120 * 1 + 30 * 5) / 1_000_000 },
    });
  });

  it('envía asunto, cuerpo y adjuntos al modelo, y pide las categorías dudosas', async () => {
    const model = mockModel(JSON.stringify({ categories: [] }));
    const { llm } = classifierWith(model);
    await llm(email, ['ARCOBETA']);
    const call = model.doGenerateCalls[0];
    const sent = JSON.stringify(call?.prompt);
    expect(sent).toContain('Factura');
    expect(sent).toContain('Cliente X');
    expect(sent).toContain('ARCOBETA');
  });

  it('descarta categorías no pedidas y repeticiones', async () => {
    const model = mockModel(
      JSON.stringify({
        categories: [
          { category: 'LATERAL', applies: true, confidence: 0.9, reason: 'a' },
          { category: 'LATERAL', applies: false, confidence: 0.9, reason: 'b' },
          { category: 'ARCOBETA', applies: true, confidence: 0.99, reason: 'no pedida' },
        ],
      }),
    );
    const out = await classifierWith(model).llm(email, ['LATERAL']);
    expect(out).toMatchObject({ status: 'ok', verdicts: { LATERAL: { reason: 'a' } } });
    expect(out.status === 'ok' && out.verdicts.ARCOBETA).toBeFalsy();
  });

  it('lee el modelo activo en cada llamada', async () => {
    const model = mockModel(JSON.stringify({ categories: [] }));
    const { llm, getActive } = classifierWith(model);
    await llm(email, ['LATERAL']);
    await llm(email, ['LATERAL']);
    expect(getActive).toHaveBeenCalledTimes(2);
  });

  it('respuesta que no es JSON: failed con tokens registrados', async () => {
    const out = await classifierWith(mockModel('no sé qué decir')).llm(email, ['LATERAL']);
    expect(out.status).toBe('failed');
    expect(out).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 120 },
      latencyMs: expect.any(Number),
    });
  });

  it('esquema inválido (categoría inventada): failed', async () => {
    const out = await classifierWith(
      mockModel(
        JSON.stringify({
          categories: [{ category: 'ALQUILERES', applies: true, confidence: 1, reason: 'x' }],
        }),
      ),
    ).llm(email, ['LATERAL']);
    expect(out.status).toBe('failed');
  });

  it('confianza fuera de rango: failed, no se inventa', async () => {
    const out = await classifierWith(
      mockModel(
        JSON.stringify({
          categories: [{ category: 'LATERAL', applies: true, confidence: 7, reason: 'x' }],
        }),
      ),
    ).llm(email, ['LATERAL']);
    expect(out).toMatchObject({ status: 'failed' });
    expect(out.status === 'failed' && out.reason).toContain('fuera de esquema');
  });

  it('error del proveedor o cuota agotada: failed, sin lanzar', async () => {
    const model = mockModel(() => {
      throw new Error('429 quota exceeded');
    });
    const out = await classifierWith(model).llm(email, ['LATERAL']);
    expect(out.status).toBe('failed');
    expect(out.status === 'failed' && out.reason).toContain('quota');
  });

  it('tiempo agotado: failed', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: (options) =>
        new Promise((_, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
        }),
    });
    const llm = createLlmClassifier({
      settings: { getActive: async () => setting },
      keys: {},
      createModel: () => model,
      timeoutMs: 20,
    });
    const out = await llm(email, ['LATERAL']);
    expect(out.status).toBe('failed');
  });

  it('sin modelo activo: unavailable y no se crea ningún modelo', async () => {
    const { llm, createModel } = classifierWith(mockModel('{}'), null);
    expect(await llm(email, ['LATERAL'])).toEqual({
      status: 'unavailable',
      reason: 'no hay modelo de LLM activo',
    });
    expect(createModel).not.toHaveBeenCalled();
  });

  it('proveedor sin clave: unavailable', async () => {
    const llm = createLlmClassifier({
      settings: { getActive: async () => setting },
      keys: {},
    });
    const out = await llm(email, ['LATERAL']);
    expect(out).toMatchObject({ status: 'unavailable' });
    expect(out.status === 'unavailable' && out.reason).toContain('ANTHROPIC_API_KEY');
  });

  it('un fallo inesperado al crear el modelo es failed, no unavailable', async () => {
    const llm = createLlmClassifier({
      settings: { getActive: async () => setting },
      keys: {},
      createModel: () => {
        throw new Error('boom');
      },
    });
    expect((await llm(email, ['LATERAL'])).status).toBe('failed');
  });

  it('ProviderUnavailableError desde una fábrica propia es unavailable', async () => {
    const llm = createLlmClassifier({
      settings: { getActive: async () => setting },
      keys: {},
      createModel: () => {
        throw new ProviderUnavailableError('sin clave');
      },
    });
    expect(await llm(email, ['LATERAL'])).toEqual({ status: 'unavailable', reason: 'sin clave' });
  });
});
