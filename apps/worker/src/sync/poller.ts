import type { Heartbeat } from '../heartbeat';
import type { SyncResult } from './delta';

export interface PollerOptions {
  runCycle: () => Promise<SyncResult>;
  intervalMs: number;
  heartbeat: Heartbeat;
  log?: (message: string) => void;
  /** Espera abortable entre rondas; inyectable para las pruebas. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface Poller {
  start(): void;
  /** Deja de planificar rondas y espera a que termine la que esté en curso. */
  stop(): Promise<void>;
  /** Mensaje del error de la última ronda, o null si fue correcta. */
  lastError(): string | null;
  /** Último momento en que el bucle avanzó (empezó o terminó una ronda); null si aún no ha arrancado. */
  lastActivityAt(): Date | null;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function summarize(result: SyncResult): string {
  return `ok: ${result.enqueued} nuevos, ${result.corrections} correcciones, ${result.removed} salidas`;
}

/** Rondas de sincronización una tras otra (nunca solapadas), cada `intervalMs`. */
export function createPoller(options: PollerOptions): Poller {
  const log = options.log ?? console.log;
  const wait = options.wait ?? abortableSleep;
  const abort = new AbortController();
  let error: string | null = null;
  let loop: Promise<void> | null = null;
  let activityAt: Date | null = null;

  async function run(): Promise<void> {
    while (!abort.signal.aborted) {
      activityAt = new Date();
      try {
        const result = await options.runCycle();
        error = null;
        if (result.enqueued || result.changed || result.removed || result.resynced) {
          log(`sincronización ${summarize(result)}${result.resynced ? ' (resincronizada)' : ''}`);
        }
        await options.heartbeat.ping('up', summarize(result));
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error('Fallo en la sincronización con el buzón:', err);
        await options.heartbeat.ping('down', error);
      }
      activityAt = new Date();
      await wait(options.intervalMs, abort.signal);
    }
  }

  return {
    start() {
      loop ??= run();
    },
    async stop() {
      abort.abort();
      await loop;
    },
    lastError: () => error,
    lastActivityAt: () => activityAt,
  };
}
