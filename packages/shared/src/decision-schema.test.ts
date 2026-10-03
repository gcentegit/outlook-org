import { describe, expect, it } from 'vitest';

import { decisionSchema } from './decision-schema';

const base = {
  messageId: 'AAMk1',
  categories: ['LATERAL'],
  source: 'rule',
  ruleId: 'cif-b85275279',
  model: null,
  confidence: 0.98,
  needsReview: false,
  reason: 'CIF de LATERAL SANTA ANA en la factura',
  mode: 'shadow',
};

describe('decisionSchema', () => {
  it('acepta una decisión de regla válida', () => {
    expect(decisionSchema.parse(base).categories).toEqual(['LATERAL']);
  });

  it('acepta varias categorías y un correo dudoso sin categoría', () => {
    expect(
      decisionSchema.safeParse({ ...base, categories: ['FOOD BOX', 'ARCOBETA'] }).success,
    ).toBe(true);
    expect(
      decisionSchema.safeParse({ ...base, categories: [], needsReview: true, confidence: 0.4 })
        .success,
    ).toBe(true);
  });

  it('rechaza categorías fuera de FOOD BOX, LATERAL y ARCOBETA', () => {
    expect(decisionSchema.safeParse({ ...base, categories: ['ACTIVO'] }).success).toBe(false);
  });

  it('rechaza categorías repetidas', () => {
    expect(decisionSchema.safeParse({ ...base, categories: ['LATERAL', 'LATERAL'] }).success).toBe(
      false,
    );
  });

  it('exige ruleId si la fuente es una regla y model si es el LLM', () => {
    expect(decisionSchema.safeParse({ ...base, ruleId: null }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...base, source: 'llm', ruleId: null }).success).toBe(false);
    expect(
      decisionSchema.safeParse({
        ...base,
        source: 'llm',
        ruleId: null,
        model: 'claude-haiku-4-5-20251001',
      }).success,
    ).toBe(true);
  });

  it('la fuente none no lleva ruleId ni model', () => {
    const none = { ...base, source: 'none', ruleId: null, model: null, needsReview: true };
    expect(decisionSchema.safeParse(none).success).toBe(true);
    expect(decisionSchema.safeParse({ ...none, ruleId: 'x' }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...none, model: 'm' }).success).toBe(false);
  });

  it('rechaza una confianza fuera de [0, 1]', () => {
    expect(decisionSchema.safeParse({ ...base, confidence: 1.2 }).success).toBe(false);
  });
});
