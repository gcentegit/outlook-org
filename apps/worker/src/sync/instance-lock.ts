import { Client } from 'pg';

/**
 * Clave del bloqueo asesor de PostgreSQL que garantiza una única instancia del worker.
 * Es un entero fijo del proyecto (no se calcula) para que dos versiones distintas coincidan.
 */
export const INSTANCE_LOCK_KEY = 726_104_301;

/** Parte de `pg.Client` que usa el bloqueo (facilita probarlo sin base de datos). */
export interface LockConnection {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export interface InstanceLock {
  release(): Promise<void>;
}

export interface AcquireOptions {
  /** Se invoca si la conexión que sostiene el bloqueo se pierde: otra instancia podría tomarlo. */
  onLost: (err: Error) => void;
  createConnection?: () => LockConnection;
}

/**
 * Intenta tomar el bloqueo de instancia única con `pg_try_advisory_lock` en una conexión
 * dedicada (el bloqueo vive lo que dure la sesión). Devuelve null si ya lo tiene otra instancia.
 */
export async function tryAcquireInstanceLock(
  connectionString: string,
  options: AcquireOptions,
): Promise<InstanceLock | null> {
  const conn: LockConnection = options.createConnection?.() ?? new Client({ connectionString });
  let held = false;
  conn.on('error', (err) => {
    if (held) options.onLost(err);
  });
  await conn.connect();
  try {
    const { rows } = await conn.query('SELECT pg_try_advisory_lock($1) AS locked', [
      INSTANCE_LOCK_KEY,
    ]);
    if (rows[0]?.locked !== true) {
      await conn.end();
      return null;
    }
  } catch (err) {
    await conn.end().catch(() => undefined);
    throw err;
  }
  held = true;
  return {
    async release() {
      held = false;
      // Cerrar la sesión libera el bloqueo aunque el unlock explícito fallara.
      await conn.query('SELECT pg_advisory_unlock($1)', [INSTANCE_LOCK_KEY]).catch(() => undefined);
      await conn.end().catch(() => undefined);
    },
  };
}

/** Espera hasta tomar el bloqueo; reintenta cada `retryMs` (p. ej. mientras termina la instancia anterior). */
export async function acquireInstanceLock(
  connectionString: string,
  options: AcquireOptions & {
    retryMs?: number;
    onWaiting?: () => void;
    sleep?: (ms: number) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<InstanceLock | null> {
  const retryMs = options.retryMs ?? 10_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (;;) {
    if (options.signal?.aborted) return null;
    const lock = await tryAcquireInstanceLock(connectionString, options);
    if (lock) return lock;
    options.onWaiting?.();
    await sleep(retryMs);
  }
}
