import { describe, expect, it } from 'vitest';

import { ProviderUnavailableError, createLanguageModel, estimateCostUsd } from './providers';

describe('createLanguageModel', () => {
  it('crea un modelo por proveedor cuando hay clave', () => {
    const keys = {
      ANTHROPIC_API_KEY: 'k1',
      OPENROUTER_API_KEY: 'k2',
      GOOGLE_GENERATIVE_AI_API_KEY: 'k3',
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
    };
    for (const [provider, model] of [
      ['anthropic', 'claude-haiku-4-5-20251001'],
      ['openrouter', 'meta-llama/llama-3.3-70b-instruct:free'],
      ['google', 'gemini-2.0-flash'],
      ['openai-compatible', 'llama3.2:3b'],
    ] as const) {
      const created = createLanguageModel({ provider, model }, keys);
      expect(created).toMatchObject({ modelId: model });
    }
  });

  it.each([
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY'],
    ['google', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    ['openai-compatible', 'OPENAI_COMPATIBLE_BASE_URL'],
  ])('%s sin %s lanza ProviderUnavailableError', (provider, variable) => {
    expect(() => createLanguageModel({ provider, model: 'm' }, {})).toThrow(
      ProviderUnavailableError,
    );
    expect(() =>
      createLanguageModel({ provider, model: 'm' }, { ANTHROPIC_API_KEY: '  ' }),
    ).toThrow(variable);
  });

  it('proveedor desconocido', () => {
    expect(() => createLanguageModel({ provider: 'otro', model: 'm' }, {})).toThrow(/desconocido/);
  });
});

describe('estimateCostUsd', () => {
  const base = { inputTokens: 1000, outputTokens: 200 };

  it('usa la tarifa de Haiku 4.5', () => {
    expect(
      estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', ...base }),
    ).toBeCloseTo(0.002, 6);
  });

  it('prefiere el coste que informa OpenRouter', () => {
    expect(
      estimateCostUsd({
        provider: 'openrouter',
        model: 'x',
        ...base,
        providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
      }),
    ).toBe(0.0042);
  });

  it('null si no hay tarifa ni dato del proveedor', () => {
    expect(
      estimateCostUsd({ provider: 'openai-compatible', model: 'llama3.2:3b', ...base }),
    ).toBeNull();
    expect(
      estimateCostUsd({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: null,
        outputTokens: 1,
      }),
    ).toBeNull();
  });
});
