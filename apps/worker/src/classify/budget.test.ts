import { describe, expect, it, vi } from 'vitest';

import { DAILY_BUDGET_REASON, withDailyBudget } from './budget';
import { classify, type LlmClassifier, type LlmOutcome } from './index';
import { makeEmail } from './test-fixtures';

const ok: LlmOutcome = {
  status: 'ok',
  model: 'modelo-x',
  verdicts: { 'FOOD BOX': { applies: true, confidence: 0.95, reason: 'porque sí' } },
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
  latencyMs: 100,
};

const email = makeEmail({});

describe('withDailyBudget', () => {
  it('bajo el tope llama al LLM', async () => {
    const llm = vi.fn<LlmClassifier>().mockResolvedValue(ok);
    const result = await withDailyBudget(llm, 1, async () => 0.5)(email, ['FOOD BOX']);
    expect(result).toBe(ok);
    expect(llm).toHaveBeenCalledOnce();
  });

  it('con el tope alcanzado no llama al LLM y lo declara no disponible', async () => {
    const llm = vi.fn<LlmClassifier>().mockResolvedValue(ok);
    const result = await withDailyBudget(llm, 1, async () => 1)(email, ['FOOD BOX']);
    expect(result).toEqual({ status: 'unavailable', reason: DAILY_BUDGET_REASON });
    expect(llm).not.toHaveBeenCalled();
  });

  it('el correo queda en duda, degradado y con el motivo en la decisión', async () => {
    const llm = vi.fn<LlmClassifier>().mockResolvedValue(ok);
    const result = await classify(email, {
      availableCategories: ['FOOD BOX', 'LATERAL', 'ARCOBETA'],
      mode: 'shadow',
      rules: { listActiveRules: async () => [] },
      threads: { findThreadCategories: async () => [] },
      llm: withDailyBudget(llm, 1, async () => 2),
    });
    expect(llm).not.toHaveBeenCalled();
    expect(result.decision.needsReview).toBe(true);
    expect(result.decision.categories).toEqual([]);
    expect(result.decision.reason).toContain(DAILY_BUDGET_REASON);
    expect(result.degraded?.reason).toContain(DAILY_BUDGET_REASON);
  });
});
