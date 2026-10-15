/** Parte del cliente de Prisma que necesita la limpieza (facilita probarla sin base de datos). */
export interface AttachmentTextStore {
  attachmentText: {
    deleteMany: (args: { where: { expiresAt: { lt: Date } } }) => Promise<{ count: number }>;
  };
}

/** Borra el texto extraído de adjuntos cuya caducidad (90 días tras crearlo) ya ha pasado. */
export async function deleteExpiredAttachmentTexts(
  db: AttachmentTextStore,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.attachmentText.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

/** Meses que se conservan remitentes, asuntos y decisiones (ADR 0010). */
export const MESSAGE_RETENTION_MONTHS = 12;

/** Parte del cliente de Prisma que necesita el borrado de correos antiguos. */
export interface MessageRetentionStore {
  message: {
    count: (args: { where: { receivedAt: { lt: Date } } }) => Promise<number>;
    deleteMany: (args: { where: { receivedAt: { lt: Date } } }) => Promise<{ count: number }>;
  };
}

/** Fecha a partir de la cual un correo es más antiguo que el plazo de conservación (meses naturales, UTC). */
export function messageRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MESSAGE_RETENTION_MONTHS);
  return cutoff;
}

/**
 * Borra los correos recibidos antes del corte de 12 meses; sus decisiones, correcciones y categorías
 * aplicadas se van en cascada. Con `enabled` en falso no borra nada y solo cuenta cuántos borraría.
 */
export async function deleteExpiredMessages(
  db: MessageRetentionStore,
  options: { enabled: boolean; now?: Date },
): Promise<{ count: number; deleted: boolean }> {
  const where = { receivedAt: { lt: messageRetentionCutoff(options.now ?? new Date()) } };
  if (!options.enabled) return { count: await db.message.count({ where }), deleted: false };
  const { count } = await db.message.deleteMany({ where });
  return { count, deleted: true };
}
