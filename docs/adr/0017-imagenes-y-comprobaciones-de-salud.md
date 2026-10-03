# 0017. Imágenes, comprobaciones de salud y puertos

- **Estado:** aceptada

## Contexto

Las imágenes de la web y del worker se despliegan en un servidor arm64 con Docker Swarm (Dokploy).
Una comprobación de salud mal elegida provoca reinicios en bucle o servicios que nunca se ven
sanos.

## Decisión

- Imágenes sobre `node:22-bookworm-slim` (glibc), no Alpine: el motor de migraciones de Prisma y
  `tsx` no dan sorpresas de musl. A cambio pesan más (web ~430 MB, worker ~1,9 GB). Usuario `node`
  sin privilegios y `HEALTHCHECK` por `fetch` de Node, sin `curl`. Cada imagen es `linux/arm64`.
- **Dos comprobaciones en el worker**, con propósitos distintos:
  - **`/livez`** (la del `HEALTHCHECK` de Docker y Swarm): 200 cuando el proceso ha arrancado del
    todo (migraciones, datos iniciales y colas listos; `start-period` de 120 s) y el bucle de
    sincronización avanza (no lleva más de 15 minutos, o 10 intervalos, sin empezar o terminar una
    ronda). **No mide a Graph**: si Graph o Entra caen no hay reinicios en bucle.
  - **`/health`** (para Uptime Kuma y personas): 200 solo si la última sincronización correcta
    tiene menos de `SYNC_STALE_SECONDS` (300 s); 503 si es antigua, no hay, la base de datos no
    responde, faltan credenciales (`status: "disabled"`) o espera el bloqueo. Incluye `version`,
    `mode`, `lastSyncAt`, `categoryModes` y, si no está sano, `reason`.
- La web usa `GET /api/health`, con `version`.
- `version` es la `APP_VERSION` horneada en la imagen; no se introduce una variable `IMAGE_TAG`
  aparte porque la web y el Dockerfile ya usan `APP_VERSION`.
- **Heartbeat:** `UPTIME_KUMA_PUSH_URL` opcional; `status=up` tras cada ronda correcta y
  `status=down` con el error si falla. Nunca interrumpe la sincronización.
- **Puertos de desarrollo:** PostgreSQL 5442, docling 5101 y web 3110 (`WEB_HOST_PORT`); el 3000,
  3001 y 5432 los usan otros proyectos de la máquina. Todos escuchan solo en 127.0.0.1.

## Consecuencias

- El worker se puede desplegar y verse sano sin credenciales de Graph.
- Un `/health` en 503 con `disabled` es lo esperado sin credenciales; no es un fallo del
  contenedor.
