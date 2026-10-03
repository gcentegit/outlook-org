import type { SeedResult } from '@clasificador/db/seed';

export interface SeedReport {
  /** Resumen de lo que se insertó. */
  info: string;
  /** Aviso a registrar como error si el servicio arranca sin ningún administrador. */
  warning?: string;
}

/** Texto de registro del resultado de la semilla; avisa si faltó `ADMIN_EMAIL` y no hay usuarios. */
export function describeSeed(seeded: SeedResult): SeedReport {
  const info =
    `Datos iniciales: ${seeded.rulesCreated} regla(s) nueva(s)` +
    `${seeded.adminCreated ? ', administrador inicial dado de alta' : ''}` +
    `${seeded.llmCreated ? ', modelo por defecto creado' : ''}.`;
  if (!seeded.adminMissing) return { info };
  return {
    info,
    warning:
      'No hay ningún usuario autorizado y ADMIN_EMAIL no está definida: no se ha creado ningún ' +
      'administrador y nadie podrá entrar al panel. Define ADMIN_EMAIL y reinicia el worker.',
  };
}
