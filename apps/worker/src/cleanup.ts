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
