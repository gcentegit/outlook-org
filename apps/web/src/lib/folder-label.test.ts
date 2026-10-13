import { describe, expect, it } from 'vitest';

import { folderLabel } from './folder-label';

describe('folderLabel', () => {
  it('en los árboles de las sociedades muestra la ruta sin la Bandeja de entrada', () => {
    expect(folderLabel('foodbox', 'Bandeja de entrada/Foodbox/2026/Octubre')).toBe(
      'Archivado en Foodbox / 2026 / Octubre',
    );
    expect(folderLabel('lateral', 'Bandeja de entrada/Lateral')).toBe('Archivado en Lateral');
  });

  it('sin ruta guardada (comprobado antes de guardarla) dice solo el árbol', () => {
    expect(folderLabel('foodbox', null)).toBe('Archivado en Foodbox');
  });

  it('en otra carpeta dice cuál, y avisa de los borrados y de los que faltan por comprobar', () => {
    expect(folderLabel('other', 'Elementos eliminados')).toBe(
      'En otra carpeta: Elementos eliminados',
    );
    expect(folderLabel('other', null)).toBe('En otra carpeta');
    expect(folderLabel('inbox', 'Bandeja de entrada')).toBe('En la Bandeja de entrada');
    expect(folderLabel('missing', null)).toBe('Ya no está en el buzón (borrado)');
    expect(folderLabel(null, null)).toBe('Carpeta sin comprobar');
  });
});
