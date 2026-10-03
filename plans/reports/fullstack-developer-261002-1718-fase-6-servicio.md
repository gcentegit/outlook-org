# Fase 6: servicio en modo sombra y despliegue en Dokploy

Fecha: 2026-10-02. Estado: hecho en local. No se ha ejecutado nada contra Dokploy, Microsoft 365 ni GitHub; sin commits ni push. `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en verde (worker: 224 tests + 2 de integración que se saltan salvo con `RUN_INTEGRATION=1`; `infra/dokploy`: 23). `actionlint` (con shellcheck) pasó limpio sobre los dos workflows, ejecutado desde la imagen Docker `rhysd/actionlint`, que borré después (no está instalado en la máquina).

## Qué hay

Worker (`apps/worker/src`):

| Fichero | Contenido |
| --- | --- |
| `sync/delta.ts` | `syncInbox`: delta de la Bandeja de entrada, primera pasada sin histórico, nextLink/deltaLink, 410, `@removed` |
| `sync/prisma-store.ts`, `sync/poller.ts`, `sync/master-categories.ts` | persistencia en `SyncState`, bucle secuencial con heartbeat, lista maestra con caché de 5 min |
| `sync/instance-lock.ts` | bloqueo asesor de PostgreSQL en conexión dedicada de `pg`; espera si lo tiene otra instancia |
| `jobs/queues.ts`, `jobs/process-message.ts`, `jobs/decision-store.ts` | pg-boss: `process-message` (5 reintentos con backoff, `singletonKey`, idempotente) y limpieza diaria 03:30 Madrid |
| `corrections.ts` | detección de correcciones (sombra: todo cambio es del equipo; live: se ignora lo propio) |
| `heartbeat.ts` | push a Uptime Kuma, opcional, nunca lanza |
| `index.ts`, `config.ts`, `health.ts` | `startWorker` exportable (el `main` solo corre si es el programa), `MODE`, `POLL_INTERVAL_SECONDS`, `WORKER_CONCURRENCY`, `UPTIME_KUMA_PUSH_URL`, `ConfigError`; `/health` con `status`, `version`, `mode`, `lastSyncAt` y `reason` |
| `shadow-service.integration.test.ts` | integración (ver abajo) |

Infra: `.github/workflows/ci.yml` y `release.yml`; `infra/dokploy/{provision.ts,provision.test.ts,README.md,package.json,tsconfig.json}`; `infra/scripts/restore-check.sh`; `docs/DECISIONS.md` (sección nueva, con el motivo de cada decisión); `.env.example` (MODE, POLL_INTERVAL_SECONDS, WORKER_CONCURRENCY, UPTIME_KUMA_PUSH_URL).

## Verificado

- **Integración local** (postgres 5442 + docling 5101, cliente `GraphClient` real con `fetch` simulado, PDFs generados): con `RUN_INTEGRATION=1 pnpm --filter @clasificador/worker exec vitest run src/shadow-service.integration.test.ts` (con `.env` cargado). Resultado: 3 correos nuevos entran por la delta, docling extrae el CIF de los PDF, quedan `Message`, `AttachmentText` y `Decision` con `mode=shadow` (FOOD BOX por CIF, LATERAL por CIF, sin categoría y en revisión para el correo sin señal). Un cambio de categorías posterior del equipo genera la `Correction` (propuesto FOOD BOX, final LATERAL, con `decisionId`) y actualiza `seenCategories`. Una segunda instancia no obtiene el bloqueo. `/health` da 200 con la versión. Un segundo test arranca el worker dos veces seguidas sin credenciales (comprueba que las colas de pg-boss ya existentes no dan error) y `/health` da 503 `disabled` con el motivo. Los dos limpian lo que crean (filas `it-*`, `AttachmentText`, `SyncState`, esquema `pgboss`); la BD de dev quedó con 0 filas en Message/Decision/Correction/SyncState.
- Arranque real con `tsx src/index.ts` (sin credenciales): migra, `/health` 503 `disabled` con `reason`, SIGTERM cierra con código 0. Con `MODE=live` sale con el mensaje claro y sin traza. Los procesos que arranqué están parados; no toqué los contenedores de dev ni los procesos de CPA.
- `restore-check.sh --from-file` probado contra un `pg_dump` de la BD local en formato custom, custom+gzip y SQL plano: pasa; con los mínimos por defecto falla (0 filas en Message/Decision), como debe; el contenedor temporal se borra siempre. La parte MinIO (`mc` en contenedor, sin credenciales) solo está probada en sintaxis y en la construcción de la URL con `jq`.
- `provision.ts`: 23 pruebas con un Dokploy simulado en memoria (diferencias, `--apply` desde cero, idempotencia: la segunda pasada no escribe nada, deriva, variables ajenas conservadas, ningún secreto impreso, destino de copias inexistente, etc.). `node infra/dokploy/provision.ts --dry-run` sin credenciales muestra los 19 cambios de un Dokploy vacío. No se ha probado contra un Dokploy real.

## Decisiones y desviaciones (detalle en DECISIONS.md)

- Delta sin `changeType`: una sola corriente; creado vs actualizado se decide por la BD. El filtro `receivedDateTime ge` de la primera ronda (ahora - 1 min) evita el histórico y deja el `deltaLink` listo.
- `IMAGE_TAG` no existe: `/health` devuelve `APP_VERSION` (el sha corto horneado por el build), que es lo que ya usan la web y el Dockerfile.
- `release.yml` busca las aplicaciones de Dokploy por nombre (`project.all`) en vez de un secreto `DOKPLOY_APP_IDS`. También acepta `workflow_dispatch` con la etiqueta para volver atrás.
- Endpoints y campos de Dokploy verificados en docs.dokploy.com (application.create/saveDockerProvider/update/deploy/saveEnvironment, postgres.create/update/saveExternalPort/deploy, domain.create/update, mounts.create/update/listByServiceId, backup.create/update, destination.all, project.create/all). La memoria va en bytes sin sufijos y la salud de Swarm en nanosegundos (documentado por Dokploy). Lo que **no** pude verificar sin credenciales: la forma exacta de `application.one`/`postgres.one` (p. ej. si `healthCheckSwarm` vuelve normalizado distinto; si no, el primer `--dry-run` mostrará diferencias falsas que habrá que ajustar) y que `application.create` devuelva `appName` (el script lo relee con `application.one`).

## Cambios fuera de la lista de ficheros (necesarios)

- `apps/worker/package.json` + `pnpm-lock.yaml`: dependencia directa `pg` (bloqueo de instancia única en conexión dedicada; Prisma no puede sostener un bloqueo de sesión) y `@types/pg`. Solo cambia el importador del worker en el lock.
- `pnpm-workspace.yaml`: añadido `infra/dokploy` como paquete, para que sus pruebas, tipos y lint entren en `pnpm test/typecheck/lint`. Verifiqué que `pnpm install --frozen-lockfile --prod --filter @clasificador/worker...` funciona en un árbol sin ese directorio (como en el Dockerfile, que no copia `infra`). No construí las imágenes completas.
- `plans/261001-2123-clasificador-foodbox-lateral/phase-06-servicio-sombra.md`: marcadas las tareas hechas (no las de despliegue real).
- Ejecuté `prettier --write` sobre `apps/worker/src` entero en un momento dado; puede haber reformateado algún fichero de `src/history` del otro agente (solo formato, sin cambios de contenido; no tengo historial git para confirmarlo).

## Pendiente / a tener en cuenta

1. **No despliegues el worker hasta tener las credenciales de Graph**: el `HEALTHCHECK` de Swarm usa `/health`, que responde 503 sin credenciales, y Swarm lo reiniciaría en bucle. Está documentado en el README de `infra/dokploy`.
2. Servicio con actualización `stop-first` (el valor por defecto): con `start-first` la instancia nueva esperaría el bloqueo y nunca sería saludable.
3. Si el repositorio de GitHub es privado: secretos `GHCR_PULL_USERNAME`/`GHCR_PULL_TOKEN` (token `read:packages`) y, en `provision.ts`, `GHCR_USERNAME`/`GHCR_TOKEN`. El runner `ubuntu-24.04-arm` es gratuito en repos públicos; en privados puede costar.
4. `README.md` raíz dice que el `/health` del worker devuelve 503 "sin la fase de sincronización" y su tabla describe el worker como "migraciones y /health": ya está desactualizado (no está en mi lista; conviene una línea).
5. Variables del panel: documenté las que lee `apps/web/src/lib/panel-env.ts` y `BETTER_AUTH_*` hoy; si el agente del panel añade otras, hay que sumarlas a `buildEnv` en `provision.ts`.
6. Docling fijado a `v1.36.0` (verifiqué con `docker manifest inspect` que la etiqueta existe y tiene arm64).
7. Limitación conocida: un cambio de categorías del equipo antes de que acabe el trabajo del correo no cuenta como corrección (el trabajo lee ya las categorías nuevas y las trata como puestas por el equipo al llegar). Documentado.
8. Sin cambios en `schema.prisma`.
9. Los datos mensuales: `restore-check.sh` no está programado en ningún cron/Actions; falta decidir dónde se ejecuta cada mes (necesita Docker y las credenciales de MinIO).

Status: DONE_WITH_CONCERNS
Summary: Servicio en modo sombra completo (delta, pg-boss, correcciones, heartbeat, /health, bloqueo de instancia única), con CI/release a GHCR, `provision.ts` idempotente (dry-run/apply), README de Dokploy y `restore-check.sh`; todo probado en local (integración con docling real y BD local) y lint/typecheck/test/build en verde, sin tocar Dokploy ni M365.
Concerns/Blockers: `provision.ts` no se ha probado contra un Dokploy real (formas de `application.one`/`postgres.one` sin verificar); el worker no debe desplegarse sin credenciales de Graph por el healthcheck; cambios fuera de lista: dependencia `pg`, `pnpm-workspace.yaml` y lockfile; README raíz desactualizado.
