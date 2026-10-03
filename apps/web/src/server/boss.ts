import 'server-only';

import { PgBoss } from 'pg-boss';

import type { JobQueue } from './job-runner';

const globalForBoss = globalThis as unknown as { __clasificadorBoss?: Promise<PgBoss> };

/**
 * Cliente de pg-boss solo para encolar y consultar (no crea ni migra el esquema, no supervisa ni
 * programa: eso es del worker). Un único cliente por proceso; si arrancar falla (p. ej. el worker
 * aún no ha creado el esquema) no se guarda y el siguiente intento vuelve a probar.
 */
function getBoss(): Promise<PgBoss> {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error('Falta DATABASE_URL'));
  if (!globalForBoss.__clasificadorBoss) {
    const boss = new PgBoss({
      connectionString: url,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => console.error('pg-boss (panel):', err));
    globalForBoss.__clasificadorBoss = boss.start().then(
      () => boss,
      (err: unknown) => {
        delete globalForBoss.__clasificadorBoss;
        throw err;
      },
    );
  }
  return globalForBoss.__clasificadorBoss;
}

/** Cola de trabajos del worker: encolar, consultar, cancelar y borrar. Puede lanzar si la base de datos no responde. */
export async function getJobQueue(): Promise<JobQueue> {
  const boss = await getBoss();
  return {
    send: (name, data, options) => boss.send(name, data, options),
    getJobById: (name, id) => boss.getJobById(name, id),
    cancel: (name, id) => boss.cancel(name, id),
    deleteJob: (name, id) => boss.deleteJob(name, id),
  };
}
