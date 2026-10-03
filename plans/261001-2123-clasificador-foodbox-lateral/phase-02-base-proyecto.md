---
title: "Phase 2: Base del proyecto e infraestructura"
status: done
effort: 1.5d
---

# Phase 2: Base del proyecto e infraestructura

## Estado

**Hecha** (no tenía validación pendiente con datos reales). Se construyó el monorepo pnpm, el
esquema Prisma con sus migraciones, los Dockerfiles de web y worker para arm64 con `HEALTHCHECK`,
`infra/docker/compose.dev.yml` para desarrollo local y la limpieza diaria de texto de adjuntos.
Las decisiones están en [docs/adr/](../../docs/adr/README.md) (0009, 0016 y 0017).

## Overview

Monorepo pnpm con la forma habitual de los proyectos del mismo servidor (`apps/web`,
`apps/worker`, `packages/db`), con un `docker-compose` **solo para desarrollo local**
(`infra/docker/compose.dev.yml`) y Dockerfiles por app que generan las imágenes que luego usará
Dokploy como servicios independientes.

## Key Insights

- Otro proyecto del mismo servidor usa Prisma 6 y Next.js 15: se copian sus patrones y
  configuración donde conviene.
- Prisma 7 ya no lleva motor en Rust: usa el adaptador `@prisma/adapter-pg` con `pg`, que funciona
  en arm64. Se validó en la fase: se usa la 7 ([ADR 0016](../../docs/adr/0016-prisma-7-y-monorepo.md)).
- `ghcr.io/docling-project/docling-serve-cpu` se publica para `linux/amd64` y
  `linux/arm64` (comprobado en el registro el 2026-10-01).
- pg-boss usa el mismo PostgreSQL: no hace falta Redis.
- En Dokploy no se usa Compose: cada pieza es un servicio independiente, como en el otro proyecto
  del servidor. Ver la fase 6.
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
`README.md`, `docs/adr/`, `.gitignore`.

## Implementation Steps

1. `git init`, rama `feat/clasificador-foodbox-lateral`.
2. Workspace pnpm, ESLint, Prettier y Vitest.
3. `packages/db` con Prisma, primera migración y cliente compartido.
4. `infra/docker/compose.dev.yml` para local: `worker`, `web`, `postgres`, `docling` (con límite de 4 GB y sin puertos publicados). Perfil opcional `ollama`. No se usa en Dokploy.
5. `Dockerfile` multi-etapa por app, con imagen `linux/arm64`, usuario sin privilegios y `HEALTHCHECK` en **las dos** apps: la web contra `/api/health` y el worker contra su `/livez`. Las migraciones (`prisma migrate deploy`) se ejecutan al arrancar el worker.
6. Configuración validada con Zod en cada app.
7. Trabajo programado diario que borra el texto de adjuntos con más de 90 días.
8. Registro de las decisiones ya tomadas (hoy en `docs/adr/`).

## Todo

- [x] Monorepo y tooling
- [x] Esquema Prisma y primera migración
- [x] compose.dev levanta los servicios en local
- [x] Dockerfiles de web y worker construyen para arm64, con HEALTHCHECK en ambos
- [x] Limpieza de 90 días
- [x] README y registros de decisión

## Success Criteria

`docker compose up` arranca; `pnpm test` y `pnpm lint` pasan; `prisma migrate
deploy` crea las tablas; el worker llega a `docling:5001/health`.

## Risk Assessment

Diferencia de versión de Prisma con el otro proyecto del servidor: decidida y registrada en el ADR 0016.
