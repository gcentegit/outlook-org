import { z } from 'zod';

import type { Category } from './categories';

/**
 * Dónde está un correo en el buzón, comprobado por el worker:
 * - `inbox`: sigue en la Bandeja de entrada (el equipo aún no lo ha archivado).
 * - `foodbox` / `lateral`: archivado en el árbol de carpetas de esa sociedad (subcarpetas incluidas).
 * - `other`: en cualquier otra carpeta (Elementos eliminados, Archivo...).
 * - `missing`: ya no está en el buzón.
 */
export const MESSAGE_FOLDERS = ['inbox', 'foodbox', 'lateral', 'other', 'missing'] as const;

export type MessageFolder = (typeof MESSAGE_FOLDERS)[number];

/**
 * Árboles de carpetas que cuelgan de la Bandeja de entrada y dónde archiva el equipo cada sociedad.
 * Archivar ahí es la verdad del equipo para esa categoría. ARCOBETA no tiene árbol propio: se
 * archiva en Lateral, así que la carpeta no dice nada de ella.
 */
export const TREE_FOLDERS = [
  { folder: 'foodbox', name: 'Foodbox', category: 'FOOD BOX' },
  { folder: 'lateral', name: 'Lateral', category: 'LATERAL' },
] as const satisfies readonly { folder: MessageFolder; name: string; category: Category }[];

/** Categorías que la carpeta permite comparar: las que tienen árbol propio. */
export const FOLDER_CATEGORIES: readonly Category[] = TREE_FOLDERS.map((tree) => tree.category);

/** Categoría que representa la carpeta, o null si no es la de una sociedad. */
export function folderCategory(folder: MessageFolder | null): Category | null {
  return TREE_FOLDERS.find((tree) => tree.folder === folder)?.category ?? null;
}

/** El panel pide al worker que compruebe ya en qué carpeta está cada correo. */
export const CHECK_FOLDERS_QUEUE = 'check-folders';

/** Fila de `SyncState` con la fecha de la última comprobación de carpetas. */
export const FOLDERS_SYNC_ID = 'folders';

/** Resultado de una comprobación de carpetas. */
export const checkFoldersResultSchema = z.object({
  checked: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export type CheckFoldersResult = z.infer<typeof checkFoldersResultSchema>;
