import type { PrismaClient } from '@clasificador/db';

import type { NewRule } from '@/lib/rule-form';

export interface RuleRow {
  id: string;
  type: 'cif' | 'razon_social' | 'remitente' | 'dominio' | 'palabra_clave';
  value: string;
  category: string;
  weight: 'fuerte' | 'medio';
  active: boolean;
  /** Quién la cambió por última vez desde el panel (null: semilla o cambio anterior al registro). */
  updatedBy: string | null;
  updatedAt: Date;
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
      select: {
        id: true,
        type: true,
        value: true,
        category: true,
        weight: true,
        active: true,
        updatedBy: true,
        updatedAt: true,
      },
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

export type RuleChange = { ok: true } | { ok: false; message: string };
export type RuleCreation = { ok: true; id: string } | { ok: false; message: string };

/**
 * Da de alta una regla activa. Si ya existe la misma (tipo, valor y categoría) no se duplica: se
 * avisa y, si estaba desactivada, se indica que basta con activarla. El worker la aplica desde el
 * siguiente correo que clasifique; los ya decididos no cambian.
 */
export async function createRule(
  db: Pick<PrismaClient, 'rule'>,
  rule: NewRule,
  by: string,
): Promise<RuleCreation> {
  const existing = await db.rule.findUnique({
    where: {
      type_value_category: { type: rule.type, value: rule.value, category: rule.category },
    },
    select: { active: true },
  });
  if (existing) {
    return {
      ok: false,
      message: existing.active
        ? 'Esa regla ya existe.'
        : 'Esa regla ya existe, desactivada. Actívala en la tabla.',
    };
  }
  const { id } = await db.rule.create({
    data: { ...rule, active: true, createdBy: by, updatedBy: by },
    select: { id: true },
  });
  return { ok: true, id };
}

/** Activa o desactiva una regla. El worker lo tiene en cuenta desde el siguiente correo. */
export async function setRuleActive(
  db: Pick<PrismaClient, 'rule'>,
  id: string,
  active: boolean,
  by: string,
): Promise<RuleChange> {
  const { count } = await db.rule.updateMany({ where: { id }, data: { active, updatedBy: by } });
  return count === 0
    ? { ok: false, message: 'La regla ya no existe. Recarga la página.' }
    : { ok: true };
}
