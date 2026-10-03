import type { PrismaClient } from '@clasificador/db';
import { canonicalCategory } from '@clasificador/shared';

import type { LlmSettingRepository } from './llm';
import type { RuleRepository } from './rules';
import type { ThreadCategory, ThreadRepository } from './thread';

/** Parte del cliente de Prisma que usan estos repositorios (facilita probarlos con un doble). */
type Db = Pick<PrismaClient, 'rule' | 'message' | 'llmSetting'>;

export function createPrismaRuleRepository(db: Db): RuleRepository {
  return {
    async listActiveRules() {
      const rows = await db.rule.findMany({
        where: { active: true },
        select: { id: true, type: true, value: true, category: true, weight: true },
      });
      return rows;
    },
  };
}

/** Lo que se sabe de un correo del hilo para decidir qué categorías aporta. */
export interface ThreadMessageRow {
  id: string;
  seenCategories: string[];
  /** Última corrección del equipo (la más reciente), si hay alguna. */
  correction: { final: string[] } | null;
  /** Última decisión del clasificador, si hay alguna. */
  decision: { categories: string[] } | null;
}

/**
 * Categorías que un correo del hilo aporta a la herencia: las finales del equipo y, solo si
 * nadie lo ha revisado, lo que decidió el clasificador.
 *
 * - Revisado por el equipo = tiene una corrección o alguna categoría en Outlook. Entonces manda
 *   la última corrección (si no, las categorías vistas) y la decisión del clasificador se ignora,
 *   aunque el equipo la haya corregido o la haya dejado sin categorías.
 * - Sin revisar: la última decisión (no todas las que haya tenido el correo).
 */
export function threadCategoriesOf(row: ThreadMessageRow): ThreadCategory[] {
  const reviewed = row.correction !== null || row.seenCategories.length > 0;
  const names = reviewed
    ? (row.correction?.final ?? row.seenCategories)
    : (row.decision?.categories ?? []);
  const origin = reviewed ? 'team' : 'decision';
  const found: ThreadCategory[] = [];
  for (const name of names) {
    const category = canonicalCategory(name);
    if (category) found.push({ category, messageId: row.id, origin });
  }
  return found;
}

export function createPrismaThreadRepository(db: Db): ThreadRepository {
  return {
    async findThreadCategories(conversationId, excludeMessageId) {
      const messages = await db.message.findMany({
        where: { conversationId, id: { not: excludeMessageId } },
        select: {
          id: true,
          seenCategories: true,
          corrections: { orderBy: { createdAt: 'desc' }, take: 1, select: { final: true } },
          decisions: { orderBy: { createdAt: 'desc' }, take: 1, select: { categories: true } },
        },
      });
      return messages.flatMap((message) =>
        threadCategoriesOf({
          id: message.id,
          seenCategories: message.seenCategories,
          correction: message.corrections[0] ?? null,
          decision: message.decisions[0] ?? null,
        }),
      );
    },
  };
}

export function createPrismaLlmSettingRepository(db: Db): LlmSettingRepository {
  return {
    async getActive() {
      const row = await db.llmSetting.findFirst({
        where: { active: true },
        orderBy: { updatedAt: 'desc' },
        select: { provider: true, model: true },
      });
      return row;
    },
  };
}
