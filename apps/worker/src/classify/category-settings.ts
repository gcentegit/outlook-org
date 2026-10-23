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
 * Modo que el panel ha fijado por categoría; sin fila la categoría está en sombra. Solo se escriben
 * en el buzón las que estén en live y con el worker en `MODE=live`.
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
 * Avisa de que hay categorías en live que un worker en sombra no aplica. Solo repite el aviso cuando cambia
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
        `El panel tiene en live: ${live.join(', ')}. Este worker está en sombra (MODE=shadow): ` +
          'se registran decisiones sin tocar el buzón.',
      );
    }
  };
}

/**
 * Categoría del buzón que el panel ha elegido para marcar los correos en los que escribe el
 * servicio, o `null` si no hay ninguna.
 */
export async function readServiceCategory(
  db: Pick<PrismaClient, 'serviceCategorySetting'>,
): Promise<string | null> {
  const row = await db.serviceCategorySetting.findUnique({
    where: { id: 'service' },
    select: { name: true },
  });
  return row?.name ?? null;
}

/**
 * Avisa de que la categoría elegida en el panel no se escribe: ya no está en la lista maestra del
 * buzón (no se crea) o es una de las del clasificador, que no sirven de marca. Solo una vez por
 * nombre, para no inundar el log con cada correo.
 */
export function createMissingServiceCategoryWarner(
  warn: (message: string) => void = console.warn,
): (name: string) => void {
  let last = '';
  return (name) => {
    if (name === last) return;
    last = name;
    warn(
      canonicalCategory(name)
        ? `La categoría del servicio «${name}» es una de las del clasificador y no sirve de marca: ` +
            'no se escribe. Elige otra en la página Categorías del panel.'
        : `La categoría del servicio «${name}» no está en la lista maestra del buzón: no se escribe.`,
    );
  };
}
