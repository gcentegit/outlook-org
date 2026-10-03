/**
 * Vuelve a encolar los correos marcados para reprocesar: los que se decidieron con un fallo técnico
 * (docling o el LLM caídos) o cuyo trabajo agotó los reintentos. El worker en marcha los procesa
 * como cualquier otro correo y, si ahora sale una decisión válida, quita la marca.
 *
 * Uso (desde apps/worker; el mismo resultado que el botón «Reprocesar» del panel):
 *   tsx --env-file-if-exists=../../.env scripts/reprocess.ts [--dry-run]
 *
 * Con --dry-run solo cuenta los marcados. Necesita DATABASE_URL y que el worker haya arrancado al
 * menos una vez (crea la cola).
 */
import { parseArgs } from 'node:util';

import { createPrismaClient } from '@clasificador/db';

import { createBoss, enqueueMessage } from '../src/jobs/queues';
import { createPrismaReprocessStore, reprocessFlagged } from '../src/jobs/reprocess';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');

  const db = createPrismaClient(url);
  try {
    const store = createPrismaReprocessStore(db);
    if (values['dry-run']) {
      console.log(`${(await store.listFlagged()).length} correo(s) marcados para reprocesar.`);
      return;
    }
    const boss = createBoss(url);
    await boss.start();
    try {
      const count = await reprocessFlagged(store, (messageId) => enqueueMessage(boss, messageId));
      console.log(
        count === 0
          ? 'No hay correos marcados para reprocesar.'
          : `${count} correo(s) vuelto(s) a encolar; el worker los procesará en breve.`,
      );
    } finally {
      await boss.stop({ graceful: false });
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
