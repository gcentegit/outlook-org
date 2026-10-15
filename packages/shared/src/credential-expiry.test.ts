import { describe, expect, it } from 'vitest';

import { daysUntil } from './credential-expiry';

const now = new Date('2026-10-15T12:00:00Z');

describe('daysUntil', () => {
  it('cuenta días enteros hacia el futuro', () => {
    expect(daysUntil(new Date('2026-11-14T12:00:00Z'), now)).toBe(30);
    expect(daysUntil(new Date('2026-11-14T11:59:00Z'), now)).toBe(29);
  });

  it('es negativo si ya caducó', () => {
    expect(daysUntil(new Date('2026-10-15T11:00:00Z'), now)).toBe(-1);
  });
});
