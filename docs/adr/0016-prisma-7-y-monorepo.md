# 0016. Prisma 7 con adaptador `pg` y monorepo pnpm sin Turborepo

- **Estado:** aceptada

## Contexto

El servidor es arm64. Otro proyecto del mismo servidor usa Prisma 6 y TypeScript con `tsx` en
producción; aquí se copian sus patrones donde conviene y se desvían donde hay motivo.

## Decisión

**Prisma**

- Prisma 7.10.0 (versión fijada) con el adaptador `@prisma/adapter-pg`, generador `prisma-client`
  (TypeScript en `packages/db/src/generated`, sin versionar) y `prisma.config.ts`.
- **Motivo:** el cliente no lleva motor de consultas en Rust, así que no hay binarios por plataforma
  que acertar en arm64 ni `binaryTargets`. `generate`, `migrate dev` y `migrate deploy` se
  probaron en arm64 y la imagen del worker construye y migra en `linux/arm64`.
- **No se usa Prisma 8:** la versión `latest` del registro era una candidata (`8.0.0-rc`).
- **Coste:** solo el motor de migraciones sigue siendo un binario (lo descarga `prisma` en su
  postinstall; por eso `pnpm-workspace.yaml` lo aprueba en `allowBuilds`). `prisma` es dependencia
  de producción de `@clasificador/db` para que el worker ejecute `migrate deploy` al arrancar.

**Monorepo**

- pnpm 11 con `apps/web`, `apps/worker`, `packages/db` y `packages/shared`, **sin Turborepo**: con
  cuatro paquetes `pnpm -r` basta. Un único `eslint.config.mjs` en la raíz.
- El worker ejecuta TypeScript con **`tsx` en producción**, sin paso de compilación propio.
- `infra/dokploy` es un paquete del workspace (`@clasificador/dokploy-provision`) para que sus
  pruebas, tipos y lint entren en `pnpm test`, `typecheck` y `lint`. Las imágenes no lo necesitan:
  `pnpm install --frozen-lockfile --filter` funciona sin ese directorio.

## Consecuencias

- La imagen del worker pesa unos 2 GB por llevar el CLI de Prisma y `tsx`; reducirla (compilar el
  worker y separar las migraciones) es una mejora pendiente de baja prioridad.
- Las migraciones solo avanzan: una imagen anterior con un esquema posterior debe ser compatible,
  o se restaura la copia de seguridad ([0020](0020-copias-de-seguridad-y-restauracion.md)).
