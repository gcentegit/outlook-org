import {
  MASTER_CATEGORY_TIMEOUT_MS,
  REPROCESS_FLAGGED_QUEUE,
  reprocessResultSchema,
} from '@clasificador/shared';

import { runQueueJob, type JobQueue, type JobRunOptions } from './job-runner';

export type ReprocessOutcome = { ok: true; enqueued: number } | { ok: false; message: string };

/**
 * Pide al worker que vuelva a encolar los correos marcados para reprocesar (decisión degradada
 * por un fallo técnico, o trabajo que agotó los reintentos) y espera a saber cuántos eran.
 */
export async function requestReprocess(
  queue: JobQueue,
  options: Partial<JobRunOptions> = {},
): Promise<ReprocessOutcome> {
  const outcome = await runQueueJob(
    queue,
    REPROCESS_FLAGGED_QUEUE,
    {},
    'el reproceso',
    reprocessResultSchema,
    { ...options, timeoutMs: options.timeoutMs ?? MASTER_CATEGORY_TIMEOUT_MS },
  );
  return outcome.ok ? { ok: true, enqueued: outcome.output.enqueued } : outcome;
}
