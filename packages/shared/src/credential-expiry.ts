/** Fila de `SyncState` donde el worker deja la fecha de caducidad del certificado de Graph (en `lastSyncAt`). */
export const CERT_EXPIRY_SYNC_ID = 'graph-cert-expiry';

/** Con estos días o menos para caducar, el panel avisa. */
export const CREDENTIAL_WARN_DAYS = 30;

const DAY_MS = 86_400_000;

/** Días enteros que faltan para `expiresAt`; negativo si ya caducó. */
export function daysUntil(expiresAt: Date, now: Date): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
}
