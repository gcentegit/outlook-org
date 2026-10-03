# 0004. Modo sombra obligatorio y activación por categoría

- **Estado:** aceptada

## Contexto

Una mala clasificación sería visible para todo el equipo de Proveedores. Antes de escribir en el
buzón hay que medir el acierto con datos reales.

## Decisión

- `MODE=shadow` es el valor por defecto: el worker propone categorías y guarda las decisiones, pero
  **no escribe nada en Outlook**. Con `MODE=live` el worker se niega a arrancar con un mensaje
  claro, porque la aplicación de categorías (`PATCH`) no está implementada.
- Los interruptores sombra/live por categoría del panel escriben en `CategorySetting` (sin fila, la
  categoría está en sombra; pasar a live exige una casilla de confirmación validada también en el
  servidor). Hoy son solo una preferencia guardada: el worker los expone en `/health`
  (`categoryModes`), registra un aviso si una categoría se pone en live (una vez por cambio) y
  sigue en sombra.
- Sin credenciales de Graph el worker arranca, aplica migraciones, mantiene la limpieza diaria y
  atiende las colas del panel, pero no sincroniza. Lo dice en el log y `/health` responde 503 con
  `status: "disabled"` y el motivo.
- Cuando se implemente la activación, el `PATCH` de `categories` **reemplaza** la lista entera: hay
  que leer las categorías actuales justo antes y fusionar sin quitar ninguna.

## Consecuencias

- La activación real es una fase propia del plan y será la versión 1.0.0
  ([versiones y releases](../operacion/versiones-y-releases.md)).
- El panel muestra el modo guardado, no una activación efectiva: no hay que interpretarlo como
  «ya está escribiendo».
- En modo live el acierto medido sería más optimista (las categorías del servicio se mezclarían con
  las del equipo) ([0008](0008-correcciones-y-metrica-de-acierto.md)).
