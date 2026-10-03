import { describe, expect, it } from 'vitest';

import { formatReport, summarizeRun } from './evaluation';
import type { ClassifyResult } from './index';

function result(
  categories: Array<'FOOD BOX' | 'LATERAL' | 'ARCOBETA'>,
  extra: Partial<ClassifyResult> = {},
): ClassifyResult {
  return {
    decision: {
      messageId: 'm',
      categories,
      source: 'rule',
      ruleId: 'r',
      model: null,
      confidence: 1,
      needsReview: false,
      reason: 'x',
      mode: 'shadow',
    },
    usage: null,
    latencyMs: null,
    llmCalled: false,
    degraded: null,
    ...extra,
  };
}

describe('summarizeRun', () => {
  it('calcula la matriz de confusión, precisión y cobertura por categoría', () => {
    const cases = [
      { expected: ['LATERAL'] },
      { expected: ['LATERAL', 'FOOD BOX'] },
      { expected: [] },
      { expected: ['lateral'] },
    ];
    const results = [
      result(['LATERAL']), // TP
      result(['LATERAL']), // LATERAL TP, FOOD BOX FN
      result(['LATERAL']), // FP
      result([]), // FN (el esperado se compara sin distinguir mayúsculas)
    ];
    const s = summarizeRun('prueba', cases, results);
    expect(s.perCategory.LATERAL).toMatchObject({ tp: 2, fp: 1, fn: 1, tn: 0 });
    expect(s.perCategory.LATERAL.precision).toBeCloseTo(2 / 3);
    expect(s.perCategory.LATERAL.recall).toBeCloseTo(2 / 3);
    expect(s.perCategory['FOOD BOX']).toMatchObject({
      tp: 0,
      fp: 0,
      fn: 1,
      tn: 3,
      precision: null,
      recall: 0,
    });
    expect(s.perCategory.ARCOBETA).toMatchObject({
      tp: 0,
      fn: 0,
      tn: 4,
      precision: null,
      recall: null,
    });
  });

  it('suma llamadas al LLM, revisiones, tokens y coste', () => {
    const llm = { llmCalled: true, usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.002 } };
    const s = summarizeRun(
      'x',
      [{ expected: [] }, { expected: [] }],
      [result([], llm), result([], llm)],
    );
    expect(s).toMatchObject({ llmCalls: 2, inputTokens: 200, outputTokens: 20 });
    expect(s.costUsd).toBeCloseTo(0.004);
  });

  it('rechaza longitudes distintas', () => {
    expect(() => summarizeRun('x', [{ expected: [] }], [])).toThrow();
  });
});

describe('formatReport', () => {
  it('escribe una sección por pasada con las tres categorías', () => {
    const s = summarizeRun('Solo reglas', [{ expected: ['LATERAL'] }], [result(['LATERAL'])]);
    const text = formatReport([s]);
    expect(text).toContain('## Solo reglas');
    expect(text).toContain('| LATERAL | 100.0 % | 100.0 % | 1 | 0 | 0 | 0 |');
    expect(text).toContain('| ARCOBETA | n/d | n/d |');
  });
});
