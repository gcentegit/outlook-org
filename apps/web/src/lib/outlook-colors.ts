/**
 * Colores preestablecidos de las categorías de Outlook (`preset0`-`preset24`). El hexadecimal es
 * una aproximación para pintar la muestra: Outlook usa su propia paleta según el cliente.
 */
export const OUTLOOK_COLORS: readonly { preset: string; name: string; hex: string }[] = [
  { preset: 'preset0', name: 'Rojo', hex: '#e7a1a2' },
  { preset: 'preset1', name: 'Naranja', hex: '#f9ba89' },
  { preset: 'preset2', name: 'Marrón', hex: '#f7dd8f' },
  { preset: 'preset3', name: 'Amarillo', hex: '#fcfa90' },
  { preset: 'preset4', name: 'Verde', hex: '#78d168' },
  { preset: 'preset5', name: 'Verde azulado', hex: '#9fdcc9' },
  { preset: 'preset6', name: 'Oliva', hex: '#c6d2b0' },
  { preset: 'preset7', name: 'Azul', hex: '#9db7e8' },
  { preset: 'preset8', name: 'Morado', hex: '#b5a1e2' },
  { preset: 'preset9', name: 'Arándano', hex: '#daaec2' },
  { preset: 'preset10', name: 'Acero', hex: '#dad9dc' },
  { preset: 'preset11', name: 'Acero oscuro', hex: '#6b7994' },
  { preset: 'preset12', name: 'Gris', hex: '#bfbfbf' },
  { preset: 'preset13', name: 'Gris oscuro', hex: '#6f6f6f' },
  { preset: 'preset14', name: 'Negro', hex: '#4f4f4f' },
  { preset: 'preset15', name: 'Rojo oscuro', hex: '#c11a25' },
  { preset: 'preset16', name: 'Naranja oscuro', hex: '#e2620d' },
  { preset: 'preset17', name: 'Marrón oscuro', hex: '#c79c6e' },
  { preset: 'preset18', name: 'Amarillo oscuro', hex: '#b9b300' },
  { preset: 'preset19', name: 'Verde oscuro', hex: '#368f2b' },
  { preset: 'preset20', name: 'Verde azulado oscuro', hex: '#329b7a' },
  { preset: 'preset21', name: 'Oliva oscuro', hex: '#778b45' },
  { preset: 'preset22', name: 'Azul oscuro', hex: '#2858a5' },
  { preset: 'preset23', name: 'Morado oscuro', hex: '#5c2e91' },
  { preset: 'preset24', name: 'Arándano oscuro', hex: '#9c4e74' },
];

export function colorHex(preset: string): string | null {
  return OUTLOOK_COLORS.find((c) => c.preset === preset)?.hex ?? null;
}

export function colorName(preset: string): string {
  return OUTLOOK_COLORS.find((c) => c.preset === preset)?.name ?? 'Sin color';
}

export { newCategorySchema, type NewCategory } from '@clasificador/shared';
