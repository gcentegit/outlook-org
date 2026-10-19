# 0019. Publicación de imágenes por commit y vuelta atrás por etiqueta

- **Estado:** aceptada

## Contexto

Hay que poder desplegar una versión exacta y volver a la anterior sin reconstruir. El flujo está en
[`.github/workflows/release.yml`](../../.github/workflows/release.yml). Qué versión es cada cosa y
cuándo se publica una release lo define
[versiones y releases](../operacion/versiones-y-releases.md); aquí solo constan las decisiones de
despliegue.

## Decisión

- **Imágenes por commit:** cada push a `main` publica `clasificador-web` y `clasificador-worker`
  (linux/arm64, en un runner arm64 nativo) con la etiqueta del sha corto, una sola vez por commit. Al publicar una versión, esa misma imagen
  recibe la etiqueta `X.Y.Z` sin reconstruirse. La imagen lleva horneadas la versión (`APP_VERSION`)
  y el commit (`APP_COMMIT`). `latest` existe solo como referencia y nunca se despliega.
- **Versión exacta, no `:latest`:** el despliegue fija en cada aplicación la imagen
  `:X.Y.Z` (`application.saveDockerProvider`) y después despliega (`application.deploy`).
- **El despliegue solo se lanza desde el flujo** (una etiqueta de versión o una ejecución manual) y
  solo si existe el secreto `DOKPLOY_API_KEY`. Las aplicaciones se localizan por nombre, sin un
  secreto con identificadores.
- **Orden:** primero el worker; se espera a que su despliegue termine bien y su contenedor sea sano
  con la imagen nueva (`infra/scripts/wait-dokploy-app.sh`; sano implica migrado, porque `/livez`
  no responde 200 antes). Solo entonces se despliega la web, se espera a que `/api/health`
  devuelva esa versión y se vuelve a comprobar el worker. Si el worker falla, la web no se
  despliega.
- **Volver atrás es desplegar la etiqueta anterior** con el flujo manual; no hace falta
  reconstruir.

## Consecuencias

- Las migraciones solo avanzan: una imagen anterior con un esquema posterior debe ser compatible,
  o se restaura la copia de seguridad ([0020](0020-copias-de-seguridad-y-restauracion.md)).
- Antes de cualquier migración hay que tener una copia de seguridad reciente.
- Construir en cada push a `main` gasta minutos de runner arm64 también en los commits que no se
  publican. Hoy no cuesta nada porque el repositorio es público. **Si pasa a privado**, conviene
  construir solo cuando release-please crea una Release, sobre el commit de la Release y con la
  etiqueta `X.Y.Z` directamente, sin el paso de promover. A cambio, un Dockerfile roto (el de la web
  no lo construye la CI de los PR) se descubriría al publicar y no al fusionar, y la publicación
  tardaría algo más porque el build ya no iría en paralelo con release-please.
