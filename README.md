# Clasificador del buzón de Proveedores

Servicio y panel que detectan los correos del buzón configurado en `MAILBOX` que corresponden a **FOOD BOX**, **LATERAL** o **ARCOBETA**, y les aplican esa categoría con Microsoft Graph. Contexto y plan: [docs/sociedades-categorias.md](docs/sociedades-categorias.md) y [plans/261001-2123-clasificador-foodbox-lateral/plan.md](plans/261001-2123-clasificador-foodbox-lateral/plan.md). Decisiones de arquitectura: [docs/DECISIONS.md](docs/DECISIONS.md).

## Estructura

| Ruta                           | Contenido                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                     | Panel (Next.js 15, App Router): métricas, discrepancias, modelos, categorías, configuración y `GET /api/health`.                                                                                             |
| `apps/worker`                  | Worker (Node 22 + TypeScript). Migraciones, datos iniciales, sincronización del buzón en modo sombra, clasificador, categorías del buzón para el panel y `GET /livez` y `GET /health` (puerto interno 8080). |
| `packages/db`                  | Esquema Prisma 7, migraciones, semilla y cliente compartido.                                                                                                                                                 |
| `packages/shared`              | Esquema Zod de la decisión del clasificador, categorías y normalización de CIF.                                                                                                                              |
| `infra/docker/compose.dev.yml` | PostgreSQL, docling, worker y web, **solo para desarrollo local**.                                                                                                                                           |

## Requisitos

Node 22, pnpm 11 (`corepack enable`) y Docker con Compose.

## Puesta en marcha local

```bash
pnpm install
cp .env.example .env            # ajusta la clave de PostgreSQL; el .env no se sube al repositorio
pnpm services:up                # PostgreSQL :5442, docling :5101, worker y web (WEB_HOST_PORT, 3110 por defecto)
pnpm db:migrate:deploy          # crea las tablas (el worker también lo hace al arrancar)
pnpm db:seed                    # 14 reglas (7 CIF + 7 razones sociales), usuario autorizado y modelo LLM por defecto (el worker también lo hace al arrancar, solo insertando lo que falta)
```

Comprobaciones:

```bash
curl http://127.0.0.1:3110/api/health        # web: {"status":"ok","version":"dev"}
docker compose -p clasificador-dev exec worker node -e \
  "fetch('http://127.0.0.1:8080/health').then(async r=>console.log(r.status, await r.text()))"
```

El worker expone dos comprobaciones. **`/livez`** (la del `HEALTHCHECK` de Docker y Swarm) responde 200 si el proceso ha arrancado del todo (migraciones y datos iniciales aplicados) y su bucle avanza; no mide a Graph, así que una caída de Graph no reinicia el contenedor en bucle. **`/health`** refleja la sincronización real con el buzón: **200 solo si la última sincronización correcta (`SyncState.lastSyncAt`) tiene menos de `SYNC_STALE_SECONDS` (300 s)**. Responde **503** si no la hay o es antigua (con `status` `stale` y el motivo en `reason`) y 503 con `"status":"disabled"` y el motivo cuando faltan las credenciales de Graph (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PATH`, `MAILBOX`): el worker arranca igualmente, no sincroniza y lo dice en el log. Sin credenciales de Graph, 503 `disabled` es lo esperado (y `/livez` responde 200). El informe incluye también `version`, `mode` y `categoryModes` (el modo de cada categoría guardado desde el panel).

Para parar todo (se conserva el volumen de datos):

```bash
pnpm services:down
```

Los puertos 3000, 3001 y 5432 del host los usan otros proyectos de esta máquina. Si el 3110 también está ocupado, cambia `WEB_HOST_PORT` en `.env`; no pares el otro proceso.

Perfil opcional de Ollama (modelos locales): `docker compose -p clasificador-dev --env-file .env -f infra/docker/compose.dev.yml --profile ollama up -d ollama`.

### Desarrollo sin contenedores para web y worker

Con PostgreSQL arriba (`docker compose ... up -d postgres`): `pnpm --filter @clasificador/worker dev` y `pnpm --filter @clasificador/web dev` (web en el 3110).

### Arrancar el servicio en modo sombra en local

El servicio solo propone categorías y guarda las decisiones; **no escribe nada en Outlook** (`MODE=shadow`, el valor por defecto; con `MODE=live` el worker se niega a arrancar).

1. PostgreSQL y docling arriba (`pnpm services:up`, o solo esos dos contenedores si vas a usar `pnpm dev`) y `pnpm db:migrate:deploy && pnpm db:seed`.
2. En `.env`, las credenciales de Graph de la guía [docs/guia-entra-id-rbac.md](docs/guia-entra-id-rbac.md): `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PATH` (ruta local al PEM) y `MAILBOX`. Sin ellas el worker arranca pero no sincroniza (`/health` 503 `disabled`).
3. En `.env`, la clave del proveedor de LLM elegido (por ejemplo `ANTHROPIC_API_KEY`); el proveedor y el modelo activos se eligen en el panel (`/modelos`). Sin clave, las reglas deciden y lo dudoso queda sin categoría.
4. `pnpm --filter @clasificador/worker dev`: sincroniza la Bandeja de entrada cada `POLL_INTERVAL_SECONDS` (90 s) y registra una `Decision` con `mode=shadow` por correo nuevo.
5. `pnpm --filter @clasificador/web dev` (puerto 3110). El login con Microsoft necesita las variables `MS_*` y `BETTER_AUTH_SECRET` del `.env.example`; para ver el panel sin Microsoft, arranca con `AUTH_DEV_BYPASS=true pnpm --filter @clasificador/web dev` (solo funciona con `next dev`; entra como el primer usuario autorizado).

El botón **Probar** de `/modelos` encola un trabajo `test-classify` que atiende el worker: necesita el worker en marcha (aunque no tenga credenciales de Graph) y la clave del proveedor probado en el entorno del worker. Lo mismo ocurre con `/categorias`: **el panel no tiene credenciales de Graph**; leer y crear las categorías del buzón se lo pide al worker (`list-master-categories`, `create-master-category`). Sin worker o sin credenciales, la pantalla muestra el motivo.

### Reprocesar correos con fallos técnicos

Si docling o el LLM fallan, el trabajo se reintenta y, si sigue fallando, el correo queda marcado para reprocesar. El Resumen del panel cuenta pendientes, fallidos y marcados, y tiene el botón **Reprocesar**. Por línea de órdenes: `pnpm --filter @clasificador/worker reprocess` (con `-- --dry-run` solo cuenta).

## Comandos

| Comando                             | Qué hace                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pnpm lint`                         | ESLint de todo el monorepo                                          |
| `pnpm typecheck`                    | Genera el cliente de Prisma y comprueba tipos                       |
| `pnpm test`                         | Vitest en todos los paquetes                                        |
| `pnpm build`                        | Genera el cliente de Prisma y construye la web                      |
| `pnpm format` / `pnpm format:check` | Prettier                                                            |
| `pnpm db:migrate:dev`               | Crea una migración nueva a partir del esquema (requiere PostgreSQL) |

## Imágenes

```bash
docker build -f apps/worker/Dockerfile --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t clasificador-worker .
docker build -f apps/web/Dockerfile    --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t clasificador-web .
```

Las dos son `linux/arm64` (la arquitectura del servidor), usan usuario sin privilegios y llevan `HEALTHCHECK` (web: `/api/health`; worker: `/livez`). `APP_VERSION` aparece en `/health` y `/api/health`.

## Configuración

Todas las variables están documentadas en [.env.example](.env.example) y se validan con Zod al arrancar cada app. Las claves de API de los LLM irán siempre en variables de entorno, nunca en la base de datos.
