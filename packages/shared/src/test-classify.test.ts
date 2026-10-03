import { describe, expect, it } from 'vitest';

import { SOCIEDADES } from './sociedades';
import { sampleTestEmail, testClassifyRequestSchema } from './test-classify';

describe('sampleTestEmail', () => {
  it('lleva el CIF de una sociedad de la tabla y cumple el esquema de la petición', () => {
    const email = sampleTestEmail();
    expect(SOCIEDADES.some((s) => email.body.includes(s.cif))).toBe(true);
    expect(
      testClassifyRequestSchema.safeParse({ provider: 'google', model: 'gemini-2.5-flash', email })
        .success,
    ).toBe(true);
  });
});

describe('testClassifyRequestSchema', () => {
  const email = { subject: 'x', body: 'y' };
  it('rechaza un proveedor desconocido y un cuerpo vacío', () => {
    expect(testClassifyRequestSchema.safeParse({ provider: 'x', model: 'm', email }).success).toBe(
      false,
    );
    expect(
      testClassifyRequestSchema.safeParse({
        provider: 'google',
        model: 'm',
        email: { subject: '', body: '' },
      }).success,
    ).toBe(false);
  });
});
