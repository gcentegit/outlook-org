/** Categorías que automatiza el clasificador (nombres tal cual figuran en la lista maestra del buzón). */
export const CATEGORIES = ['FOOD BOX', 'LATERAL', 'ARCOBETA'] as const;

export type Category = (typeof CATEGORIES)[number];

/** Nombre canónico de una de las tres categorías (Outlook no distingue mayúsculas), o null. */
export function canonicalCategory(name: string): Category | null {
  const wanted = name.trim().toLowerCase();
  return CATEGORIES.find((c) => c.toLowerCase() === wanted) ?? null;
}
