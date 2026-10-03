import { createServer, type Server } from 'node:http';

export interface HealthReport {
  /** `disabled`: la sincronización no está en marcha (p. ej. faltan las credenciales de Graph). */
  status: 'ok' | 'stale' | 'error' | 'disabled';
  version: string;
  /** Commit (sha corto) con el que se construyó la imagen. */
  commit: string;
  lastSyncAt: string | null;
  mode?: string;
  /** Modo por categoría fijado en el panel (informativo: el worker sigue en sombra). */
  categoryModes?: Record<string, string>;
  /** Por qué no está sano; ausente si `status` es `ok`. */
  reason?: string;
}

/** `ok` solo si la última sincronización existe y no es más antigua que `staleMs`. */
export function evaluateHealth(
  lastSyncAt: Date | null,
  now: Date,
  staleMs: number,
): Pick<HealthReport, 'status' | 'lastSyncAt'> {
  if (lastSyncAt === null) return { status: 'stale', lastSyncAt: null };
  const fresh = now.getTime() - lastSyncAt.getTime() <= staleMs;
  return { status: fresh ? 'ok' : 'stale', lastSyncAt: lastSyncAt.toISOString() };
}

/** Resultado de la comprobación de vida: el proceso ha arrancado del todo y su bucle avanza. */
export interface Liveness {
  ok: boolean;
  /** Por qué no está vivo del todo (arrancando, bucle de sincronización parado). */
  reason?: string;
}

/**
 * Vida del bucle de sincronización: sin sincronización en marcha (p. ej. faltan las credenciales
 * de Graph) no hay bucle que vigilar; con ella, no debe llevar parado más de `maxSilenceMs`.
 * Mide si el bucle avanza, no si Graph responde: una caída de Graph hace fallar rondas, pero el
 * bucle sigue girando.
 */
export function evaluateLoopLiveness(
  lastActivityAt: Date | null,
  now: Date,
  maxSilenceMs: number,
): Liveness {
  if (lastActivityAt === null) return { ok: true };
  const silence = now.getTime() - lastActivityAt.getTime();
  return silence <= maxSilenceMs
    ? { ok: true }
    : {
        ok: false,
        reason: `el bucle de sincronización lleva ${Math.round(silence / 1000)} s sin avanzar`,
      };
}

export interface HealthServerOptions {
  version: string;
  commit: string;
  staleMs: number;
  /** Última sincronización correcta con el buzón (SyncState en la base de datos). */
  getLastSyncAt: () => Promise<Date | null>;
  mode?: string;
  /** Si devuelve un texto, la sincronización no está en marcha: 503 `disabled` con ese motivo. */
  getInactiveReason?: () => string | null;
  /** Error de la última ronda de sincronización; se muestra como motivo cuando hay retraso. */
  getLastError?: () => string | null;
  /**
   * Comprobación de vida de `/livez`, la que usa el HEALTHCHECK de Docker y Swarm. No depende de
   * Graph ni de la frescura de la sincronización: esa la vigilan `/health` y Uptime Kuma.
   */
  getLiveness?: () => Liveness;
  /** Modos por categoría del panel; si falla, se omite del informe sin afectar al estado. */
  getCategoryModes?: () => Promise<Record<string, string>>;
  now?: () => Date;
}

export function createHealthServer(opts: HealthServerOptions): Server {
  const now = opts.now ?? (() => new Date());
  return createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/livez') {
        const liveness = opts.getLiveness?.() ?? { ok: true };
        res.writeHead(liveness.ok ? 200 : 503, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            status: liveness.ok ? 'alive' : 'unavailable',
            version: opts.version,
            commit: opts.commit,
            ...(liveness.reason ? { reason: liveness.reason } : {}),
          }),
        );
        return;
      }
      if (req.method !== 'GET' || req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      let categoryModes: Record<string, string> | undefined;
      try {
        categoryModes = await opts.getCategoryModes?.();
      } catch (err) {
        console.error('Fallo al leer CategorySetting en /health:', err);
      }
      const base = {
        version: opts.version,
        commit: opts.commit,
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(categoryModes ? { categoryModes } : {}),
      };
      let report: HealthReport;
      const inactive = opts.getInactiveReason?.() ?? null;
      if (inactive !== null) {
        report = { ...base, status: 'disabled', lastSyncAt: null, reason: inactive };
      } else {
        try {
          const lastSyncAt = await opts.getLastSyncAt();
          const evaluated = evaluateHealth(lastSyncAt, now(), opts.staleMs);
          const reason =
            evaluated.status === 'ok'
              ? undefined
              : (opts.getLastError?.() ??
                (lastSyncAt === null
                  ? 'todavía no hay ninguna sincronización correcta'
                  : 'la última sincronización es demasiado antigua'));
          report = { ...base, ...evaluated, ...(reason ? { reason } : {}) };
        } catch (err) {
          console.error('Fallo al leer SyncState en /health:', err);
          report = {
            ...base,
            status: 'error',
            lastSyncAt: null,
            reason: 'base de datos no disponible',
          };
        }
      }
      res
        .writeHead(report.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify(report));
    })();
  });
}
