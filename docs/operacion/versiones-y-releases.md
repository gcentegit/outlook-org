# Versiones y releases

Cómo se numeran las versiones, cómo llega un cambio hasta el servidor y cómo se vuelve atrás. La
herramienta es [release-please](https://github.com/googleapis/release-please); su configuración está en
[`release-please-config.json`](../../release-please-config.json) y la versión actual, en
[`.release-please-manifest.json`](../../.release-please-manifest.json). Los flujos son
[`release.yml`](../../.github/workflows/release.yml), [`deploy.yml`](../../.github/workflows/deploy.yml),
[`ci.yml`](../../.github/workflows/ci.yml) y [`pr-title.yml`](../../.github/workflows/pr-title.yml).

## Una versión para todo el producto

La versión vive en el `version` del `package.json` raíz, y solo allí. La web, el worker y las imágenes
llevan esa misma versión. Los paquetes internos (`apps/*`, `packages/*`, `infra/dokploy`) son privados,
nadie los consume por versión y se quedan en `0.0.0`: sincronizarlos con `extra-files` añadiría cinco
ficheros que cambiar en cada release sin que nada los lea. Si algún día se publica un paquete, se revisa.

`/api/health` (web), `/health` y `/livez` (worker) devuelven `version` (`X.Y.Z`) y `commit` (sha corto,
7 caracteres). El pie del panel muestra los dos. Con `docker compose` en local salen como `dev`.

## Reglas SemVer del proyecto

| Cambio | Sube |
| --- | --- |
| `fix`, `perf` | PATCH |
| `feat` | MINOR |
| Incompatible (título con `!`, p. ej. `feat!: ...`) | MAJOR; mientras la versión sea `0.x`, MINOR (`bump-minor-pre-major`) |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore` | Nada: no provocan versión ni aparecen en el changelog |

**Qué es incompatible en esta aplicación**, y por tanto lleva `!` en el título:

- una migración que exige pasos manuales o no admite volver atrás;
- una variable de entorno nueva y obligatoria;
- un cambio en lo que el servicio hace en el buzón.

**La serie `0.x` dura mientras el servicio solo funcione en sombra. La `1.0.0` será la primera versión
que escriba categorías en el buzón** (`MODE=live`). Cuando llegue, se fuerza con `release-as: "1.0.0"`
en `release-please-config.json` en el PR que active la escritura, y se quita en cuanto se publique.

La primera versión publicada es la `v0.1.0`: el manifiesto parte de `0.0.0` y `initial-version` fija la
primera en `0.1.0`.

## El título del PR es lo que cuenta

`main` solo admite PR con fusión «squash», y el **título del PR pasa a ser el mensaje del commit**
(cuerpo en blanco). Release-please lee esos mensajes para calcular la versión y escribir el changelog.
Por eso [`pr-title.yml`](../../.github/workflows/pr-title.yml) valida el título (no los commits de la
rama, que se aplastan):

```text
tipo(ámbito opcional): descripción en minúsculas, en español y sin punto final
```

Tipos permitidos: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
En `feat`, `fix`, `perf` y `revert` la descripción **empieza por un icono**
(`fix(web): 🔐 llevar el oid de Microsoft en la sesión...`), y el mismo check lo exige.
Como el cuerpo queda en blanco, un cambio incompatible solo se marca con `!` tras el tipo; el aviso
`BREAKING CHANGE:` en el cuerpo no llega a `main`. Explica en la descripción del PR (hay una plantilla)
qué hay que hacer al desplegar.

El `CHANGELOG.md` de la raíz muestra **🚀 Novedades** (`feat`), **🔧 Correcciones** (`fix`),
**⚡ Rendimiento** (`perf`) y **↩️ Reversiones** (`revert`). Los demás tipos quedan ocultos: son
mantenimiento que no cambia lo que hace el servicio. El encabezado de los cambios incompatibles lo
escribe release-please y sale en inglés (`BREAKING CHANGES`); no es configurable.

### Notas de la release legibles

Cada Release lleva, por cada PR que entra, **su título** (la línea que escribe release-please, también
en el `CHANGELOG.md`) y **su detalle**, debajo, copiado de la sección **«Para las notas de la release»**
de la descripción del PR. Las dos partes se escriben en origen, pensando en quien las lee:

- **Un icono al principio** de la descripción del título y de cada punto del detalle, que diga algo de
  ese punto, para recorrer la lista con la vista. Guía: 🏷️ categorías · 📮 correos · 📎 adjuntos ·
  📄 PDF y OCR · 🤖 LLM · 🔐 acceso y sesión · 🗂️ páginas del panel · 🎨 aspecto · 🛡️ guardas ·
  📥 sincronización · ⚡ rendimiento · 🐛 fallo corregido · ⚠️ aviso importante.
- **Lenguaje de producto**: qué cambia para quien usa el panel o el buzón, sin nombres de ficheros ni
  funciones. El detalle técnico va en el resto de la descripción del PR.
- **Qué pasaba antes**: una nota que solo dice qué hace ahora no deja entender por qué era un problema.
- **Negrita para lo importante** de cada punto, no para frases enteras.

En `feat`, `fix`, `perf` y `revert`, el check «Título del PR» exige el icono del título y la sección
con al menos un punto, cada uno con icono. Los demás tipos no salen en las notas y no la necesitan.

Al crearse la Release, el job «Notas de la Release» de [`release.yml`](../../.github/workflows/release.yml)
copia esos puntos **tal cual** debajo de su línea y añade un pie con la comparación entre versiones y
el `CHANGELOG.md`. No reescribe, no resume ni reordena. El `CHANGELOG.md` se queda con una línea por
cambio: es el índice, y el detalle vive en la Release y en el PR. El código está en
[`infra/release-notes`](../../infra/release-notes/release-notes.ts).

Si hay que corregir algo después de publicar:

- **El detalle**: se edita la sección del PR y se vuelve a lanzar
  `node infra/release-notes/release-notes.ts publish vX.Y.Z` (con `GITHUB_TOKEN` y
  `GITHUB_REPOSITORY`; `--dry-run` enseña el resultado sin tocar nada). Solo completa las líneas que
  aún no tienen detalle; para rehacer una, borra antes su detalle de la Release.
- **El título de un PR ya fusionado**: se añade al final de su descripción un bloque
  `BEGIN_COMMIT_OVERRIDE` / `END_COMMIT_OVERRIDE` con el título corregido, antes de publicar la versión;
  release-please lo usa en lugar del commit. Si la versión ya está publicada, se cambia igual en la
  Release y en su sección del `CHANGELOG.md`.

Nunca se añade a una Release algo que no esté en su PR ni en el changelog: lo descubierto después va
en la versión en que se descubre.

Dependabot abre sus PR como `build(deps): ...` y `ci(deps): ...`, así que no provocan versión. Si una
actualización es urgente (seguridad), cambia el título a `fix(deps): ...` antes de fusionar.

## Del cambio al despliegue, paso a paso

1. Abres un PR con título convencional. La CI ([`ci.yml`](../../.github/workflows/ci.yml), que
   también arranca la imagen del worker) debe estar en verde. Se fusiona con «squash».
2. En el push a `main`, [`release.yml`](../../.github/workflows/release.yml) **construye las imágenes
   arm64 una sola vez** y las publica en GHCR con la etiqueta del sha corto, con la versión del
   `package.json` y el commit horneados. No despliega nada.
3. En la misma ejecución, release-please crea o actualiza el **PR de versión** (`chore: release X.Y.Z`),
   que cambia `package.json`, `.release-please-manifest.json` y `CHANGELOG.md`. Mientras ese PR esté
   abierto sigue acumulando los cambios nuevos. Tras crearlo o actualizarlo, el propio flujo lanza la CI
   sobre su rama (ver más abajo).
4. Cuando decides publicar, revisas el changelog del PR de versión y lo fusionas con «squash». Ese push
   construye de nuevo las imágenes, ya con la versión nueva en `package.json`.
5. En esa ejecución release-please crea la etiqueta `vX.Y.Z` y la Release de GitHub con las notas del
   changelog (el título es `vX.Y.Z`), y el job de notas añade debajo de cada línea el detalle de su PR.
6. El job de promoción comprueba que la imagen del commit lleva la versión de la Release y le añade la
   etiqueta `X.Y.Z` con `docker buildx imagetools create`: mismo digest, **sin reconstruir**.
7. Se llama a [`deploy.yml`](../../.github/workflows/deploy.yml), que despliega esa versión en Dokploy
   (worker primero, esperar a que esté sano, después la web) si existen los secretos `DOKPLOY_API_URL` y
   `DOKPLOY_API_KEY`; si no, avisa y termina sin error. Detalle:
   [infra/dokploy/README.md](../../infra/dokploy/README.md).
8. Compruebas `GET /api/health`: debe devolver la versión y el commit nuevos.

Todo esto ocurre en una misma ejecución porque GitHub no lanza otros workflows por lo que hace
`GITHUB_TOKEN` (por ejemplo, crear una etiqueta): los pasos que dependen de «se ha creado una Release»
leen los outputs de release-please en lugar de esperar un evento de etiqueta.

Etiquetas de imagen en GHCR: `<sha corto>` (cada commit de `main`), `X.Y.Z` (cada Release) y `latest`
(solo referencia; no se despliega nunca).

## Volver atrás

Actions > **Desplegar en Dokploy** > Run workflow con `version` = la versión buena anterior, sin la `v`
(por ejemplo `0.2.1`). No construye nada: comprueba que existe su imagen y la despliega. Las migraciones
solo avanzan, así que la versión anterior debe ser compatible con el esquema actual o hay que restaurar
la copia ([copias y restauración](copias-y-restauracion.md)). Pasos completos en
[infra/dokploy/README.md](../../infra/dokploy/README.md#cómo-volver-atrás).

Si una ejecución falla a medias (por ejemplo, la construcción de la imagen de la Release), usa «Re-run
failed jobs»: conserva los outputs de release-please. Volver a lanzar todo el workflow no recrea la
Release, porque ya existe.

## Si el PR de versión se queda bloqueado

GitHub crea las ejecuciones de la CI de un PR abierto por Actions, pero las deja en espera de
aprobación. Sin ellas el PR de versión no cumple los checks obligatorios y aparece como bloqueado
(así ocurrió con la `v0.1.0`). El job de release-please intenta aprobarlas después de crear o
actualizar el PR.

Si el PR de versión sigue bloqueado:

1. Abre el PR y pulsa **Approve workflows to run**, o aprueba las ejecuciones en espera desde la
   pestaña Actions. La CI arranca y, al pasar, el PR se puede fusionar.
2. Si el job de release-please falla con «GitHub Actions is not permitted to create or approve pull
   requests», activa Settings > Actions > General > Workflow permissions > **Allow GitHub Actions to
   create and approve pull requests**.
3. Si la aprobación automática deja un aviso en cada versión, la alternativa es que release-please use
   un token personal de grano fino o una GitHub App: los PR creados así lanzan la CI sin aprobación.

El título del PR de versión (`chore(main): release X.Y.Z`) ya es válido; aun así, el check del título
**no** debe ser obligatorio, para que un fallo de aprobación no bloquee una versión.

Solución alternativa, si GitHub dejase de permitir este lanzamiento: un token personal de grano fino (o
una GitHub App) con permisos de contenido y de pull requests, guardado como secreto y pasado a la acción
de release-please en `token:`. Con él, los PR sí lanzan la CI por sí solos.
