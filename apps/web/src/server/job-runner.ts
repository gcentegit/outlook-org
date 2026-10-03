import type { ZodType } from 'zod';

/** Parte de pg-boss que usa el panel (permite probar con un doble sin base de datos). */
export interface JobQueue {
  send(
    name: string,
    data: object,
    options: { retryLimit: number; expireInSeconds: number },
  ): Promise<string | null>;
  getJobById(name: string, id: string): Promise<{ state: string; output?: unknown } | null>;
  cancel(name: string, id: string): Promise<unknown>;
  deleteJob(name: string, id: string): Promise<unknown>;
}

export type JobOutcome<T> = { ok: true; output: T } | { ok: false; message: string };

export interface JobRunOptions {
  timeoutMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_POLL_MS = 1_000;
const TERMINAL_FAILURE = new Set(['failed', 'cancelled']);

/** Mensaje que da pg-boss en `output` de un trabajo fallido, si lo hay. */
function failureDetail(output: unknown): string {
  if (typeof output === 'object' && output !== null && 'message' in output) {
    const message = (output as { message: unknown }).message;
    if (typeof message === 'string' && message) return `: ${message.slice(0, 200)}`;
  }
  return '';
}

/**
 * Encola un trabajo para el worker y espera su resultado con sondeo, hasta `timeoutMs`. Si se
 * agota el tiempo lo cancela, para que el worker no lo ejecute cuando ya nadie espera. Una vez
 * leído el resultado borra el trabajo: sus datos (p. ej. el texto pegado en «Probar») no deben
 * quedarse en la cola. Nunca lanza: los problemas de cola se devuelven como mensaje para el usuario.
 *
 * `what` es el complemento de las frases de error, p. ej. «la prueba».
 */
export async function runQueueJob<T>(
  queue: JobQueue,
  name: string,
  data: object,
  what: string,
  outputSchema: ZodType<T>,
  options: JobRunOptions,
): Promise<JobOutcome<T>> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const discard = (jobId: string): Promise<unknown> =>
    queue.deleteJob(name, jobId).catch(() => undefined);

  let jobId: string | null;
  try {
    jobId = await queue.send(name, data, {
      retryLimit: 0,
      expireInSeconds: Math.ceil(options.timeoutMs / 1000) + 30,
    });
  } catch (error) {
    console.error(`No se pudo encolar ${what}`, error);
    return {
      ok: false,
      message: `No se pudo encolar ${what}. Comprueba que el worker está en marcha (crea la cola al arrancar) y que la base de datos responde.`,
    };
  }
  if (!jobId) return { ok: false, message: `La cola no aceptó ${what}. Inténtalo de nuevo.` };

  const deadline = now() + options.timeoutMs;
  try {
    for (;;) {
      const job = await queue.getJobById(name, jobId);
      if (job?.state === 'completed') {
        const parsed = outputSchema.safeParse(job.output);
        await discard(jobId);
        if (parsed.success) return { ok: true, output: parsed.data };
        console.error('Resultado de trabajo no válido', parsed.error);
        return {
          ok: false,
          message:
            'El worker devolvió un resultado que el panel no entiende (¿versiones distintas?).',
        };
      }
      if (job && TERMINAL_FAILURE.has(job.state)) {
        const message = `El worker no pudo completar ${what}${failureDetail(job.output)}`;
        await discard(jobId);
        return { ok: false, message };
      }
      if (now() >= deadline) break;
      await sleep(pollMs);
    }
  } catch (error) {
    console.error(`Fallo al consultar el resultado de ${what}`, error);
    await queue.cancel(name, jobId).catch(() => undefined);
    await discard(jobId);
    return { ok: false, message: `No se pudo consultar el resultado de ${what}.` };
  }

  await queue.cancel(name, jobId).catch(() => undefined);
  await discard(jobId);
  return {
    ok: false,
    message: `El worker no respondió en ${Math.round(options.timeoutMs / 1000)} s. Comprueba que está en marcha y que no está procesando una cola larga.`,
  };
}
