# 0007. Fallos técnicos frente a decisiones válidas, y reproceso

- **Estado:** aceptada

## Contexto

Si docling o el LLM fallan, decidir «sin categoría» sería engañoso: el correo no es dudoso, es que
faltó información. Código: `apps/worker/src/jobs/process-message.ts` y `apps/worker/src/extract/`.

## Decisión

- **Se distingue un fallo técnico de una decisión válida.** Son fallos técnicos: docling caído
  (conexión rechazada o cortada, tiempo agotado, 408, 429, 502, 503, 504), descarga de adjunto con
  error de servidor o de red, y LLM fallido.
- Ante un fallo pasajero el trabajo **lanza** y pg-boss reintenta con retroceso (5 reintentos, unos
  15 minutos). Agotados los reintentos se guarda la decisión marcada `Decision.degraded` y el
  correo con `Message.needsReprocess`.
- Un LLM **no disponible** (hay modelo activo pero falta su clave, o se agotó el presupuesto) no se
  arregla solo: la decisión se guarda degradada a la primera, sin reintentos.
- **Sin modelo activo** no hay fallo: el LLM se desactivó en el panel (Modelos) a propósito, se
  decide solo con reglas y lo que no resuelvan queda en duda, sin marcar para reprocesar. Al volver
  a activar un modelo, esas dudas no se reprocesan solas.
- Un fichero que docling no sabe convertir (4xx, 500, `failure`) **no** es un fallo técnico: se
  omite el adjunto, sin más.
- Un trabajo que agota los reintentos sin decisión deja el correo `failed` y marcado.
- Una decisión degradada no cuenta como decisión válida para la idempotencia, no entra en las
  métricas ni en el acierto por modelo, y se sustituye al reprocesar (nueva `Decision`; la vigente
  es la más reciente).
- **Reproceso:** botón en el Resumen del panel y `pnpm --filter @clasificador/worker reprocess`
  (`--dry-run` solo cuenta). Vuelven a encolar los correos con `needsReprocess`; el botón encola un
  trabajo `reprocess-flagged` y espera a que el worker responda cuántos eran. Un marcado que el
  equipo ya archivó también se reprocesa: se encuentra por su conversación y su fecha de recepción
  ([0006](0006-cola-de-trabajos-con-pg-boss.md)). Solo uno que ya no está en el buzón se queda con
  su decisión y sin marca. El botón dice cuántos esperan al LLM sin configurar, que seguirán marcados.

## Consecuencias

- Una caída larga de docling o del LLM se ve en el panel como correos pendientes, fallidos o por
  reprocesar, no como un acierto o fallo del clasificador.
- Quien opere el servicio tiene que reprocesar los marcados tras resolver la causa.
