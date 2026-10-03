import { describe, expect, it } from 'vitest';

import { parseFilter } from './filter-params';

const now = new Date('2026-10-02T10:00:00Z');

describe('parseFilter', () => {
  it('lee fechas, categoría y página válidas', () => {
    const filter = parseFilter(
      { desde: '2026-09-01', hasta: '2026-09-30', categoria: 'LATERAL', pagina: '3' },
      now,
    );
    expect(filter.range.fromDay).toBe('2026-09-01');
    expect(filter.range.toDay).toBe('2026-09-30');
    expect(filter.category).toBe('LATERAL');
    expect(filter.page).toBe(3);
  });

  it('ignora categorías desconocidas y páginas no válidas', () => {
    const filter = parseFilter({ categoria: 'OTRA', pagina: '-2' }, now);
    expect(filter.category).toBeNull();
    expect(filter.page).toBe(1);
    expect(parseFilter({ pagina: 'x' }, now).page).toBe(1);
  });

  it('toma el primer valor si el parámetro se repite', () => {
    expect(parseFilter({ categoria: ['ARCOBETA', 'LATERAL'] }, now).category).toBe('ARCOBETA');
  });
});
