# Versionado SemVer con release-please

Fecha: 2026-10-03. Rama `ci/versionado-semver`. Estado: construido y verificado en local; el PR de versión y la primera Release solo se pueden probar en `main`.

## Qué se hizo

- **release-please** (`release-please-config.json`, `.release-please-manifest.json`): `release-type: node` en la raíz, etiqueta `vX.Y.Z` sin componente, `bump-minor-pre-major`, `CHANGELOG.md` en la raíz con secciones en español (visibles: Funcionalidades, Correcciones, Rendimiento, Reversiones; ocultas: refactor, docs, test, build, ci, chore). El manifiesto parte de `0.0.0` y `initial-version: 0.1.0`: según el código de release-please, un `0.0.0` en el manifiesto se trata como «sin versión previa» y la primera versión es `initial-version`, así que la primera Release es `v0.1.0` sea cual sea el tipo de los commits.
- **Una sola versión**: `package.json` raíz. Los paquetes internos pasan de `0.1.0` a `0.0.0` y no se sincronizan (sin `extra-files`): nadie los lee por versión. Documentado.
- **Flujo** (`release.yml` + nuevo `deploy.yml`, reutilizable y con `workflow_dispatch` para volver atrás): en cada push a `main`, `build` (arm64, una vez por commit, `APP_VERSION` = versión del `package.json`, `APP_COMMIT` = sha corto) y `release-please` en paralelo; `promote` (si hay Release) añade la etiqueta `X.Y.Z` con `docker buildx imagetools create` y comprueba antes que la versión horneada es la de la Release; `deploy` llama a `deploy.yml`. Acciones fijadas por SHA con comentario de versión (release-please-action v5.0.0, action-semantic-pull-request v6.1.1).
- **CI del PR de versión sin token personal**: el job de release-please, con `actions: write`, lanza `ci.yml` por `workflow_dispatch` sobre la rama del PR cada vez que lo crea o actualiza. Hay que activar un ajuste del repositorio (ver más abajo).
- **Versión visible**: `/api/health`, `/health` y `/livez` devuelven `version` y `commit`; el pie del panel muestra ambos. Dockerfiles con los dos build-args (declarados al final de la etapa final para no invalidar la caché; en el worker eso evita además reinstalar dependencias en cada commit). `wait-dokploy-app.sh` ahora exige `--tag` en formato `X.Y.Z`. `provision.ts` no dependía del formato; sus pruebas añaden `APP_COMMIT` como variable no gestionada.
- **Validación del título del PR**: `pr-title.yml` (Conventional Commits, tipos pedidos).
- **Higiene**: `dependabot.yml` (npm agrupado minor/patch, github-actions, docker en `apps/web` y `apps/worker`; prefijos `build`/`ci` para que no provoquen versión), plantilla de PR, `UNLICENSED` (ya estaba), `.claude/worktrees/` en `.gitignore`, `CHANGELOG.md` en `.prettierignore`.
- **CI**: job `Integración · PostgreSQL` con `postgres:16-alpine` que corre las pruebas con `RUN_INTEGRATION=1`; las que necesitan docling pasan a `RUN_DOCLING_INTEGRATION=1`. `workflow_dispatch` añadido a `ci.yml`. El job `Lint · Typecheck · Test · Build` no cambia de nombre.
- **Documentación**: `docs/operacion/versiones-y-releases.md` e `infra/dokploy/README.md` actualizado (publicación, vuelta atrás, `restore-check.sh` «pendiente de programar», sin nombres de otro proyecto). Casillas de la fase 8 marcadas solo para título de PR y documento.

## Cómo se verificó

- `pnpm lint`, `typecheck`, `test`, `build` y `format:check` en verde tras el rebase sobre `origin/main` (c5a9576).
- `actionlint` (imagen `rhysd/actionlint`, ya borrada) sin avisos sobre los cinco workflows.
- Integración con PostgreSQL contra una base temporal en el PostgreSQL local (5442; creada y borrada): 2 pruebas pasan, 3 (docling) se saltan.
- `docker build` de web y worker con `APP_VERSION=1.2.3` y `APP_COMMIT=<sha>`: `/api/health` devuelve `{"status":"ok","version":"1.2.3","commit":"6208561"}`; `/livez` y `/health` del worker devuelven `version` y `commit`; ambos contenedores `healthy`.
- Promoción: probada con un registro efímero y un builder `docker-container` (con atestaciones, como en la CI): `imagetools inspect --format '{{ json .Image }}'` expone `config.Env` con `APP_VERSION`, `imagetools create --tag` copia el manifiesto con el mismo digest y un tag inexistente devuelve código 1. Registro, builder e imágenes borrados.
- Puertos tras limpiar contenedores y base de pruebas: `ss -ltnp | grep -E ':(3110|8080|8180)\b'` no devuelve nada (3110, 8080 y 8180 libres).

## Qué queda por verificar tras fusionar

- Que release-please abre el PR de versión con `0.1.0`, y que el lanzamiento de `ci.yml` por `workflow_dispatch` deja los checks en ese PR (el job lo hace; que GitHub los cuente para la protección solo se ve en `main`).
- Fusionar el PR de versión: etiqueta `v0.1.0`, Release con las notas, `promote` (etiqueta `0.1.0` sobre la imagen del commit) y `deploy` (sin secretos de Dokploy debe avisar y terminar en verde).
- Que `pr-title.yml` y el job de integración corren en un PR real.

## Ajustes del repositorio que hace falta que haga el orquestador

1. Settings > Actions > General > Workflow permissions: marcar **Allow GitHub Actions to create and approve pull requests** (release-please abre el PR de versión con `GITHUB_TOKEN`). Sin esto, el job de release-please falla.
2. Checks obligatorios recomendados (nombre exacto del job): `Lint · Typecheck · Test · Build` (ya está) e `Integración · PostgreSQL`. **No** marcar `Título del PR (Conventional Commits)`: el PR de versión lo crea `GITHUB_TOKEN` y ese workflow no se lanza en él (el título `chore: release X.Y.Z` ya es válido), así que quedaría bloqueado. El título lo vigila el check, visible aunque no obligatorio; y el administrador es quien fusiona.
3. Los checks `Lint · Typecheck · Test · Build` e `Integración · PostgreSQL` del PR de versión salen del `workflow_dispatch`; si «require branches to be up to date» está activo, cada actualización del PR relanza la CI (ya lo hace el flujo).

## Riesgos

- Release-please y `workflow_dispatch` no se pueden ensayar fuera de `main`; si GitHub no contase los checks del dispatch para el PR de versión, la alternativa documentada es un token personal de grano fino o una GitHub App (no necesario de entrada).
- Si dos fusiones llegan seguidas, la Release puede crearse para un commit anterior al de la ejecución: `promote` usa el commit de la Release y espera hasta 30 minutos a que exista su imagen; si no existe, falla con un mensaje claro y se resuelve con «Re-run failed jobs».
- Título de la Release: `vX.Y.Z` (valor por defecto de release-please, igual que la etiqueta). Si se prefiere `X.Y.Z` sin la v, es `include-v-in-release-name: false`.
- Los ADR 0017 y 0019 y `docs/operacion/despliegue.md` (de otro PR) aún dicen que la versión es el sha corto y que se vuelve atrás con un sha; conviene actualizarlos (ADR 0019 en concreto, que describe la publicación).
- `main` ya tiene el commit inicial `feat:`, así que el primer PR de versión incluirá todo el historial en el changelog.
