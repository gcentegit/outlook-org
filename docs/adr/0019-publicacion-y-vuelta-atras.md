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
  (linux/arm64, en un runner arm64 nativo) con la etiqueta del sha corto, que es también la
  `APP_VERSION` horneada. `latest` existe solo como referencia y nunca se despliega.
- **Versión exacta, no `:latest`:** el despliegue fija en cada aplicación la imagen
  `:<etiqueta>` (`application.saveDockerProvider`) y después despliega (`application.deploy`).
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
