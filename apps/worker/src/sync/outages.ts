import type { PrismaClient } from '@clasificador/db';

/** Almacén de las paradas de la sincronización (a lo sumo una abierta a la vez). */
export interface OutageStore {
  /** Abre una parada; no hace nada si ya hay una abierta. */
  open(startedAt: Date, cause: string): Promise<void>;
  /** Cierra la parada abierta, si la hay. */
  close(endedAt: Date): Promise<void>;
}

export interface OutageTracker {
  /** Al arrancar: si hace más de `gapMs` de la última sincronización, el worker estuvo parado. */
  checkGap(lastSyncAt: Date | null): Promise<void>;
  /** Una ronda falló. */
  failed(cause: string): Promise<void>;
  /** Una ronda terminó bien. */
  recovered(): Promise<void>;
}

export interface OutageTrackerOptions {
  store: OutageStore;
  /** Hueco sin sincronizar a partir del cual se considera una parada. */
  gapMs: number;
  now?: () => Date;
  log?: (message: string) => void;
}

const MAX_CAUSE_LENGTH = 200;

/**
 * Registro de caídas. Nunca lanza: un fallo al guardar no debe parar la sincronización.
 * Un worker caído no puede registrarse a sí mismo, así que su parada se deduce al arrancar.
 */
export function createOutageTracker(options: OutageTrackerOptions): OutageTracker {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? console.error;

  async function guard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (err) {
      log(`No se pudo registrar la caída: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    checkGap: (lastSyncAt) =>
      guard(async () => {
        if (lastSyncAt && now().getTime() - lastSyncAt.getTime() > options.gapMs) {
          await options.store.open(lastSyncAt, 'el worker estuvo parado');
        }
      }),
    failed: (cause) => guard(() => options.store.open(now(), cause.slice(0, MAX_CAUSE_LENGTH))),
    recovered: () => guard(() => options.store.close(now())),
  };
}

type Db = Pick<PrismaClient, 'outage'>;

export function createPrismaOutageStore(db: Db): OutageStore {
  return {
    async open(startedAt, cause) {
      const open = await db.outage.findFirst({ where: { endedAt: null }, select: { id: true } });
      if (!open) await db.outage.create({ data: { startedAt, cause } });
    },
    async close(endedAt) {
      await db.outage.updateMany({ where: { endedAt: null }, data: { endedAt } });
    },
  };
}
