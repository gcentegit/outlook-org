# Clasificador del buzón de Proveedores

Servicio y panel que detectan los correos del buzón configurado en `MAILBOX` que corresponden a **FOOD BOX**, **LATERAL** o **ARCOBETA**, y proponen esa categoría a partir del CIF y la razón social de la factura, de la conversación y, solo en los casos dudosos, de un modelo de lenguaje. Un panel web muestra el volumen, la cobertura y el acierto.

> **Derechos:** código propiedad de la empresa. Todos los derechos reservados; no se concede licencia de uso.

## Estado actual

- **Construido:** sincronización con el buzón, extracción de adjuntos, clasificador, panel y scripts de despliegue.
- **Sin validar con datos reales:** todo se ha probado con datos simulados. Falta el acceso al buzón real (pendiente del usuario).
- **Nada desplegado.** El servicio solo funciona en **modo sombra**: propone categorías y guarda las decisiones, pero no escribe en los correos de Outlook.

El plan, con lo hecho y lo pendiente, está en [plans/261001-2123-clasificador-foodbox-lateral/plan.md](plans/261001-2123-clasificador-foodbox-lateral/plan.md).

## Documentación

Empieza por [docs/README.md](docs/README.md). Los enlaces principales:

- [Arquitectura](docs/arquitectura.md): cómo funciona hoy.
- [Registros de decisión](docs/adr/README.md): por qué es así.
- [Operación](docs/operacion/despliegue.md): despliegue, copias y caducidades.
- [Reglas para agentes y personas](CLAUDE.md).

## Estructura

| Ruta              | Contenido                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Panel (Next.js 15, App Router): métricas, discrepancias, modelos, categorías, configuración y `GET /api/health`.                      |
| `apps/worker`     | Worker (Node 22 + TypeScript): migraciones, sincronización en modo sombra, clasificador, peticiones del panel y `/livez` y `/health`. |
| `packages/db`     | Esquema Prisma 7, migraciones, semilla y cliente compartido.                                                                          |
| `packages/shared` | Esquema Zod de la decisión, categorías y normalización de CIF.                                                                        |
| `infra/docker`    | `compose.dev.yml`: PostgreSQL, docling, worker y web, **solo para desarrollo local**.                                                 |
| `infra/dokploy`   | Alta de servicios en Dokploy (`provision.ts`) y su [README](infra/dokploy/README.md).                                                 |
| `infra/scripts`   | Generación del certificado, prueba de restauración y espera de despliegues.                                                           |
| `docs/`           | Documentación: arquitectura, ADR, guías, operación y referencia.                                                                      |
| `plans/`          | Planes y fases, informes de trabajo y diario (registros de estado, no documentación vigente).                                         |

## Requisitos

Node 22, pnpm 11 (`corepack enable`) y Docker con Compose.

## Puesta en marcha local

```bash
pnpm install
cp .env.example .env            # ajusta la clave de PostgreSQL; el .env no se sube al repositorio
pnpm services:up                # PostgreSQL :5442, docling :5101, worker y web (WEB_HOST_PORT, 3110 por defecto)
pnpm db:migrate:deploy          # crea las tablas (el worker también lo hace al arrancar)
pnpm db:seed                    # reglas por CIF y razón social, usuario autorizado y modelo por defecto
```

Comprobaciones:

```bash
curl http://127.0.0.1:3110/api/health        # web: {"status":"ok","version":"dev"}
docker compose -p clasificador-dev exec worker node -e \
  "fetch('http://127.0.0.1:8080/health').then(async r=>console.log(r.status, await r.text()))"
```

Sin credenciales de Graph, el `/health` del worker responde 503 con `"status":"disabled"`: es lo esperado. Qué mide cada comprobación: [ADR 0017](docs/adr/0017-imagenes-y-comprobaciones-de-salud.md).

Para parar todo (se conserva el volumen de datos): `pnpm services:down`.

Los puertos 3000, 3001 y 5432 del host los usan otros proyectos de esta máquina. Si el 3110 también está ocupado, cambia `WEB_HOST_PORT` en `.env`; no pares el otro proceso.

Perfil opcional de Ollama (modelos locales): `docker compose -p clasificador-dev --env-file .env -f infra/docker/compose.dev.yml --profile ollama up -d ollama`.

### Desarrollo sin contenedores para web y worker

Con PostgreSQL arriba (`docker compose ... up -d postgres`): `pnpm --filter @clasificador/worker dev` y `pnpm --filter @clasificador/web dev` (web en el 3110).

### Arrancar el servicio en modo sombra en local

El servicio solo propone categorías y guarda las decisiones; **no escribe en los correos** (`MODE=shadow`, el valor por defecto; con `MODE=live` el worker se niega a arrancar, [ADR 0004](docs/adr/0004-modo-sombra-y-activacion-por-categoria.md)).

1. PostgreSQL y docling arriba y `pnpm db:migrate:deploy && pnpm db:seed`.
2. En `.env`, las credenciales de Graph de la [guía de Entra ID y RBAC](docs/guias/entra-id-rbac.md): `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PATH` y `MAILBOX`. Sin ellas el worker arranca pero no sincroniza.
3. En `.env`, la clave del proveedor de LLM elegido (por ejemplo `ANTHROPIC_API_KEY`); el proveedor y el modelo activos se eligen en el panel (`/modelos`). Sin clave, las reglas deciden y lo dudoso queda sin categoría.
4. `pnpm --filter @clasificador/worker dev`.
5. `pnpm --filter @clasificador/web dev` (puerto 3110). El login con Microsoft necesita las variables `MS_*` y `BETTER_AUTH_SECRET` del `.env.example`; para ver el panel sin Microsoft, arranca con `AUTH_DEV_BYPASS=true pnpm --filter @clasificador/web dev` (solo con `next dev`; entra como el primer usuario autorizado).

El panel no tiene credenciales del buzón: probar modelos, listar o crear categorías y reprocesar se lo pide al worker, que debe estar en marcha ([ADR 0015](docs/adr/0015-web-sin-credenciales-del-buzon.md)).

### Reprocesar correos con fallos técnicos

Si docling o el LLM fallan, el correo queda marcado para reprocesar ([ADR 0007](docs/adr/0007-fallos-tecnicos-y-reproceso.md)). Botón **Reprocesar** en el Resumen del panel, o `pnpm --filter @clasificador/worker reprocess` (con `-- --dry-run` solo cuenta).

## Comandos

| Comando                             | Qué hace                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pnpm lint`                         | ESLint de todo el monorepo                                          |
| `pnpm typecheck`                    | Genera el cliente de Prisma y comprueba tipos                       |
| `pnpm test`                         | Vitest en todos los paquetes                                        |
| `pnpm build`                        | Genera el cliente de Prisma y construye la web                      |
| `pnpm format` / `pnpm format:check` | Prettier                                                            |
| `pnpm db:migrate:dev`               | Crea una migración nueva a partir del esquema (requiere PostgreSQL) |

Las pruebas de integración (necesitan PostgreSQL y docling locales) se lanzan a mano; el comando está en la cabecera de `apps/worker/src/shadow-service.integration.test.ts`.

## Imágenes

```bash
docker build -f apps/worker/Dockerfile --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t clasificador-worker .
docker build -f apps/web/Dockerfile    --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t clasificador-web .
```

Las dos son `linux/arm64` (la arquitectura del servidor), usan usuario sin privilegios y llevan `HEALTHCHECK`. `APP_VERSION` aparece en `/health` y `/api/health`.

## Configuración

Todas las variables están documentadas en [.env.example](.env.example) y se validan con Zod al arrancar cada app. Las claves de API de los LLM van siempre en variables de entorno, nunca en la base de datos. Las direcciones reales (`MAILBOX`, `ADMIN_EMAIL`) solo existen en variables de entorno: en la documentación se escriben `<MAILBOX>` y `<ADMIN_EMAIL>`.
