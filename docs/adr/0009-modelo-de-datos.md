# 0009. Modelo de datos

- **Estado:** aceptada

## Contexto

El esquema vive en `packages/db/prisma/schema.prisma` (el código es la fuente de los campos). Aquí
solo se recogen las decisiones de forma que el esquema no puede explicar por sí mismo.

## Decisión

- Las **categorías se guardan como texto**, no como enum: la lista maestra del buzón es dinámica.
  FOOD BOX | LATERAL | ARCOBETA se valida con Zod en `@clasificador/shared`.
- `Decision` guarda el JSON completo y una copia de `categories` (`text[]`) para contar y filtrar
  en el panel sin abrir el JSON. Un correo puede tener varias decisiones (reevaluaciones, modos
  sombra y live); la vigente es la más reciente.
- `source` de la decisión admite `rule`, `llm`, `thread` (herencia del hilo) y `none` (sin señal ni
  LLM: `ruleId` y `model` a null y, salvo que el equipo ya haya etiquetado todo, en revisión). Es
  texto dentro del JSON, no un enum de base de datos: no hay migración.
- `Rule` es única por `(type, value, category)`, lo que hace idempotente la semilla. Los CIF se
  guardan normalizados (mayúsculas, sin espacios, guiones ni puntos).
- La caché de texto de adjuntos (`AttachmentText.hash`) usa como clave `<sha256>:p<páginas>`
  (`ATTACHMENT_MAX_PAGES`): cambiar el límite de páginas no sirve texto extraído con otro límite.
- `CategorySetting` (una fila por categoría) guarda el modo sombra/live del panel. Sin fila, la
  categoría está en sombra. El panel accede con SQL directo (tolera que la tabla no exista) y el
  worker la lee con Prisma solo para exponerla.
- `Message.status` (`pending`, `processed`, `failed`), `Message.needsReprocess`, `Decision.degraded`
  y `AllowedUser.oid` (nulo, único) existen para el estado de los correos, el reproceso y el acceso
  atado a la cuenta de Microsoft. Los correos que ya tenían decisión pasaron a `processed` en su
  migración.
- Un único `LlmSetting` activo lo garantiza la aplicación ([0003](0003-llm-configurable-y-privacidad.md)).

## Consecuencias

- Cambiar `source` o las categorías no exige migrar; cambiar columnas sí, y toda migración va
  precedida de una copia de seguridad.
- Prisma 7 y su adaptador: [0016](0016-prisma-7-y-monorepo.md).
