# 0006. Cola de trabajos con pg-boss sobre PostgreSQL

- **Estado:** aceptada

## Contexto

Procesar un correo implica descargar adjuntos, convertirlos con docling (puede tardar por el OCR) y
llamar a un LLM. Hace falta reintento, idempotencia y desacoplar la sincronización del
procesado. Código: `apps/worker/src/jobs/`.

## Decisión

- Las colas usan **pg-boss sobre el mismo PostgreSQL**: no hace falta Redis.
- **Cola `process-message`:** un trabajo en espera por correo (`policy: short` y
  `singletonKey = messageId`), 5 reintentos con retroceso exponencial desde 30 s y caducidad de
  30 minutos. Es idempotente: no hace nada si ya hay una decisión válida del mismo modo, y dentro
  del proceso un mismo correo no se procesa dos veces a la vez. Un 404 de Graph (correo movido o
  borrado) termina el trabajo sin error.
- **`Message` desde la detección:** la delta registra el correo como `pending` (remitente y asunto
  vacíos hasta procesarlo) antes de encolarlo; al terminar pasa a `processed` (o `failed`). Así
  «pendientes» y «fallidos» son reales y los cambios del equipo durante el procesado no se pierden.
  Un correo conocido que sigue pendiente se vuelve a encolar. Un correo que da 404 se borra si
  nunca tuvo decisión.
- **Qué se guarda:** al terminar, `Message` y `Decision` en una transacción; `Decision` lleva modelo,
  tokens, coste y latencia del LLM (null si no hubo llamada) y el modo de la ejecución.
- **Cambios del equipo durante el procesado:** actualizan `seenCategories` y el trabajo no los pisa
  al guardar. Si el cambio llega antes de que se extraiga el correo, el clasificador lo trata como
  puesto por el equipo al llegar, no como corrección.
- **Limpieza:** cola `cleanup-attachment-text`, programada cada día a las 03:30 (Europe/Madrid).
- Las peticiones del panel (probar modelo, categorías, reprocesar) usan colas propias
  ([0015](0015-web-sin-credenciales-del-buzon.md)).

## Consecuencias

- Un fallo transitorio no pierde el correo, pero la cola vive en la misma base de datos: una copia
  de seguridad la incluye.
- Un cambio del equipo mientras el correo se procesa no cuenta como corrección (limitación
  conocida).
