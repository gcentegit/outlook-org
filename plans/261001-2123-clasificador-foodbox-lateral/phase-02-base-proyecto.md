---
title: "Phase 2: Base del proyecto e infraestructura"
status: done
effort: 1.5d
---

# Phase 2: Base del proyecto e infraestructura

## Overview

Monorepo pnpm con la misma forma que CPA (`apps/web`, `apps/worker`,
`packages/db`), con un `docker-compose` **solo para desarrollo local** (como
`infra/docker/compose.dev.yml` de CPA) y Dockerfiles por app que generan las
imágenes que luego usará Dokploy como servicios independientes.

## Key Insights

- CPA usa Prisma 6 en `packages/db` y Next.js 15 en `apps/web`
  (`/home/ubuntu/proyectos/CPA`): se copian sus patrones y configuración.
- Prisma 7 ya no lleva motor en Rust: usa el adaptador `@prisma/adapter-pg` con
  `pg`, que funciona en arm64. Se valida en la fase si se usa 7 o se iguala a la
  versión de CPA.
- `ghcr.io/docling-project/docling-serve-cpu` se publica para `linux/amd64` y
  `linux/arm64` (comprobado en el registro el 2026-10-01).
- pg-boss usa el mismo PostgreSQL: no hace falta Redis.
- En Dokploy no se usa Compose: cada pieza es un servicio independiente, como en
  el proyecto `cpa.arcofood` (aplicaciones web/api/worker/clamav + PostgreSQL y
  Redis nativos). Ver la fase 6.
- Servidor: 4 CPU y unos 23 GiB de RAM con 3,7 GiB en uso (Dokploy, 2026-10-02).

## Requirements

- Node 22, pnpm workspaces, TypeScript estricto, Zod para configuración.
- Modelos Prisma: `SyncState` (deltaLink), `Message` (id, conversationId,
  remitente, asunto, fecha, categorías vistas), `AttachmentText` (hash,
  Markdown, método texto/OCR, caducidad 90 días), `Rule`, `Decision` (JSON del
  clasificador, modelo y coste), `Correction`, `LlmSetting` (proveedor y modelo
  activos), `AllowedUser`.

## Related Code Files

Crear: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`,
`apps/worker/` y `apps/web/` (cada una con su `Dockerfile`), `infra/docker/compose.dev.yml`, `.env.example`,
`README.md`, `docs/DECISIONS.md`, `.gitignore`.

## Implementation Steps

1. `git init`, rama `feat/clasificador-foodbox-lateral`.
2. Workspace pnpm, ESLint, Prettier y Vitest con la configuración de CPA.
3. `packages/db` con Prisma, primera migración y cliente compartido.
4. `infra/docker/compose.dev.yml` para local: `worker`, `web`, `postgres`, `docling` (con límite de 4 GB y sin puertos publicados). Perfil opcional `ollama`. No se usa en Dokploy.
5. `Dockerfile` multi-etapa por app, con imagen `linux/arm64`, usuario sin privilegios y `HEALTHCHECK` en **las dos** apps: la web contra `/api/health` y el worker contra su `/health`, que falla si la última sincronización con el buzón tiene más de 5 minutos. Las migraciones (`prisma migrate deploy`) se ejecutan al arrancar el worker.
6. Configuración validada con Zod en cada app.
7. Trabajo programado diario que borra el texto de adjuntos con más de 90 días.
8. `docs/DECISIONS.md` con las decisiones ya tomadas.

## Todo

- [x] Monorepo y tooling
- [x] Esquema Prisma y primera migración
- [x] compose.dev levanta los servicios en local
- [x] Dockerfiles de web y worker construyen para arm64, con HEALTHCHECK en ambos
- [x] Limpieza de 90 días
- [x] README y DECISIONS

## Success Criteria

`docker compose up` arranca; `pnpm test` y `pnpm lint` pasan; `prisma migrate
deploy` crea las tablas; el worker llega a `docling:5001/health`.

## Risk Assessment

Diferencia de versión de Prisma con CPA: decidir al empezar y dejarlo en DECISIONS.
