import type { MessageFolder } from '@clasificador/shared';

const readable = (segments: readonly string[]): string => segments.join(' / ');

/**
 * Dónde está un correo, para la columna «Equipo». Los árboles de las sociedades cuelgan de la
 * Bandeja de entrada, así que de su ruta se quita el primer tramo: «Archivado en Foodbox / 2026».
 */
export function folderLabel(folder: MessageFolder | null, path: string | null): string {
  const segments = path?.split('/').filter(Boolean) ?? [];
  switch (folder) {
    case 'foodbox':
    case 'lateral':
      return segments.length > 1
        ? `Archivado en ${readable(segments.slice(1))}`
        : `Archivado en ${folder === 'foodbox' ? 'Foodbox' : 'Lateral'}`;
    case 'other':
      return segments.length > 0 ? `En otra carpeta: ${readable(segments)}` : 'En otra carpeta';
    case 'inbox':
      return 'En la Bandeja de entrada';
    case 'missing':
      return 'Ya no está en el buzón (borrado)';
    default:
      return 'Carpeta sin comprobar';
  }
}
