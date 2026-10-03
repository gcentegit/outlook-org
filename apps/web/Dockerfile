# syntax=docker/dockerfile:1.7
# Panel web (Next.js, salida standalone). Imagen linux/arm64 (también construye en amd64).
#   docker build -f apps/web/Dockerfile \
#     --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
#     --build-arg APP_COMMIT=$(git rev-parse --short=7 HEAD) -t clasificador-web .
# APP_VERSION es la versión del producto (X.Y.Z, la del package.json raíz) y APP_COMMIT el commit; los
# devuelve /api/health y los muestra el pie del panel. Se declaran al final para no invalidar la caché.
ARG NODE_VERSION=22
ARG PNPM_VERSION=11.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS builder
ARG PNPM_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @clasificador/web...
# El cliente de Prisma (packages/db/src/generated) no se versiona: se genera antes de compilar.
RUN pnpm --filter @clasificador/db generate
RUN pnpm --filter @clasificador/web build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# El bundle standalone lleva sus propias dependencias mínimas.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT}
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
