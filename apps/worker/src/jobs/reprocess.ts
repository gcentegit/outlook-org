import type { PrismaClient } from '@clasificador/db';

/** Correos marcados para reprocesar (decisión degradada o trabajo que agotó los reintentos). */
export interface ReprocessStore {
  /** Ids de los correos con `needsReprocess`. */
  listFlagged(): Promise<string[]>;
  /** Los deja pendientes: están a la espera de que el trabajo se ejecute de nuevo. */
  markPending(messageIds: string[]): Promise<void>;
}

export function createPrismaReprocessStore(db: Pick<PrismaClient, 'message'>): ReprocessStore {
  return {
    async listFlagged() {
      const rows = await db.message.findMany({
        where: { needsReprocess: true },
        orderBy: { receivedAt: 'asc' },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    async markPending(messageIds) {
      if (messageIds.length === 0) return;
      await db.message.updateMany({
        where: { id: { in: messageIds } },
        data: { status: 'pending' },
      });
    },
  };
}

/**
 * Vuelve a encolar los correos marcados. Conservan la marca hasta que se guarde una decisión
 * válida, de modo que un reproceso que vuelva a fallar los deja marcados otra vez. Devuelve
 * cuántos se encolaron.
 */
export async function reprocessFlagged(
  store: ReprocessStore,
  enqueue: (messageId: string) => Promise<void>,
): Promise<number> {
  const ids = await store.listFlagged();
  await store.markPending(ids);
  for (const id of ids) await enqueue(id);
  return ids.length;
}
