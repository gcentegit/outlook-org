import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SOCIEDADES, normalizeCif } from '@clasificador/shared';
import { describe, expect, it } from 'vitest';

describe('semilla de sociedades', () => {
  it('tiene los CIF ya normalizados y sin duplicados', () => {
    const cifs = SOCIEDADES.map((s) => s.cif);
    expect(cifs).toHaveLength(7);
    expect(new Set(cifs).size).toBe(7);
    for (const cif of cifs) expect(normalizeCif(cif)).toBe(cif);
  });

  it('coincide con la tabla de docs/referencia/sociedades-categorias.md', () => {
    const doc = readFileSync(
      resolve(import.meta.dirname, '../../../docs/referencia/sociedades-categorias.md'),
      'utf8',
    );
    for (const s of SOCIEDADES) {
      const row = doc.split('\n').find((line) => line.includes(s.cif));
      expect(row, `falta ${s.cif} en el documento`).toBeDefined();
      expect(row).toContain(s.razonSocial);
      expect(row).toContain(s.category);
    }
  });
});
