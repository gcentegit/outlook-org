import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { PrismaClient } from '@clasificador/db';
import { CERT_EXPIRY_SYNC_ID } from '@clasificador/shared';

/** Caducidad (`notAfter`) del primer certificado de un PEM; el fichero también lleva la clave privada. */
export function parseCertificateExpiry(pem: string): Date {
  const block = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pem)?.[0];
  if (!block) throw new Error('el fichero no contiene ningún certificado PEM');
  return new Date(new X509Certificate(block).validTo);
}

/**
 * Lee la caducidad del certificado de Graph y la deja en `SyncState` para que el panel (que no
 * tiene el certificado) la lea. Devuelve null si no se puede leer: es informativo y no debe
 * impedir que el worker arranque.
 */
export async function recordCertificateExpiry(
  db: Pick<PrismaClient, 'syncState'>,
  certPath: string,
): Promise<Date | null> {
  try {
    const expiresAt = parseCertificateExpiry(await readFile(certPath, 'utf8'));
    await db.syncState.upsert({
      where: { id: CERT_EXPIRY_SYNC_ID },
      create: { id: CERT_EXPIRY_SYNC_ID, lastSyncAt: expiresAt },
      update: { lastSyncAt: expiresAt },
    });
    return expiresAt;
  } catch (err) {
    console.error('No se pudo leer la caducidad del certificado de Graph:', err);
    return null;
  }
}
