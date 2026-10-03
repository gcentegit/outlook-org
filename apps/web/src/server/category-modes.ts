import type { PrismaClient } from '@clasificador/db';
import { CATEGORIES, type Category } from '@clasificador/shared';

/**
 * Modo sombra/live por categoría. Vive en la tabla `CategorySetting`. Se accede con SQL directo y,
 * si la tabla no existe (migración sin aplicar), `getCategoryModes` devuelve `available: false` y
 * la pantalla lo explica en vez de fallar.
 * Sin fila, una categoría está en modo sombra (el valor seguro).
 */

export type CategoryMode = 'shadow' | 'live';

export type CategoryModes =
  { available: true; modes: Record<Category, CategoryMode> } | { available: false };

type Db = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

/** Error de Postgres "relation does not exist" (42P01) tal como lo expone el adaptador de Prisma. */
function isMissingTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /CategorySetting/.test(error.message) &&
    /does not exist|42P01/.test(error.message)
  );
}

const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

export async function getCategoryModes(
  db: Pick<PrismaClient, '$queryRaw'>,
): Promise<CategoryModes> {
  try {
    const rows = await db.$queryRaw<{ category: string; mode: CategoryMode }[]>`
      SELECT "category", "mode"::text AS mode FROM "CategorySetting"`;
    const modes = Object.fromEntries(CATEGORIES.map((c) => [c, 'shadow'])) as Record<
      Category,
      CategoryMode
    >;
    for (const row of rows) if (isCategory(row.category)) modes[row.category] = row.mode;
    return { available: true, modes };
  } catch (error) {
    if (isMissingTable(error)) return { available: false };
    throw error;
  }
}

export async function setCategoryMode(
  db: Pick<Db, '$executeRaw'>,
  category: Category,
  mode: CategoryMode,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await db.$executeRaw`
      INSERT INTO "CategorySetting" ("category", "mode", "updatedAt", "updatedBy")
      VALUES (${category}, ${mode}::"DecisionMode", NOW(), ${updatedBy})
      ON CONFLICT ("category")
      DO UPDATE SET "mode" = EXCLUDED."mode", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"`;
    return { ok: true };
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        ok: false,
        message: 'Falta la tabla CategorySetting: aplica la migración pendiente.',
      };
    }
    throw error;
  }
}
