# Repositorio público: sin direcciones reales

## Resultado
Ninguna dirección real queda en lo versionable. `ADMIN_EMAIL` y `MAILBOX` no tienen valor por defecto en ningún sitio.

## Código y configuración
- `packages/db/src/seed.ts`: se elimina el administrador por defecto. `applySeed` devuelve `adminMissing` cuando la lista de usuarios está vacía y no hay `ADMIN_EMAIL`; no crea administrador y siembra el resto. `prisma/seed.ts` lo indica.
- `apps/worker/src/seed-report.ts` (nuevo, con test): el worker registra con `console.error` el aviso claro y sigue arrancando. Cableado en `index.ts`.
- `apps/worker/src/config.ts`: `MAILBOX` sigue opcional (sin ella no sincroniza y lo indica /health; comprobado). `ADMIN_EMAIL` opcional.
- `INTERNAL_EMAIL_DOMAINS` sin valor por defecto (worker e histórico); `DEFAULT_INTERNAL_DOMAINS` eliminada de `packages/shared`. Sin variable, no hay remitentes internos.
- `infra/dokploy/provision.ts`: se elimina `DEFAULT_MAILBOX`. `buildEnv` del worker exige `MAILBOX` y `ADMIN_EMAIL` del entorno de quien ejecuta (error que nombra las que faltan; también en `--dry-run`). La web no las necesita.
- `.env.example`, README de Dokploy y `docs/DECISIONS.md` documentan el nuevo comportamiento.

## Sustituciones
- Código y tests: `admin@ejemplo.com`, `buzon@ejemplo.com`, `ana@`/`otra@`/`intruso@`/... en `@ejemplo.com`. Los casos de dominio interno usan dominios ficticios `ejemplo.com` y `grupo.example` pasados como parámetro (semántica intacta, incluido subdominio y sufijo parecido). Un test de razón social usa `admin@foodbox.example` porque comprueba que una dirección con "foodbox" no cuenta como sociedad. Nombre ficticio "Marta" en lugar del nombre real.
- Docs y planes: `<ADMIN_EMAIL>`, `<MAILBOX>`; `cpa@` sustituido por "otra dirección del grupo". README: enlace roto corregido a `docs/sociedades-categorias.md` y al `plan.md`.
- Se mantienen `clasificador.arcofood.com`, sociedades, CIF y Lateral Arturo Soria.

## Verificación
- grep de `gcentesimo|centesimo|@foodbox\.es|@arcofood\.com` sobre `git ls-files --others --exclude-standard`: salida vacía (también sin distinguir mayúsculas y buscando `proveedores@`/`cpa@`).
- lint, typecheck, build y format:check en verde. Tests: 478 (472 anteriores + 6 nuevos), todos en verde.
- RUN_INTEGRATION=1 del worker contra postgres 5442 y docling 5101: 5 tests en verde.
- Arranque local del worker (PID 637419, `.env` con las variables): migraciones sin pendientes, /health 503 `disabled` con faltan solo `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PATH` (ya no `MAILBOX`). Parado con SIGTERM.
- `ss -ltnp`: 3110, 8080 y 8180 libres.
- `.env` local actualizado con `ADMIN_EMAIL` y `MAILBOX` (ignorado por git). BD y AllowedUser sin tocar.

## Pendiente de tu decisión
- Quedan dominios reales sin `@` (no coinciden con tu grep): `lateral.example` en algunos emails de prueba (`x@lateral.example`...), `cpa.foodbox.es`/`cpa.arcofood.com` en un informe, "foodbox.es"/"arcofood.com" como texto en dos informes, `gcentegit` (propietario GHCR) en tests e informes y la dirección postal de la sociedad en un test.
- `infra/docker/compose.dev.yml` no pasa `ADMIN_EMAIL`/`MAILBOX` al worker (no lo hacía antes); si usas el compose en local, habría que añadirlas por variable.
- El repo no tiene commits: no hay histórico que limpiar, pero antes del primer commit conviene repetir el grep.
