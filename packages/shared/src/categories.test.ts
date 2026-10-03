import { describe, expect, it } from 'vitest';

import { canonicalCategory } from './categories';

describe('canonicalCategory', () => {
  it('ignora mayúsculas y espacios', () => {
    expect(canonicalCategory(' food box ')).toBe('FOOD BOX');
    expect(canonicalCategory('Lateral')).toBe('LATERAL');
  });

  it('devuelve null para categorías no automatizadas', () => {
    expect(canonicalCategory('ALQUILERES')).toBeNull();
  });
});
