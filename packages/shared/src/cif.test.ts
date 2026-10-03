import { describe, expect, it } from 'vitest';

import { normalizeCif } from './cif';

describe('normalizeCif', () => {
  it('pasa a mayúsculas y quita espacios, guiones y puntos', () => {
    expect(normalizeCif(' b-85.554 921 ')).toBe('B85554921');
  });

  it('deja intacto un CIF ya normalizado', () => {
    expect(normalizeCif('A87240420')).toBe('A87240420');
  });
});
