import type { PrismaClient } from '@clasificador/db';
import {
  CATEGORIES,
  canonicalCategory,
  type Category,
  type DecisionMode,
} from '@clasificador/shared';

type Db = Pick<PrismaClient, 'categorySetting'>;

export type CategoryModes = Record<Category, DecisionMode>;

/**
 * Modo que el panel ha fijado por categoría. Hoy el worker solo lo expone: sin fila la categoría
 * está en sombra, y aunque alguna figure en live el worker sigue en sombra hasta que exista la
 * activación real.
 */
export async function readCategoryModes(db: Db): Promise<CategoryModes> {
  const modes = Object.fromEntries(CATEGORIES.map((c) => [c, 'shadow'])) as CategoryModes;
  const rows = await db.categorySetting.findMany({ select: { category: true, mode: true } });
  for (const row of rows) {
    const category = canonicalCategory(row.category);
    if (category) modes[category] = row.mode;
  }
  return modes;
}

/** Categorías que el panel ha puesto en live. */
export const liveCategories = (modes: CategoryModes): Category[] =>
  CATEGORIES.filter((c) => modes[c] === 'live');

/**
 * Avisa de que hay categorías en live que el worker no aplica. Solo repite el aviso cuando cambia
 * el conjunto, para no inundar el log con cada correo.
 */
export function createLiveModeWarner(
  warn: (message: string) => void = console.warn,
): (modes: CategoryModes) => void {
  let last = '';
  return (modes) => {
    const live = liveCategories(modes);
    const key = live.join(',');
    if (key === last) return;
    last = key;
    if (live.length > 0) {
      warn(
        `El panel tiene en live: ${live.join(', ')}. Este worker solo funciona en sombra: ` +
          'se registran decisiones sin tocar el buzón.',
      );
    }
  };
}
