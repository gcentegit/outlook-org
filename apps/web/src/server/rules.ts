import type { PrismaClient } from '@clasificador/db';

export interface RuleRow {
  id: string;
  type: 'cif' | 'razon_social' | 'remitente' | 'dominio' | 'palabra_clave';
  value: string;
  category: string;
  weight: 'fuerte' | 'medio';
  active: boolean;
  /** Correos cuya decisión vigente (sin fallo técnico) salió de esta regla. */
  decided: number;
}

const TYPE_ORDER: Record<RuleRow['type'], number> = {
  cif: 0,
  razon_social: 1,
  remitente: 2,
  dominio: 3,
  palabra_clave: 4,
};

/**
 * Cuántos correos decidió cada regla: solo cuenta la decisión vigente de cada correo, si no tuvo un
 * fallo técnico y si su origen es una regla (`decision.ruleId`). Una decisión guarda una sola regla
 * aunque coincidan varias, así que es la regla que decidió, no todas las que coincidieron.
 */
export function countDecidedByRule(
  decisions: readonly {
    messageId: string;
    createdAt: Date;
    degraded: boolean;
    decision: unknown;
  }[],
): Map<string, number> {
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) {
    const current = latest.get(d.messageId);
    if (!current || d.createdAt > current.createdAt) latest.set(d.messageId, d);
  }
  const counts = new Map<string, number>();
  for (const d of latest.values()) {
    if (d.degraded) continue;
    const json = d.decision as { source?: unknown; ruleId?: unknown } | null;
    if (json?.source !== 'rule' || typeof json.ruleId !== 'string') continue;
    counts.set(json.ruleId, (counts.get(json.ruleId) ?? 0) + 1);
  }
  return counts;
}

/** Todas las reglas (activas o no), por categoría y tipo, con cuántos correos decidió cada una. */
export async function getRules(db: Pick<PrismaClient, 'rule' | 'decision'>): Promise<RuleRow[]> {
  const [rules, decisions] = await Promise.all([
    db.rule.findMany({
      select: { id: true, type: true, value: true, category: true, weight: true, active: true },
    }),
    db.decision.findMany({
      select: { messageId: true, createdAt: true, degraded: true, decision: true },
    }),
  ]);
  const counts = countDecidedByRule(decisions);
  return rules
    .map((rule) => ({ ...rule, decided: counts.get(rule.id) ?? 0 }))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
        a.value.localeCompare(b.value),
    );
}
