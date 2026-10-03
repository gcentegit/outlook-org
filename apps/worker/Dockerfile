# syntax=docker/dockerfile:1.7
# Worker del clasificador. Imagen linux/arm64 (también construye en amd64).
#   docker build -f apps/worker/Dockerfile \
#     --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
#     --build-arg APP_COMMIT=$(git rev-parse --short=7 HEAD) -t clasificador-worker .
# APP_VERSION es la versión del producto (X.Y.Z, la del package.json raíz) y APP_COMMIT el commit; los
# devuelven /health y /livez. Se declaran al final para no invalidar la caché de las capas pesadas.
ARG NODE_VERSION=22
ARG PNPM_VERSION=11.22.0

# ── Cliente de Prisma generado ───────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @clasificador/worker...
RUN pnpm --filter @clasificador/db generate

# ── Runtime: solo dependencias de producción ─────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ARG PNPM_VERSION
ENV NODE_ENV=production \
    HEALTH_PORT=8080
# openssl: lo necesita el motor de migraciones de Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @clasificador/worker...
COPY --from=builder /repo/apps/worker/src ./apps/worker/src
# Reproceso manual de correos marcados: docker exec <contenedor> node_modules/.bin/tsx scripts/reprocess.ts
COPY --from=builder /repo/apps/worker/scripts/reprocess.ts ./apps/worker/scripts/reprocess.ts
COPY --from=builder /repo/packages/db/src ./packages/db/src
COPY --from=builder /repo/packages/db/prisma ./packages/db/prisma
COPY --from=builder /repo/packages/db/prisma.config.ts ./packages/db/
COPY --from=builder /repo/packages/shared/src ./packages/shared/src
RUN chown -R node:node /app
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT}
USER node
WORKDIR /app/apps/worker
EXPOSE 8080
# /livez: el proceso ha arrancado (migraciones aplicadas) y su bucle avanza. No mide la frescura de la
# sincronización con Graph (eso es /health, para Uptime Kuma): si Graph falla no hay reinicios en bucle.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||8080)+'/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
