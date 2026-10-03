import { CATEGORIES, type Category } from '@clasificador/shared';

import type { ClassifyResult } from './index';

/** Caso etiquetado del conjunto de prueba: el correo y las categorías que debería tener. */
export interface EvalExpectation {
  expected: readonly string[];
}

export interface CategoryMetrics {
  /** Matriz de confusión de la categoría: propuesta/esperada. */
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** tp / (tp + fp); null si nunca se propuso. */
  precision: number | null;
  /** tp / (tp + fn); null si nunca se esperó. */
  recall: number | null;
}

export interface RunSummary {
  label: string;
  total: number;
  perCategory: Record<Category, CategoryMetrics>;
  needsReview: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/** Calcula precisión, cobertura y matriz de confusión por categoría de una pasada del evaluador. */
export function summarizeRun(
  label: string,
  cases: readonly EvalExpectation[],
  results: readonly ClassifyResult[],
): RunSummary {
  if (cases.length !== results.length) {
    throw new Error(`Casos (${cases.length}) y resultados (${results.length}) no coinciden`);
  }
  const counts = Object.fromEntries(
    CATEGORIES.map((c) => [c, { tp: 0, fp: 0, fn: 0, tn: 0 }]),
  ) as Record<Category, { tp: number; fp: number; fn: number; tn: number }>;
  const summary = { needsReview: 0, llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  cases.forEach((testCase, i) => {
    const result = results[i] as ClassifyResult;
    const expected = new Set(testCase.expected.map((e) => e.toLowerCase()));
    const predicted = new Set<string>(result.decision.categories);
    for (const category of CATEGORIES) {
      const should = expected.has(category.toLowerCase());
      const did = predicted.has(category);
      const cell = counts[category];
      if (did && should) cell.tp++;
      else if (did) cell.fp++;
      else if (should) cell.fn++;
      else cell.tn++;
    }
    if (result.decision.needsReview) summary.needsReview++;
    if (result.llmCalled) summary.llmCalls++;
    summary.inputTokens += result.usage?.inputTokens ?? 0;
    summary.outputTokens += result.usage?.outputTokens ?? 0;
    summary.costUsd += result.usage?.costUsd ?? 0;
  });

  const perCategory = Object.fromEntries(
    CATEGORIES.map((c) => {
      const { tp, fp, fn, tn } = counts[c];
      return [c, { tp, fp, fn, tn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) }];
    }),
  ) as Record<Category, CategoryMetrics>;

  return { label, total: cases.length, perCategory, ...summary };
}

const pct = (value: number | null): string =>
  value === null ? 'n/d' : `${(value * 100).toFixed(1)} %`;

/** Informe de texto con una sección por pasada (sin LLM, con cada modelo). */
export function formatReport(summaries: readonly RunSummary[]): string {
  const out: string[] = [];
  for (const s of summaries) {
    out.push(`## ${s.label}`);
    out.push(
      `Casos: ${s.total} | pasan por el LLM: ${s.llmCalls} (${pct(ratio(s.llmCalls, s.total))}) | ` +
        `en revisión: ${s.needsReview} (${pct(ratio(s.needsReview, s.total))})`,
    );
    out.push(
      `Tokens: ${s.inputTokens} entrada / ${s.outputTokens} salida | coste estimado: ${s.costUsd.toFixed(4)} USD`,
    );
    out.push('');
    out.push('| Categoría | Precisión | Cobertura | TP | FP | FN | TN |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const category of CATEGORIES) {
      const m = s.perCategory[category];
      out.push(
        `| ${category} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}
