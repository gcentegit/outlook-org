import { describe, expect, it } from 'vitest';

import { madridDay, madridDayStart, parseDateRange } from './dates';

describe('madridDayStart', () => {
  it('en invierno la medianoche de Madrid es UTC+1', () => {
    expect(madridDayStart('2026-01-15')?.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('en verano es UTC+2', () => {
    expect(madridDayStart('2026-07-01')?.toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });

  it('respeta el cambio de hora (último domingo de marzo y de octubre)', () => {
    expect(madridDayStart('2026-03-29')?.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(madridDayStart('2026-03-30')?.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(madridDayStart('2026-10-25')?.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(madridDayStart('2026-10-26')?.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('rechaza formatos y fechas inexistentes', () => {
    expect(madridDayStart('15/01/2026')).toBeNull();
    expect(madridDayStart('2026-02-31')).toBeNull();
    expect(madridDayStart('')).toBeNull();
  });
});

describe('madridDay', () => {
  it('usa el día de Madrid, no el de UTC', () => {
    expect(madridDay(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02');
  });
});

describe('parseDateRange', () => {
  const now = new Date('2026-10-02T10:00:00Z');

  it('por defecto son los últimos 30 días hasta hoy, con el final exclusivo', () => {
    const range = parseDateRange(undefined, undefined, now);
    expect(range.fromDay).toBe('2026-09-03');
    expect(range.toDay).toBe('2026-10-02');
    expect(range.to.toISOString()).toBe('2026-10-02T22:00:00.000Z');
  });

  it('respeta un rango válido e intercambia uno invertido', () => {
    expect(parseDateRange('2026-09-10', '2026-09-20', now).fromDay).toBe('2026-09-10');
    const swapped = parseDateRange('2026-09-20', '2026-09-10', now);
    expect([swapped.fromDay, swapped.toDay]).toEqual(['2026-09-10', '2026-09-20']);
  });

  it('ignora valores no válidos', () => {
    const range = parseDateRange('basura', '2026-13-40', now);
    expect(range.toDay).toBe('2026-10-02');
  });

  it('recorta por el principio un rango de más de 366 días', () => {
    const range = parseDateRange('2000-01-01', '2026-10-02', now);
    expect(range.toDay).toBe('2026-10-02');
    expect(range.fromDay).toBe('2025-10-02');
    expect(parseDateRange('2025-10-02', '2026-10-02', now).fromDay).toBe('2025-10-02');
  });
});
