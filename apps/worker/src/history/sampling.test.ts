import { describe, expect, it } from 'vitest';

import {
  STRATA,
  allocateQuotas,
  computeDateSplit,
  isDevelopment,
  stratifiedSample,
  stratumOf,
} from './sampling';

const mail = (i: number, categories: string[]) => ({
  id: `m${i}`,
  categories,
  receivedAt: new Date(Date.UTC(2026, 3, 1) + i * 3600_000).toISOString(),
});

describe('stratumOf', () => {
  it('distingue una, varias o ninguna categoría e ignora las etiquetas ajenas', () => {
    expect(stratumOf(['lateral'])).toBe('LATERAL');
    expect(stratumOf(['Pte ok', 'Elena'])).toBe('ninguna');
    expect(stratumOf(['FOOD BOX', 'LATERAL'])).toBe('varias');
    expect(stratumOf(['ARCOBETA', 'Elena'])).toBe('ARCOBETA');
  });
});

describe('allocateQuotas', () => {
  it('reparte a partes iguales y redistribuye el sobrante de los estratos pequeños', () => {
    const q = allocateQuotas(
      { 'FOOD BOX': 1000, LATERAL: 1000, ARCOBETA: 0, varias: 20, ninguna: 1000 },
      100,
    );
    expect(q.ARCOBETA).toBe(0);
    expect(q.varias).toBe(20);
    expect(q['FOOD BOX'] + q.LATERAL + q.ninguna).toBe(80);
    expect(Math.max(q['FOOD BOX'], q.LATERAL, q.ninguna)).toBeLessThanOrEqual(27);
  });

  it('toma todo si hay menos correos que el tamaño pedido', () => {
    const q = allocateQuotas(
      { 'FOOD BOX': 3, LATERAL: 2, ARCOBETA: 0, varias: 0, ninguna: 1 },
      100,
    );
    expect(q).toEqual({ 'FOOD BOX': 3, LATERAL: 2, ARCOBETA: 0, varias: 0, ninguna: 1 });
  });
});

describe('stratifiedSample', () => {
  const items = [
    ...Array.from({ length: 40 }, (_, i) => mail(i, ['FOOD BOX'])),
    ...Array.from({ length: 40 }, (_, i) => mail(100 + i, ['LATERAL'])),
    ...Array.from({ length: 6 }, (_, i) => mail(200 + i, ['FOOD BOX', 'LATERAL'])),
    ...Array.from({ length: 40 }, (_, i) => mail(300 + i, [])),
  ];

  it('con ARCOBETA = 0 no falla y reparte entre los demás estratos', () => {
    const { selected, perStratum } = stratifiedSample(items, 50);
    expect(selected).toHaveLength(50);
    expect(perStratum.ARCOBETA).toEqual({ available: 0, selected: 0 });
    expect(perStratum.varias.selected).toBe(6);
    expect(STRATA.every((s) => perStratum[s].selected <= perStratum[s].available)).toBe(true);
  });

  it('es reproducible, no repite correos y sale ordenada por fecha', () => {
    const a = stratifiedSample(items, 50);
    const b = stratifiedSample(items, 50);
    expect(a.selected.map((m) => m.id)).toEqual(b.selected.map((m) => m.id));
    expect(new Set(a.selected.map((m) => m.id)).size).toBe(50);
    const dates = a.selected.map((m) => m.receivedAt);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('computeDateSplit', () => {
  it('deja el 70 % más antiguo en desarrollo y el 30 % más reciente en prueba', () => {
    const dates = Array.from({ length: 10 }, (_, i) => mail(i, []).receivedAt).reverse();
    const split = computeDateSplit(dates, 0.7);
    expect(split).toMatchObject({ dev: 7, test: 3 });
    expect(dates.filter((d) => isDevelopment(d, split.splitDate))).toHaveLength(7);
    expect(isDevelopment(dates[0] as string, split.splitDate)).toBe(false); // el más reciente
  });

  it('con fechas repetidas en el corte todas van a prueba', () => {
    const split = computeDateSplit(['1', '2', '3', '3', '3', '3'], 0.5);
    expect(split.splitDate).toBe('3');
    expect(split.dev).toBe(2);
  });

  it('sin correos no hay corte y todo sería desarrollo', () => {
    const split = computeDateSplit([], 0.7);
    expect(split.splitDate).toBeNull();
    expect(isDevelopment('2026-01-01', null)).toBe(true);
  });
});
