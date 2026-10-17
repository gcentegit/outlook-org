import { describe, expect, it } from 'vitest';

import { newRuleSchema, normalizeRuleValue } from './rule-form';

describe('normalizeRuleValue', () => {
  it('deja el CIF en mayúsculas, sin separadores ni prefijo ES', () => {
    expect(normalizeRuleValue('cif', ' es b-85.554 921 ')).toEqual({
      ok: true,
      value: 'B85554921',
    });
    expect(normalizeRuleValue('cif', 'B8555492')).toMatchObject({ ok: false });
  });

  it('pasa remitente y dominio a minúsculas y quita la arroba del dominio', () => {
    expect(normalizeRuleValue('remitente', ' Facturas@Ejemplo.com ')).toEqual({
      ok: true,
      value: 'facturas@ejemplo.com',
    });
    expect(normalizeRuleValue('remitente', 'facturas')).toMatchObject({ ok: false });
    expect(normalizeRuleValue('dominio', '@Ejemplo.COM')).toEqual({
      ok: true,
      value: 'ejemplo.com',
    });
    expect(normalizeRuleValue('dominio', 'https://ejemplo.com')).toMatchObject({ ok: false });
  });

  it('razón social y palabra clave: espacios colapsados y al menos 3 caracteres', () => {
    expect(normalizeRuleValue('razon_social', '  Ejemplo   Distribución S.L. ')).toEqual({
      ok: true,
      value: 'Ejemplo Distribución S.L.',
    });
    expect(normalizeRuleValue('palabra_clave', 'ab')).toMatchObject({ ok: false });
    expect(normalizeRuleValue('palabra_clave', '   ')).toMatchObject({ ok: false });
  });
});

describe('newRuleSchema', () => {
  it('saca el peso del tipo', () => {
    expect(newRuleSchema.parse({ category: 'LATERAL', type: 'cif', value: 'b12345678' })).toEqual({
      category: 'LATERAL',
      type: 'cif',
      value: 'B12345678',
      weight: 'fuerte',
    });
    expect(
      newRuleSchema.parse({ category: 'ARCOBETA', type: 'dominio', value: 'ejemplo.com' }).weight,
    ).toBe('medio');
  });

  it('rechaza categorías y tipos que no existen y explica el valor no válido', () => {
    expect(
      newRuleSchema.safeParse({ category: 'OTRA', type: 'cif', value: 'B12345678' }).success,
    ).toBe(false);
    expect(
      newRuleSchema.safeParse({ category: 'LATERAL', type: 'asunto', value: 'x' }).success,
    ).toBe(false);
    const bad = newRuleSchema.safeParse({ category: 'LATERAL', type: 'cif', value: '123' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/9 letras o números/);
  });
});
