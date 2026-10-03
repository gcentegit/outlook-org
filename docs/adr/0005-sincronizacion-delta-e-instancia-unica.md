# 0005. Sincronización con delta query y una sola instancia

- **Estado:** aceptada

## Contexto

El servicio debe enterarse de los correos nuevos y de los cambios de categorías del equipo con
poca carga sobre Microsoft Graph. Código: `apps/worker/src/sync/`.

## Decisión

- **Sondeo con delta query, no webhooks.** Una sola corriente: la Bandeja de entrada
  (`/mailFolders/inbox/messages/delta`) con `$select=id,receivedDateTime,conversationId,categories`.
- Graph no distingue creados de actualizados en la carga útil, así que se decide por la base de
  datos: correo desconocido = nuevo (se registra y se encola); conocido = posible corrección. Los
  `@removed` (movido o borrado) solo se cuentan: vale la última corrección anterior al movimiento.
- **Primera ronda sin histórico:** sin estado previo se pide solo lo recibido desde hacía un minuto,
  para obtener el `deltaLink` sin reprocesar el histórico (de eso se encarga la importación). El
  minuto de margen cubre el desfase de reloj con Exchange; un duplicado es inocuo por la
  idempotencia.
- **El `deltaLink` se guarda solo al terminar la ronda:** si algo falla, la siguiente ronda repite
  los mismos cambios. Un 410 olvida el `deltaLink` y resincroniza desde la fecha de recepción del
  correo registrado más antiguo (o la última sincronización si no hay ninguno), para seguir viendo
  las correcciones de los correos ya conocidos; un segundo 410 seguido se propaga.
- **Intervalo:** `POLL_INTERVAL_SECONDS` (90 por defecto, recomendado 60-120, admite 15-600), rondas
  secuenciales y nunca solapadas; el cliente respeta `Retry-After`. `WORKER_CONCURRENCY` (2) limita
  los correos en proceso.
- **Una sola instancia:** bloqueo asesor de PostgreSQL (`pg_try_advisory_lock`) en una conexión
  dedicada. Una segunda instancia espera (`/health` 503 «esperando el bloqueo») y toma el relevo
  cuando la primera termina; si la conexión del bloqueo se pierde, el proceso sale para que Swarm
  lo reinicie.
- **Categorías disponibles:** `/outlook/masterCategories` del buzón con caché de 5 minutos; si el
  refresco falla se usa la copia anterior.

## Consecuencias

- El servicio **no debe usar actualización `start-first`** en el despliegue
  ([0018](0018-despliegue-en-dokploy.md)).
- Un correo movido de carpeta deja de verse; la corrección que cuenta es la anterior al
  movimiento.
- Sin credenciales de Graph no hay sincronización.
