import type { PrismaClient } from '@clasificador/db';
import type { ExtractedEmail, ReviewInboxWithRuleResult } from '@clasificador/shared';

import { evaluateRules, type RuleRecord } from '../classify/rules';

export interface ReviewInboxStore {
  /** La regla, si existe y está activa. */
  findActiveRule(ruleId: string): Promise<RuleRecord | null>;
  /**
   * Correos que siguen en la Bandeja de entrada (o aún sin comprobar su carpeta), ya decididos y
   * sin revisar por el equipo: sin corrección y sin categorías puestas por una persona (las que
   * escribió el servicio no cuentan). Ahí manda lo que puso el equipo.
   */
  listInboxCandidates(): Promise<string[]>;
  /** Marca el correo para reprocesar y lo deja pendiente: así se vuelve a decidir aunque ya tuviera decisión. */
  markForReprocess(messageId: string): Promise<void>;
}

export function createPrismaReviewInboxStore(
  db: Pick<PrismaClient, 'rule' | 'message'>,
): ReviewInboxStore {
  return {
    async findActiveRule(ruleId) {
      return db.rule.findFirst({
        where: { id: ruleId, active: true },
        select: { id: true, type: true, value: true, category: true, weight: true },
      });
    },
    async listInboxCandidates() {
      const rows = await db.message.findMany({
        where: {
          OR: [{ folder: 'inbox' }, { folder: null }],
          status: 'processed',
          corrections: { none: {} },
        },
        orderBy: { receivedAt: 'asc' },
        select: {
          id: true,
          seenCategories: true,
          appliedCategories: { select: { category: true } },
        },
      });
      return rows
        .filter((row) => {
          const applied = new Set(row.appliedCategories.map((a) => a.category));
          return row.seenCategories.every((name) => applied.has(name));
        })
        .map((row) => row.id);
    },
    async markForReprocess(messageId) {
      await db.message.update({
        where: { id: messageId },
        data: { needsReprocess: true, status: 'pending' },
      });
    },
  };
}

export interface ReviewInboxDeps {
  store: ReviewInboxStore;
  extract: (messageId: string) => Promise<ExtractedEmail>;
  enqueue: (messageId: string) => Promise<void>;
  internalDomains: readonly string[];
  signal?: AbortSignal;
  log?: (message: string) => void;
}

/**
 * Revisa la Bandeja de entrada con una regla: lee cada correo candidato y, si la regla coincide
 * con él, lo marca para reprocesar y lo encola. El reproceso decide con todas las reglas activas
 * (y el LLM si hace falta) y, en modo real, escribe como cualquier otro correo. Solo lee el buzón.
 * Un correo que no se puede leer se cuenta y se sigue con el siguiente.
 */
export async function reviewInboxWithRule(
  ruleId: string,
  deps: ReviewInboxDeps,
): Promise<ReviewInboxWithRuleResult> {
  const log = deps.log ?? console.log;
  const rule = await deps.store.findActiveRule(ruleId);
  if (!rule) return { status: 'rule-inactive', checked: 0, matched: 0, failed: 0 };

  const result: ReviewInboxWithRuleResult = { status: 'done', checked: 0, matched: 0, failed: 0 };
  for (const messageId of await deps.store.listInboxCandidates()) {
    if (deps.signal?.aborted) break;
    let email: ExtractedEmail;
    try {
      email = await deps.extract(messageId);
    } catch (err) {
      log(`revisión con la regla ${ruleId}: no se pudo leer ${messageId}: ${String(err)}`);
      result.failed++;
      continue;
    }
    result.checked++;
    const evidence = evaluateRules(email, [rule], { internalDomains: deps.internalDomains });
    const hits = Object.values(evidence).some((c) => c.strong.length + c.medium.length > 0);
    if (!hits) continue;
    await deps.store.markForReprocess(messageId);
    await deps.enqueue(messageId);
    result.matched++;
  }
  return result;
}
