# 0015. La web no tiene credenciales del buzón: pide al worker por la cola

- **Estado:** aceptada

## Contexto

La web es el contenedor expuesto a Internet y no debe poder tocar el buzón ni conocer las claves
de los LLM. Aun así el panel necesita listar y crear categorías, probar modelos y reprocesar.

## Decisión

- La web **no lleva** `GRAPH_*`, `MAILBOX`, el certificado ni claves de LLM.
- Cuando necesita algo del buzón o de un LLM, **encola un trabajo en pg-boss y el worker lo
  ejecuta** con su certificado o sus claves:
  - `list-master-categories` y `create-master-category`: la web sondea hasta 15 s para leer y 30 s
    para crear; el worker comprueba que la categoría no exista antes de crearla.
  - `test-classify` (botón Probar): proveedor, modelo y un correo (el pegado o uno sintético con el
    CIF de una sociedad). La web espera por sondeo hasta 60 s y, pasado ese tiempo, cancela el
    trabajo. El worker usa **ese** proveedor y modelo sin tocar `LlmSetting` y devuelve decisión,
    tokens, coste y latencia; si falta la clave, el resultado es `unavailable` con el nombre de la
    variable. La cola no tiene reintentos y caduca a los 120 s.
  - `reprocess-flagged`: ([0007](0007-fallos-tecnicos-y-reproceso.md)).
- El panel usa un cliente de pg-boss que no migra, no supervisa ni programa: eso es del worker, así
  que las colas existen cuando el worker ha arrancado al menos una vez. El worker registra los
  atendedores aunque no tenga credenciales de Graph; sin ellas, `/categorias` muestra el motivo en
  lugar de fallar.
- **Auditoría de categorías:** `CategoryAudit` lo escribe la web con el usuario de la sesión, tras
  recibir `created` del worker. El worker no recibe ni confía en un email que viaje en el trabajo.

## Consecuencias

- Si la web cae justo entre la creación de una categoría y su registro, la categoría existe sin
  registro (el panel avisa si falla la escritura).
- Sin worker en marcha, las pantallas que dependen de él muestran el motivo.
- Los datos del trabajo viajan por la base de datos: véase la retención del texto pegado en
  [0010](0010-retencion-y-datos-de-terceros.md).
