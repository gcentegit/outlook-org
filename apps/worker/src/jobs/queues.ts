import {
  CREATE_MASTER_CATEGORY_QUEUE,
  LIST_MASTER_CATEGORIES_QUEUE,
  REPROCESS_FLAGGED_QUEUE,
  TEST_CLASSIFY_QUEUE,
  type CreateMasterCategoryResult,
  type ListMasterCategoriesResult,
  type TestClassifyResult,
} from '@clasificador/shared';
import { PgBoss } from 'pg-boss';

import { deleteExpiredAttachmentTexts, type AttachmentTextStore } from '../cleanup';
import {
  runCreateMasterCategory,
  runListMasterCategories,
  type MasterCategoriesAccess,
} from './master-categories';
import { processMessage, type ProcessMessageDeps } from './process-message';
import { reprocessFlagged, type ReprocessStore } from './reprocess';
import { runTestClassify, type TestClassifyDeps } from './test-classify';

export const PROCESS_MESSAGE_QUEUE = 'process-message';
export const CLEANUP_QUEUE = 'cleanup-attachment-text';

/** Reintentos de `process-message` tras el primer intento (retroceso exponencial desde 30 s). */
export const PROCESS_RETRY_LIMIT = 5;

/** Limpieza diaria a las 03:30 hora de Madrid, cuando no suele llegar correo. */
export const CLEANUP_CRON = '30 3 * * *';
export const CLEANUP_TZ = 'Europe/Madrid';

interface ProcessMessageData {
  messageId: string;
}

const PANEL_QUEUE_OPTIONS = {
  retryLimit: 0,
  expireInSeconds: 120,
  deleteAfterSeconds: 300,
} as const;

export function createBoss(connectionString: string): PgBoss {
  const boss = new PgBoss(connectionString);
  // Sin este oyente un error de pg-boss tumbaría el proceso sin dejar rastro útil.
  boss.on('error', (err) => console.error('pg-boss:', err));
  return boss;
}

/**
 * Crea las colas y programa la limpieza diaria. `process-message` admite un solo trabajo en
 * espera por correo (`singletonKey`) y reintenta con retroceso exponencial; la extracción con
 * OCR puede tardar, de ahí la caducidad generosa.
 *
 * Las colas que usa el panel (prueba de modelos, categorías, reproceso) no reintentan y caducan
 * pronto: el panel espera como mucho unos segundos y cancela si no hay respuesta, y un trabajo
 * atrasado no debe ejecutarse cuando ya nadie espera el resultado. Los datos y resultados de
 * esas colas se borran a los cinco minutos (`deleteAfterSeconds`): el texto que se pega en
 * «Probar» no debe quedarse en la base de datos ni en sus copias.
 */
export async function setupQueues(boss: PgBoss): Promise<void> {
  await boss.start();
  await boss.createQueue(PROCESS_MESSAGE_QUEUE, {
    policy: 'short',
    retryLimit: PROCESS_RETRY_LIMIT,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
    retentionSeconds: 7 * 24 * 3600,
  });
  await boss.createQueue(CLEANUP_QUEUE, { retryLimit: 2, retryDelay: 60 });
  await boss.createQueue(TEST_CLASSIFY_QUEUE, PANEL_QUEUE_OPTIONS);
  await boss.createQueue(LIST_MASTER_CATEGORIES_QUEUE, PANEL_QUEUE_OPTIONS);
  await boss.createQueue(CREATE_MASTER_CATEGORY_QUEUE, PANEL_QUEUE_OPTIONS);
  await boss.createQueue(REPROCESS_FLAGGED_QUEUE, PANEL_QUEUE_OPTIONS);
  await boss.schedule(CLEANUP_QUEUE, CLEANUP_CRON, {}, { tz: CLEANUP_TZ });
}

/** Encola un correo; si ya hay un trabajo en espera para él, no se duplica. */
export async function enqueueMessage(boss: PgBoss, messageId: string): Promise<void> {
  const data: ProcessMessageData = { messageId };
  await boss.send(PROCESS_MESSAGE_QUEUE, data, { singletonKey: messageId });
}

export async function registerCleanupWorker(
  boss: PgBoss,
  db: AttachmentTextStore,
  log: (message: string) => void = console.log,
): Promise<void> {
  await boss.work(CLEANUP_QUEUE, async () => {
    const deleted = await deleteExpiredAttachmentTexts(db);
    log(`limpieza: ${deleted} texto(s) de adjuntos caducados borrados`);
  });
}

export async function registerProcessWorker(
  boss: PgBoss,
  deps: ProcessMessageDeps,
  concurrency: number,
): Promise<void> {
  await boss.work<ProcessMessageData>(
    PROCESS_MESSAGE_QUEUE,
    { localConcurrency: concurrency, batchSize: 1 },
    async ([job]) => {
      if (!job) return;
      const outcome = await processMessage(job.data.messageId, deps, {
        isLast: job.retryCount >= PROCESS_RETRY_LIMIT,
      });
      (deps.log ?? console.log)(`correo ${job.data.messageId}: ${outcome}`);
    },
  );
}

/** Atiende las pruebas de proveedor/modelo que lanza el panel; no necesita acceso al buzón. */
export async function registerTestClassifyWorker(
  boss: PgBoss,
  deps: TestClassifyDeps,
  log: (message: string) => void = console.log,
): Promise<void> {
  await boss.work<unknown, TestClassifyResult>(
    TEST_CLASSIFY_QUEUE,
    { localConcurrency: 1, batchSize: 1 },
    async ([job]) => {
      if (!job) throw new Error('trabajo de prueba vacío');
      const result = await runTestClassify(job.data, deps);
      log(`prueba de modelo: ${result.status}`);
      return result;
    },
  );
}

/**
 * Atiende lo que pide el panel sobre el buzón: leer y crear categorías maestras (con el
 * certificado de Graph, que solo tiene el worker) y reprocesar los correos marcados. Se registra
 * aunque no haya credenciales de Graph: entonces las categorías responden `unconfigured` con el
 * motivo y el panel lo muestra.
 */
export async function registerPanelWorkers(
  boss: PgBoss,
  deps: {
    categories: MasterCategoriesAccess;
    reprocess: ReprocessStore;
    enqueue: (messageId: string) => Promise<void>;
  },
  log: (message: string) => void = console.log,
): Promise<void> {
  await boss.work<unknown, ListMasterCategoriesResult>(
    LIST_MASTER_CATEGORIES_QUEUE,
    { localConcurrency: 1, batchSize: 1 },
    async ([job]) => {
      if (!job) throw new Error('trabajo vacío');
      return runListMasterCategories(deps.categories);
    },
  );
  await boss.work<unknown, CreateMasterCategoryResult>(
    CREATE_MASTER_CATEGORY_QUEUE,
    { localConcurrency: 1, batchSize: 1 },
    async ([job]) => {
      if (!job) throw new Error('trabajo vacío');
      const result = await runCreateMasterCategory(job.data, deps.categories);
      log(`categoría del buzón: ${result.status}`);
      return result;
    },
  );
  await boss.work(REPROCESS_FLAGGED_QUEUE, { localConcurrency: 1, batchSize: 1 }, async () => {
    const count = await reprocessFlagged(deps.reprocess, deps.enqueue);
    log(`reproceso: ${count} correo(s) vuelto(s) a encolar`);
    return { enqueued: count };
  });
}
