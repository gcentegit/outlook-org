import type { PrismaClient } from '@clasificador/db';

/** Clave del bloqueo asesor que serializa los cambios de configuración que se comprueban y luego escriben. */
const SETTINGS_LOCK_KEY = 726_000_001;

/**
 * Toma, dentro de una transacción, el bloqueo asesor de la configuración: se libera solo al
 * terminarla. Dos cambios concurrentes (quitarse el acceso dos administradores, elegir dos
 * modelos a la vez) se ejecutan uno tras otro y cada uno ve el resultado del anterior.
 */
export async function lockSettings(tx: Pick<PrismaClient, '$executeRaw'>): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETTINGS_LOCK_KEY})`;
}
