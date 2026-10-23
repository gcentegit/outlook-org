# 0004. Modo sombra por defecto y activación por categoría

- **Estado:** aceptada

## Contexto

Una mala clasificación sería visible para todo el equipo de Proveedores. Antes de escribir en el
buzón hay que medir el acierto con datos reales.

## Decisión

- `MODE=shadow` es el valor por defecto: el worker propone categorías y guarda las decisiones, pero
  **no escribe nada en Outlook**. Con `MODE=live` escribe en los correos las categorías que el panel
  tenga en live (desde la versión 1.0.0). Pasar a `MODE=live` y cada categoría a live lo autoriza el
  usuario.
- Los interruptores sombra/live por categoría del panel escriben en `CategorySetting` (sin fila, la
  categoría está en sombra; pasar a live exige una casilla de confirmación validada también en el
  servidor). Deciden qué categorías escribe un worker en `MODE=live`; el worker los lee en cada
  correo y los expone en `/health` (`categoryModes`). Un worker en `MODE=shadow` no escribe ninguna
  y registra un aviso si alguna está en live (una vez por cambio).
- Sin credenciales de Graph el worker arranca, aplica migraciones, mantiene la limpieza diaria y
  atiende las colas del panel, pero no sincroniza. Lo dice en el log y `/health` responde 503 con
  `status: "disabled"` y el motivo.
- Escritura en modo real (`apps/worker/src/graph/apply-categories.ts`), tras guardar una decisión
  válida:
  - Solo se escriben las categorías de la decisión que el panel tiene en live, con el nombre de la
    lista maestra del buzón; una que no esté en ella no se escribe.
  - Con `BOT_CATEGORY` configurada, esa categoría acompaña a cada escritura: se añade en el mismo
    `PATCH` solo cuando el servicio escribe al menos una categoría de la decisión, para que el equipo
    distinga en Outlook lo que puso el clasificador. Sigue las mismas reglas: tiene que estar en la
    lista maestra, no se duplica y no se vuelve a poner si el equipo la quita. Como no es FOOD BOX,
    LATERAL ni ARCOBETA, no cuenta para correcciones ni métricas.
  - El `PATCH` de `categories` **reemplaza** la lista entera: se leen las categorías actuales justo
    antes y se escribe con `If-Match`. Si el correo cambió entre medias (412 o 409), se vuelve a
    leer, hasta tres veces. Sin etag no se escribe. Nunca se quita ninguna.
  - Lo que escribe el servicio se anota en `AppliedCategory` antes del `PATCH` y se borra solo si
    Graph lo rechaza (un 4xx). Si no se sabe si llegó (5xx, 429, red), se vuelve a leer el correo y
    solo queda anotado lo que tiene. Si después el correo ya no la tiene, la quitó el equipo y no se
    vuelve a poner.
  - Si la escritura falla, la decisión queda guardada y el correo marcado para reprocesar: volver a
    escribir no duplica nada.
  - Solo se escribe al decidir un correo. Los que ya tenían decisión en sombra no se reescriben al
    pasar a live.

## Consecuencias

- La versión 1.0.0 es la primera que escribe en el buzón
  ([versiones y releases](../operacion/versiones-y-releases.md)).
- El interruptor del panel solo escribe si además el worker está en `MODE=live`; volver una
  categoría a sombra deja de escribirla en el siguiente correo, sin redesplegar.
- En modo live, lo que escribe el servicio cuenta como acierto hasta que el equipo lo quita o lo
  cambia ([0008](0008-correcciones-y-metrica-de-acierto.md)).
