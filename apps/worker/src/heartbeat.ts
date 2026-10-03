export type HeartbeatStatus = 'up' | 'down';

export interface Heartbeat {
  /** Avisa a Uptime Kuma. Nunca lanza: un fallo del aviso no debe afectar a la sincronización. */
  ping(status: HeartbeatStatus, message: string): Promise<void>;
}

export interface HeartbeatOptions {
  /** URL de push del monitor de Uptime Kuma; sin ella el heartbeat no hace nada. */
  url?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** URL final: la de push del monitor con `status` y `msg` (conserva el resto de su query). */
export function buildHeartbeatUrl(base: string, status: HeartbeatStatus, message: string): string {
  const url = new URL(base);
  url.searchParams.set('status', status);
  url.searchParams.set('msg', message.slice(0, 200));
  if (!url.searchParams.has('ping')) url.searchParams.set('ping', '');
  return url.toString();
}

export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const { url } = options;
  if (!url) return { ping: async () => undefined };
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.warn;
  return {
    async ping(status, message) {
      try {
        const res = await fetchImpl(buildHeartbeatUrl(url, status, message), {
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        await res.body?.cancel();
        if (!res.ok) log(`heartbeat: Uptime Kuma respondió ${res.status}`);
      } catch (err) {
        log(
          `heartbeat: no se pudo avisar a Uptime Kuma: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
