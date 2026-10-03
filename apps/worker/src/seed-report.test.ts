import { describe, expect, it } from 'vitest';

import { describeSeed } from './seed-report';

const base = { rulesCreated: 0, adminCreated: false, adminMissing: false, llmCreated: false };

describe('describeSeed', () => {
  it('resume lo insertado sin avisos cuando hay administrador', () => {
    const report = describeSeed({ ...base, rulesCreated: 3, adminCreated: true });
    expect(report.info).toBe(
      'Datos iniciales: 3 regla(s) nueva(s), administrador inicial dado de alta.',
    );
    expect(report.warning).toBeUndefined();
  });

  it('avisa con claridad si falta ADMIN_EMAIL y la lista de usuarios está vacía', () => {
    const report = describeSeed({ ...base, adminMissing: true });
    expect(report.warning).toMatch(/ADMIN_EMAIL/);
    expect(report.warning).toMatch(/ningún administrador/);
  });
});
