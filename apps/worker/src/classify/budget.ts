import type { PrismaClient } from '@clasificador/db';

import type { LlmClassifier } from './llm';

/** Texto del motivo; el panel lo reconoce para avisar del tope (`reprocessCause`). */
export const DAILY_BUDGET_REASON = 'tope de gasto diario del LLM superado';

/** Gasto en USD del LLM desde las 00:00 de hoy (hora de Madrid). */
export type DailySpend = () => Promise<number>;

/**
 * Limita el gasto diario: superado el tope no se llama al LLM y el correo queda en duda. Se
 * devuelve `unavailable` (como si no hubiera modelo) para que la decisión salga marcada para
 * reprocesar: al día siguiente, o al subir el tope, «Reprocesar» la vuelve a decidir con el LLM.
 */
export function withDailyBudget(
  llm: LlmClassifier,
  limitUsd: number,
  spentToday: DailySpend,
): LlmClassifier {
  return async (email, categories) => {
    if ((await spentToday()) >= limitUsd) {
      return { status: 'unavailable', reason: DAILY_BUDGET_REASON };
    }
    return llm(email, categories);
  };
}

/** Suma `costUsd` de las decisiones de hoy. El límite del día lo calcula PostgreSQL en hora de Madrid. */
export function createPrismaDailySpend(db: Pick<PrismaClient, '$queryRaw'>): DailySpend {
  return async () => {
    const rows = await db.$queryRaw<{ spent: number }[]>`
      SELECT COALESCE(SUM("costUsd"), 0)::float8 AS spent
      FROM "Decision"
      WHERE "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')`;
    return rows[0]?.spent ?? 0;
  };
}
