# 0004. Modo sombra obligatorio y activación por categoría

- **Estado:** aceptada

## Contexto

Una mala clasificación sería visible para todo el equipo de Proveedores. Antes de escribir en el
buzón hay que medir el acierto con datos reales.

## Decisión

- `MODE=shadow` es el valor por defecto: el worker propone categorías y guarda las decisiones, pero
  **no escribe nada en Outlook**. Con `MODE=live` el worker se niega a arrancar con un mensaje
  claro: la escritura de categorías está programada pero no se activa hasta que el usuario lo
  autorice (será la versión 1.0.0).
- Los interruptores sombra/live por categoría del panel escriben en `CategorySetting` (sin fila, la
  categoría está en sombra; pasar a live exige una casilla de confirmación validada también en el
  servidor). Hoy son solo una preferencia guardada: el worker los expone en `/health`
  (`categoryModes`), registra un aviso si una categoría se pone en live (una vez por cambio) y
  sigue en sombra.
- Sin credenciales de Graph el worker arranca, aplica migraciones, mantiene la limpieza diaria y
  atiende las colas del panel, pero no sincroniza. Lo dice en el log y `/health` responde 503 con
  `status: "disabled"` y el motivo.
- Escritura en modo real (`apps/worker/src/graph/apply-categories.ts`), tras guardar una decisión
  válida:
  - Solo se escriben las categorías de la decisión que el panel tiene en live, con el nombre de la
    lista maestra del buzón; una que no esté en ella no se escribe.
  - El `PATCH` de `categories` **reemplaza** la lista entera: se leen las categorías actuales justo
    antes y se escribe con `If-Match`. Si el correo cambió entre medias (412 o 409), se vuelve a
    leer, hasta tres veces. Sin etag no se escribe. Nunca se quita ninguna.
  - Lo que escribe el servicio se anota en `AppliedCategory` antes del `PATCH` y se borra solo si
    Graph lo rechaza. Si después el correo ya no la tiene, la quitó el equipo y no se vuelve a poner;
    en la duda (no se sabe si se escribió), tampoco.
  - Si la escritura falla, la decisión queda guardada y el correo marcado para reprocesar: volver a
    escribir no duplica nada.

## Consecuencias

- La activación real es una fase propia del plan y será la versión 1.0.0
  ([versiones y releases](../operacion/versiones-y-releases.md)).
- El panel muestra el modo guardado, no una activación efectiva: no hay que interpretarlo como
  «ya está escribiendo».
- En modo live el acierto medido sería más optimista (las categorías del servicio se mezclarían con
  las del equipo) ([0008](0008-correcciones-y-metrica-de-acierto.md)).
