# Informe: Fase 2, base del monorepo e infraestructura local

Fecha: 2026-10-02. Estado: completada. No se ha hecho ningún commit, push, ni se ha tocado Dokploy ni Microsoft 365.

## Qué se hizo

- `git init` en la rama `feat/clasificador-foodbox-lateral`, con `.gitignore` y `.dockerignore`. El `.env` local queda ignorado.
- Monorepo pnpm 11: `apps/web` (Next 15.5, página y `/api/health`), `apps/worker` (migraciones al arrancar, `/health` en el 8080, función de limpieza), `packages/db` (Prisma 7.10 + adapter-pg) y `packages/shared` (esquema Zod de la decisión, categorías, `normalizeCif`).
- Prisma: 9 modelos (SyncState, Message, AttachmentText, Rule, Decision, Correction, LlmSetting, AllowedUser, CategoryAudit) y primera migración `20261002145444_inicial`.
- Semilla idempotente: 14 reglas (7 CIF y 7 razones sociales, peso fuerte), `<ADMIN_EMAIL>` y `anthropic / claude-haiku-4-5-20251001`. Un test comprueba que los datos coinciden con `docs/sociedades-categorias.md`.
- Configuración con Zod en worker y web; `.env.example` documentado.
- `infra/docker/compose.dev.yml` (proyecto `clasificador-dev`): postgres 5442, docling con límite 4g y 127.0.0.1:5101, worker (sin puertos), web, perfil `ollama`.
- Dockerfiles multietapa de web y worker, usuario `node`, `HEALTHCHECK` en ambos.
- `deleteExpiredAttachmentTexts` en el worker, con test (sin programar; eso es de la fase 6).
- ESLint 9, Prettier, Vitest; scripts raíz `lint`, `test`, `typecheck`, `build`.
- `README.md` y `docs/DECISIONS.md`.

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm install` | OK (hubo que aprobar scripts de build en `pnpm-workspace.yaml`, `allowBuilds`) |
| `pnpm lint` | OK |
| `pnpm typecheck` | OK en los 4 paquetes |
| `pnpm test` | 24 tests pasan (shared 8, web 3, db 2, worker 11) |
| `pnpm build` | OK (Next compila, genera standalone) |
| `pnpm db:seed` (dos veces) | "14 reglas (7 de CIF)", sin duplicar; AllowedUser y LlmSetting presentes |
| `prisma migrate deploy` en una base vacía (vía worker) | "All migrations have been successfully applied", 9 tablas + `_prisma_migrations` |
| `docker build` worker y web (arm64) | Terminan. Web 431 MB, worker 1,86 GB |
| Worker `/health` en el contenedor | 503 `{"status":"stale","lastSyncAt":null,...}`; con una fila `SyncState` reciente, 200; después borrada |
| Web `/api/health` | 200 `{"status":"ok","version":"dev"}` |
| Worker a `docling:5001/health` | 200 `{"status":"ok"}` |
| Estado de los 4 contenedores | los 4 `healthy`; docling ~1,8 GiB de 4 GiB |

## Decisiones (detalle en docs/DECISIONS.md)

- Prisma 7.10.0 con adapter-pg y generador `prisma-client`: funciona en arm64. Solo el motor de migraciones es binario. No se usa Prisma 8 (el `latest` es una rc).
- Imágenes sobre `node:22-bookworm-slim`, no Alpine, para evitar problemas de musl con el motor de Prisma.
- Sin Turborepo (`pnpm -r`) y un único `eslint.config.mjs`.
- `Decision.categories` (text[]) duplica el JSON para poder contar en el panel; `source` admite también `thread`; categorías como texto, no enum.
- Solo un `LlmSetting` activo: lo debe garantizar la aplicación (fase 7), no un índice parcial.

## Desviaciones y avisos

- **El puerto 3100 del host ya estaba ocupado** por un `next dev` de otro proyecto de la máquina (no es mío, no se ha tocado). El compose publica la web en `${WEB_HOST_PORT:-3100}`; para probar usé 3110 en mi `.env` local (ignorado por git). El `.env.example` deja 3100.
- El 3100 por defecto fallará mientras ese proceso siga vivo; hay que cambiar `WEB_HOST_PORT` o pararlo (decisión del usuario).
- La imagen del worker es grande (1,86 GB) porque `prisma` (CLI) es dependencia de producción para ejecutar `migrate deploy` al arrancar. Se puede reducir más adelante.
- No pude usar Context7 (la herramienta no estaba disponible en esta sesión); la API de Prisma 7 se validó empíricamente con generate, migrate y el build de Docker.

## Estado de procesos y recursos

- Levantado y parado: proyecto compose `clasificador-dev` con `down`. Quedan el volumen `clasificador-dev_clasificador_pg_data` (con las migraciones y la semilla) y las imágenes `clasificador-dev-web`, `clasificador-dev-worker` y `ghcr.io/docling-project/docling-serve-cpu` (~7,2 GB, arm64, descargada y comprobada).
- Los puertos 5442, 3110 y 5101 están libres. No se tocó ningún contenedor ni servicio ajeno.

## Pendiente

- Programar la limpieza diaria con pg-boss (fase 6).
- Los ficheros `docs/guia-entra-id-rbac.md` e `infra/scripts/generate-cert.sh` son del otro agente; no se han tocado.
- Marcar el estado de la fase 2 en el plan lo hace el orquestador (no edité `plans/`).
- Sin commits: todo está sin añadir en la rama nueva.
