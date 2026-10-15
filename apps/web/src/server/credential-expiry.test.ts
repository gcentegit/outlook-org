import { describe, expect, it } from 'vitest';

import { credentialWarnings } from './credential-expiry';

const now = new Date('2026-10-15T12:00:00Z');

describe('credentialWarnings', () => {
  it('no avisa si faltan más de 30 días o no se conoce la fecha', () => {
    expect(
      credentialWarnings({ certificate: new Date('2026-11-15T12:00:00Z'), loginSecret: null }, now),
    ).toEqual([]);
  });

  it('avisa con exactamente 30 días', () => {
    const warnings = credentialWarnings(
      { certificate: new Date('2026-11-14T12:00:00Z'), loginSecret: null },
      now,
    );
    expect(warnings).toMatchObject([{ name: 'El certificado de Graph', days: 30 }]);
  });

  it('avisa de cada credencial por separado y de las ya caducadas', () => {
    const warnings = credentialWarnings(
      {
        certificate: new Date('2026-10-20T12:00:00Z'),
        loginSecret: new Date('2026-10-13T12:00:00Z'),
      },
      now,
    );
    expect(warnings.map((w) => [w.name, w.days])).toEqual([
      ['El certificado de Graph', 5],
      ['El secreto de login', -2],
    ]);
  });
});
