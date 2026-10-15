import { CREDENTIAL_WARN_DAYS, daysUntil } from '@clasificador/shared';

export interface CredentialWarning {
  name: string;
  /** Días que faltan; negativo si ya caducó. */
  days: number;
  /** Qué deja de funcionar si caduca. */
  consequence: string;
}

/** Credenciales que caducan en `CREDENTIAL_WARN_DAYS` días o menos (o ya han caducado). */
export function credentialWarnings(
  expiries: { certificate: Date | null; loginSecret: Date | null },
  now: Date = new Date(),
): CredentialWarning[] {
  const candidates = [
    {
      name: 'El certificado de Graph',
      date: expiries.certificate,
      consequence: 'el servicio dejará de leer el buzón',
    },
    {
      name: 'El secreto de login',
      date: expiries.loginSecret,
      consequence: 'nadie podrá iniciar sesión en el panel',
    },
  ];
  return candidates
    .flatMap((c) =>
      c.date ? [{ name: c.name, days: daysUntil(c.date, now), consequence: c.consequence }] : [],
    )
    .filter((c) => c.days <= CREDENTIAL_WARN_DAYS);
}
