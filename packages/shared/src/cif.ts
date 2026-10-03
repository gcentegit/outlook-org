/** Normaliza un CIF: mayúsculas y sin espacios, guiones ni puntos (p. ej. "b-85.554 921" → "B85554921"). */
export function normalizeCif(raw: string): string {
  return raw.replace(/[\s.-]/g, '').toUpperCase();
}
