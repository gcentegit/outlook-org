import {
  CATEGORIES,
  canonicalCategory,
  decisionSchema,
  type Category,
  type Decision,
  type DecisionMode,
  type DecisionSource,
  type ExtractedEmail,
} from '@clasificador/shared';

import type { LlmClassifier, LlmOutcome, LlmUsage, LlmVerdict } from './llm';
import { evaluateRules, type RuleRepository } from './rules';
import { inheritFromThread, type ThreadRepository } from './thread';

export * from './category-settings';
export * from './default-rules';
export * from './evaluation';
export * from './llm';
export * from './prompt';
export * from './providers';
export * from './repositories';
export * from './rules';
export * from './thread';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Confianza fija de cada tipo de decisión sin LLM. */
export const RULE_CONFIDENCE = { strong: 1, medium: 0.9, thread: 0.95, excluded: 1 } as const;

export interface ClassifyContext {
  /** Lista maestra de categorías del buzón; solo se devuelven las que estén en ella. */
  availableCategories: readonly string[];
  mode: DecisionMode;
  rules: RuleRepository;
  threads: ThreadRepository;
  /** Sin él (o si no hay proveedor configurado) las categorías dudosas quedan en duda. */
  llm?: LlmClassifier | undefined;
  /** Por debajo de este valor una categoría no se propone y el correo queda en revisión. */
  confidenceThreshold?: number | undefined;
  /** Dominios del grupo: el pie de firma de un remitente interno no cuenta como regla fuerte. */
  internalDomains?: readonly string[] | undefined;
}

/** La decisión salió con un fallo técnico, no porque el correo sea dudoso. */
export interface DegradedReason {
  reason: string;
  /** `true`: puede arreglarse solo (red, cuota); `false`: hace falta actuar (clave, modelo activo). */
  transient: boolean;
}

export interface ClassifyResult {
  decision: Decision;
  /** Tokens y coste de la llamada al LLM; null si no hubo llamada o no hay datos. */
  usage: LlmUsage | null;
  /** Milisegundos de la llamada al LLM; null si no hubo llamada. */
  latencyMs: number | null;
  llmCalled: boolean;
  /** Presente si el LLM falló o no estaba disponible: las categorías en duda no son definitivas. */
  degraded: DegradedReason | null;
}

type Origin = 'thread' | 'strong' | 'medium' | 'llm' | 'excluded';

interface Verdict {
  answer: 'yes' | 'no' | 'doubt';
  confidence: number;
  origin: Origin | null;
  ruleId: string | null;
  note: string;
}

const doubt = (note: string, confidence = 0): Verdict => ({
  answer: 'doubt',
  confidence,
  origin: null,
  ruleId: null,
  note,
});

const SOURCE_PRIORITY: Record<Origin, number> = {
  strong: 4,
  thread: 3,
  medium: 2,
  excluded: 1,
  llm: 0,
};

function formatConfidence(value: number): string {
  return value.toFixed(2);
}

/**
 * Clasifica un correo en FOOD BOX, LATERAL y ARCOBETA. Cada categoría se decide por separado:
 * regla fuerte > herencia del hilo > regla media > LLM > duda. Una regla fuerte (CIF o razón social)
 * del propio correo gana a lo heredado del hilo, que además solo usa las categorías finales del
 * equipo. Solo propone: nunca quita las
 * categorías que ya tiene el correo (la fusión con las del equipo la hace quien aplica la decisión).
 *
 * Los fallos del LLM no lanzan: la categoría queda en duda. Los de la base de datos (reglas o
 * hilo) sí se propagan, para que el trabajo se reintente en lugar de decidir con datos incompletos.
 */
export async function classify(
  email: ExtractedEmail,
  ctx: ClassifyContext,
): Promise<ClassifyResult> {
  const threshold = ctx.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const available = new Set<Category>();
  for (const name of ctx.availableCategories) {
    const canonical = canonicalCategory(name);
    if (canonical) available.add(canonical);
  }
  const alreadyLabeled = new Set<Category>();
  for (const name of email.categories) {
    const canonical = canonicalCategory(name);
    if (canonical) alreadyLabeled.add(canonical);
  }

  const [threadCategories, rules] = await Promise.all([
    inheritFromThread(email, ctx.threads),
    ctx.rules.listActiveRules(),
  ]);
  const evidence = evaluateRules(email, rules, {
    internalDomains: ctx.internalDomains ?? [],
  });
  const billedCompanyFound = CATEGORIES.some((c) => evidence[c].strong.length > 0);

  // 1. Regla fuerte > hilo > regla media > duda, por categoría.
  const verdicts = new Map<Category, Verdict>();
  for (const category of CATEGORIES) {
    const inherited = threadCategories.get(category);
    const { strong, medium } = evidence[category];
    let verdict: Verdict;
    if (strong[0]) {
      verdict = {
        answer: 'yes',
        confidence: RULE_CONFIDENCE.strong,
        origin: 'strong',
        ruleId: strong[0].ruleId,
        note: `${category} por ${strong.map((h) => h.description).join(', ')}`,
      };
    } else if (billedCompanyFound) {
      // Hay una sociedad del grupo identificada y es de otra categoría: no se mira nada más.
      verdict = {
        answer: 'no',
        confidence: RULE_CONFIDENCE.excluded,
        origin: 'excluded',
        ruleId: null,
        note: `${category} descartada: el documento es de otra sociedad`,
      };
    } else if (inherited) {
      const who = inherited.origin === 'team' ? 'etiquetado por el equipo' : 'ya decidido';
      verdict = {
        answer: 'yes',
        confidence: RULE_CONFIDENCE.thread,
        origin: 'thread',
        ruleId: null,
        note: `${category} heredada del hilo (correo ${inherited.messageId} ${who})`,
      };
    } else if (medium[0]) {
      verdict = {
        answer: 'yes',
        confidence: RULE_CONFIDENCE.medium,
        origin: 'medium',
        ruleId: medium[0].ruleId,
        note: `${category} por ${medium.map((h) => h.description).join(', ')}`,
      };
    } else {
      verdict = doubt(`${category} sin coincidencias en las reglas`);
    }
    // Una respuesta por debajo del umbral no vale: pasa a duda (y puede llegar al LLM).
    if (verdict.answer !== 'doubt' && verdict.confidence < threshold) {
      verdict = doubt(
        `${category} con confianza ${formatConfidence(verdict.confidence)} < ${formatConfidence(threshold)}`,
        verdict.confidence,
      );
    }
    verdicts.set(category, verdict);
  }

  // 2. LLM solo para las categorías en duda que existen en el buzón y no puso ya el equipo.
  const needsLlm = (c: Category): boolean =>
    verdicts.get(c)?.answer === 'doubt' && available.has(c) && !alreadyLabeled.has(c);
  const toAsk = CATEGORIES.filter(needsLlm);

  let outcome: LlmOutcome | null = null;
  if (toAsk.length > 0 && ctx.llm) {
    outcome = await ctx.llm(email, toAsk);
  }
  const notes: string[] = [];
  let llmModel: string | null = null;
  let degraded: DegradedReason | null = null;

  if (outcome?.status === 'ok') {
    llmModel = outcome.model;
    for (const category of toAsk) {
      const v: LlmVerdict | undefined = outcome.verdicts[category];
      if (!v) {
        verdicts.set(category, doubt(`${category}: el LLM no respondió esta categoría`));
        continue;
      }
      if (v.confidence < threshold) {
        verdicts.set(
          category,
          doubt(
            `${category}: LLM con confianza ${formatConfidence(v.confidence)} < ${formatConfidence(threshold)}`,
            v.confidence,
          ),
        );
        continue;
      }
      verdicts.set(category, {
        answer: v.applies ? 'yes' : 'no',
        confidence: v.confidence,
        origin: 'llm',
        ruleId: null,
        note: `${category} ${v.applies ? 'sí' : 'no'} según el LLM (${formatConfidence(v.confidence)}): ${v.reason}`,
      });
    }
  } else if (outcome?.status === 'failed') {
    llmModel = outcome.model;
    notes.push(`LLM fallido (${outcome.reason}); categorías en duda`);
    degraded = { reason: `LLM fallido: ${outcome.reason}`, transient: true };
  } else if (outcome?.status === 'unavailable') {
    notes.push(`LLM no disponible (${outcome.reason}); categorías en duda`);
    degraded = { reason: `LLM no disponible: ${outcome.reason}`, transient: false };
  } else if (toAsk.length > 0) {
    notes.push('sin LLM configurado; categorías en duda');
  }

  // 3. Decisión final. Las categorías ausentes de la lista maestra no se devuelven, pero se anota.
  const categories: Category[] = [];
  const positives: Array<{ category: Category; verdict: Verdict }> = [];
  let needsReview = false;
  let minConfidence = 1;
  const excluded: Category[] = [];
  for (const category of CATEGORIES) {
    const v = verdicts.get(category) as Verdict;
    const labeled = alreadyLabeled.has(category);
    if (v.answer === 'yes') {
      if (available.has(category)) {
        categories.push(category);
        positives.push({ category, verdict: v });
        notes.push(v.note);
      } else {
        notes.push(`${v.note}; no existe en la lista maestra del buzón, no se propone`);
      }
    } else if (v.answer === 'no') {
      if (v.origin === 'excluded') excluded.push(category);
      else notes.push(v.note);
    } else if (available.has(category) && !labeled) {
      needsReview = true;
      notes.push(v.note);
    } else if (labeled) {
      notes.push(`${category} ya puesta por el equipo; se respeta`);
      continue;
    } else {
      continue;
    }
    if (available.has(category)) minConfidence = Math.min(minConfidence, v.confidence);
  }
  if (excluded.length > 0) {
    notes.push(`${excluded.join(', ')} descartada(s): el documento es de otra sociedad del grupo`);
  }
  if (available.size === 0)
    notes.push('ninguna de las categorías automatizadas existe en el buzón');

  // La fuente es la de mayor prioridad entre las categorías propuestas; el modelo se informa
  // siempre que se llamó al LLM, aunque la fuente sea otra.
  const best = positives.reduce<Verdict | null>(
    (acc, { verdict }) =>
      !acc || SOURCE_PRIORITY[verdict.origin as Origin] > SOURCE_PRIORITY[acc.origin as Origin]
        ? verdict
        : acc,
    null,
  );
  let source: DecisionSource;
  let ruleId: string | null = null;
  if (best?.origin === 'thread') {
    source = 'thread';
  } else if (best?.origin === 'strong' || best?.origin === 'medium') {
    source = 'rule';
    ruleId = best.ruleId;
  } else if (best?.origin === 'llm' || llmModel) {
    source = 'llm';
  } else {
    // Sin propuestas ni LLM: si una regla descartó categorías, es la que decide; si no, ninguna.
    const excludingRule = CATEGORIES.map((c) => evidence[c].strong[0]).find(Boolean);
    if (excludingRule) {
      source = 'rule';
      ruleId = excludingRule.ruleId;
    } else {
      source = 'none';
    }
  }

  const decision = decisionSchema.parse({
    messageId: email.messageId,
    categories,
    source,
    ruleId,
    model: llmModel,
    confidence: minConfidence,
    needsReview,
    reason: notes.length > 0 ? notes.join('; ') : 'sin categorías que decidir',
    mode: ctx.mode,
  });

  return {
    decision,
    usage: outcome && outcome.status !== 'unavailable' ? outcome.usage : null,
    latencyMs: outcome && outcome.status !== 'unavailable' ? outcome.latencyMs : null,
    llmCalled: outcome !== null && outcome.status !== 'unavailable',
    degraded,
  };
}
