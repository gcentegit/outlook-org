# 0022. Repositorio público: sin direcciones reales ni datos de terceros

- **Estado:** aceptada

## Contexto

El repositorio de GitHub es público. Se eligió así para que Dokploy descargue las imágenes de GHCR
sin token y por los runners arm64 gratuitos. El coste es que quedan a la vista la lógica interna del
proceso y la estructura societaria. Un repositorio privado necesitaría un token de lectura de
paquetes en Dokploy (previsto en `release.yml` y `provision.ts`) y consumiría minutos de Actions.

## Decisión

- El repositorio sigue siendo **público** (decisión del usuario).
- **Ninguna dirección de correo real** se versiona: el buzón (`MAILBOX`) y el administrador
  (`ADMIN_EMAIL`) llegan solo por variables de entorno y no tienen valor por defecto. En
  documentos se escriben como `<MAILBOX>` y `<ADMIN_EMAIL>`; en código y pruebas se usan dominios
  de ejemplo.
- Tampoco se versionan datos de terceros ni de otros proyectos: `data/`, `secrets/` y
  `docs/privado/` están en `.gitignore` y se revisa el contenido de planes e informes antes de
  cada subida ([0010](0010-retencion-y-datos-de-terceros.md)). De otros proyectos del mismo
  servidor solo se menciona su existencia.
- Las sociedades, sus CIF y el panel público sí constan en el repositorio.

## Consecuencias

- Sin variable de entorno no hay remitentes internos ni administrador inicial.
- Faltan por decidir las protecciones básicas de un repositorio público (alertas de secretos con
  bloqueo, Dependabot, plantilla de pull request); no son parte de la documentación.
