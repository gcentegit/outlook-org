import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

import { prisma } from '@clasificador/db';
import { migrateDeploy } from '@clasificador/db/migrate';
import { applySeed } from '@clasificador/db/seed';

import {
  classify,
  createLlmClassifier,
  createPrismaLlmSettingRepository,
  createPrismaRuleRepository,
  createLiveModeWarner,
  createPrismaThreadRepository,
  readCategoryModes,
} from './classify';
import {
  ConfigError,
  assertSupportedMode,
  loadConfig,
  resolveGraphSettings,
  type Config,
} from './config';
import { extractEmail } from './extract/extract-email';
import { createGraphClient, type GraphClient } from './graph/client';
import { createHealthServer, evaluateLoopLiveness } from './health';
import { createHeartbeat } from './heartbeat';
import { createPrismaDecisionStore } from './jobs/decision-store';
import {
  createBoss,
  enqueueMessage,
  registerCleanupWorker,
  registerPanelWorkers,
  registerProcessWorker,
  registerTestClassifyWorker,
  setupQueues,
} from './jobs/queues';
import { createPrismaReprocessStore } from './jobs/reprocess';
import { describeSeed } from './seed-report';
import { INBOX_SYNC_ID, syncInbox } from './sync/delta';
import { acquireInstanceLock, type InstanceLock } from './sync/instance-lock';
import { createMasterCategoriesProvider } from './sync/master-categories';
import { createPoller, type Poller } from './sync/poller';
import { createPrismaSyncStore } from './sync/prisma-store';

export interface WorkerOverrides {
  /** Cliente de Graph ya construido (pruebas de integración); por defecto se crea con el certificado. */
  graph?: GraphClient;
  /** Se invoca ante un fallo irrecuperable (p. ej. se pierde el bloqueo). Por defecto termina el proceso. */
  onFatal?: (err: Error) => void;
}

/** Un bucle de sincronización que lleva más de esto sin avanzar se da por colgado (el contenedor se reinicia). */
const MIN_LOOP_STALL_MS = 15 * 60_000;

export interface RunningWorker {
  /** Puerto real de /health (útil con HEALTH_PORT=0). */
  healthPort: number;
  stop(): Promise<void>;
}

/** Arranca el servicio completo. Con `MODE=live` se niega a empezar. */
export async function startWorker(
  config: Config,
  overrides: WorkerOverrides = {},
): Promise<RunningWorker> {
  assertSupportedMode(config);
  // El cliente compartido lee DATABASE_URL del entorno; ya está validada arriba.
  process.env.DATABASE_URL = config.DATABASE_URL;

  // Mientras no esté todo en marcha, /health explica por qué responde 503.
  let inactiveReason: string | null = 'arrancando';
  // `/livez` no responde bien hasta que están aplicadas las migraciones y listas las colas.
  let ready = false;
  let poller: Poller | null = null;
  const db = prisma();
  const server = createHealthServer({
    version: config.APP_VERSION,
    commit: config.APP_COMMIT,
    mode: config.MODE,
    staleMs: config.SYNC_STALE_SECONDS * 1000,
    getCategoryModes: () => readCategoryModes(db),
    getInactiveReason: () => inactiveReason,
    getLiveness: () =>
      ready
        ? evaluateLoopLiveness(
            poller?.lastActivityAt() ?? null,
            new Date(),
            Math.max(config.POLL_INTERVAL_SECONDS * 10_000, MIN_LOOP_STALL_MS),
          )
        : { ok: false, reason: inactiveReason ?? 'arrancando' },
    getLastError: () => poller?.lastError() ?? null,
    getLastSyncAt: async () =>
      (await db.syncState.findUnique({ where: { id: INBOX_SYNC_ID } }))?.lastSyncAt ?? null,
  });
  await new Promise<void>((resolve) => server.listen(config.HEALTH_PORT, '0.0.0.0', resolve));
  const healthPort = (server.address() as AddressInfo).port;
  console.log(
    `Worker ${config.APP_VERSION} (${config.APP_COMMIT}, MODE=${config.MODE}) en marcha; /health en el puerto ${healthPort}.`,
  );

  // Una sola instancia: la anterior (p. ej. en un redespliegue) suelta el bloqueo al terminar.
  let stopping = false;
  inactiveReason = 'esperando el bloqueo de instancia única';
  const lock: InstanceLock | null = await acquireInstanceLock(config.DATABASE_URL, {
    onWaiting: () => console.log('Hay otra instancia del worker activa; se espera a que termine.'),
    onLost: (err) => {
      if (stopping) return;
      console.error('Se perdió la conexión que sostiene el bloqueo de instancia única:', err);
      (overrides.onFatal ?? (() => process.exit(1)))(err);
    },
  });
  if (!lock) throw new Error('No se pudo obtener el bloqueo de instancia única.');

  inactiveReason = 'aplicando migraciones';
  console.log('Aplicando migraciones...');
  console.log((await migrateDeploy(config.DATABASE_URL)).trim());

  // Reglas por defecto, administrador inicial y modelo: solo se inserta lo que falta.
  inactiveReason = 'aplicando los datos iniciales';
  const seeded = await applySeed(db, { adminEmail: config.ADMIN_EMAIL });
  const seedReport = describeSeed(seeded);
  console.log(seedReport.info);
  if (seedReport.warning) console.error(seedReport.warning);

  inactiveReason = 'iniciando la cola de trabajos';
  const boss = createBoss(config.DATABASE_URL);
  await setupQueues(boss);
  await registerCleanupWorker(boss, db);
  // La prueba de modelos del panel funciona aunque aún no haya credenciales de Graph.
  await registerTestClassifyWorker(boss, {
    keys: config,
    confidenceThreshold: config.CLASSIFY_CONFIDENCE_THRESHOLD,
  });

  const graphSettings = resolveGraphSettings(config);
  // El certificado de Graph solo lo tiene el worker: las categorías del buzón que pide el panel
  // (leer, crear) y el reproceso pasan por aquí, aunque no haya credenciales.
  const graph: GraphClient | null =
    'missing' in graphSettings
      ? null
      : (overrides.graph ?? createGraphClient(graphSettings.settings));
  await registerPanelWorkers(boss, {
    categories:
      'missing' in graphSettings
        ? { missing: graphSettings.missing }
        : { graph: graph as GraphClient, mailbox: graphSettings.settings.mailbox },
    reprocess: createPrismaReprocessStore(db),
    enqueue: (messageId) => enqueueMessage(boss, messageId),
  });

  if (graph === null || 'missing' in graphSettings) {
    const missing = 'missing' in graphSettings ? graphSettings.missing : [];
    inactiveReason = `sin credenciales de Graph (faltan: ${missing.join(', ')})`;
    console.warn(`${inactiveReason}. El worker no sincroniza el buzón hasta que se configuren.`);
  } else {
    const mailbox = graphSettings.settings.mailbox;
    const availableCategories = createMasterCategoriesProvider({ graph, mailbox });
    const llm = createLlmClassifier({
      settings: createPrismaLlmSettingRepository(db),
      keys: config,
    });
    const rules = createPrismaRuleRepository(db);
    const threads = createPrismaThreadRepository(db);
    const warnLiveCategories = createLiveModeWarner();

    await registerProcessWorker(
      boss,
      {
        mode: config.MODE,
        store: createPrismaDecisionStore(db),
        availableCategories,
        extract: (messageId) =>
          extractEmail(messageId, {
            graph,
            mailbox,
            db,
            docling: {
              url: config.DOCLING_URL,
              maxPages: config.ATTACHMENT_MAX_PAGES,
              timeoutSeconds: config.DOCLING_TIMEOUT_SECONDS,
            },
            maxAttachmentBytes: config.ATTACHMENT_MAX_BYTES,
          }),
        classify: async (email, categories) => {
          // Solo informativo: un fallo al leer el modo por categoría no debe frenar la clasificación.
          await readCategoryModes(db).then(warnLiveCategories, (err: unknown) =>
            console.error('No se pudo leer CategorySetting:', err),
          );
          return classify(email, {
            availableCategories: categories,
            mode: config.MODE,
            rules,
            threads,
            llm,
            confidenceThreshold: config.CLASSIFY_CONFIDENCE_THRESHOLD,
            internalDomains: config.INTERNAL_EMAIL_DOMAINS,
          });
        },
      },
      config.WORKER_CONCURRENCY,
    );

    const syncStore = createPrismaSyncStore(db);
    poller = createPoller({
      intervalMs: config.POLL_INTERVAL_SECONDS * 1000,
      heartbeat: createHeartbeat({ url: config.UPTIME_KUMA_PUSH_URL }),
      runCycle: () =>
        syncInbox({
          graph,
          mailbox,
          store: syncStore,
          enqueue: (messageId) => enqueueMessage(boss, messageId),
        }),
    });
    poller.start();
    inactiveReason = null;
    console.log(
      `Sincronizando ${mailbox} cada ${config.POLL_INTERVAL_SECONDS} s ` +
        `(concurrencia ${config.WORKER_CONCURRENCY}).`,
    );
  }
  ready = true;

  return {
    healthPort,
    async stop() {
      if (stopping) return;
      stopping = true;
      await poller?.stop();
      await boss.stop({ graceful: true, timeout: 30_000 }).catch(console.error);
      await lock.release();
      await new Promise((resolve) => server.close(resolve));
      await db.$disconnect();
    },
  };
}

async function main(): Promise<void> {
  const worker = await startWorker(loadConfig());
  const shutdown = (signal: string): void => {
    console.log(`${signal} recibida, cerrando.`);
    void worker.stop().then(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

// Solo arranca cuando se ejecuta como programa; las pruebas importan `startWorker`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(
      'El worker no ha podido arrancar:',
      err instanceof ConfigError ? err.message : err,
    );
    process.exit(1);
  });
}
