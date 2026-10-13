import { CHECK_FOLDERS_QUEUE } from '@clasificador/shared';

import type { JobQueue } from './job-runner';

/** `busy`: ya hay una comprobación esperando (la cola admite una en espera y otra en marcha). */
export type FolderCheckRequest = 'queued' | 'busy';

/**
 * Pide al worker que compruebe ya en qué carpeta está cada correo. No espera al resultado: con
 * muchos correos la ronda tarda minutos, y el panel lo verá al recargar. Es la misma comprobación
 * que el worker hace sola cada hora.
 */
export async function requestFolderCheck(queue: JobQueue): Promise<FolderCheckRequest> {
  const jobId = await queue.send(CHECK_FOLDERS_QUEUE, {}, { retryLimit: 0, expireInSeconds: 3600 });
  return jobId ? 'queued' : 'busy';
}
