# 0023. Reglas desde el panel y revisión de la Bandeja con una regla

- **Estado:** aceptada

## Contexto

Las reglas se daban de alta y se desactivaban a mano en la base de datos. El equipo quiere
gestionarlas desde el panel y, al añadir una, aplicarla también a los correos que esperan en la
Bandeja de entrada, no solo a los que lleguen después. Código: `apps/web/src/app/(panel)/reglas/`,
`apps/web/src/lib/rule-form.ts` y `apps/worker/src/jobs/review-inbox-with-rule.ts`.

## Decisión

- **Cualquier usuario autorizado del panel** crea, activa y desactiva reglas. No se borran:
  desactivar conserva el histórico de «Correos decididos». La tabla guarda quién hizo el último
  cambio (`Rule.updatedBy`) y quién la creó (`createdBy`); las reglas de la semilla no tienen autor.
- **El peso sale del tipo**: CIF y razón social son fuertes; remitente, dominio y palabra clave,
  medias. Así una regla nueva no puede saltarse el orden de decisión
  ([0002](0002-orden-de-decision-del-clasificador.md)).
- **Un cambio de reglas no vuelve a decidir nada por sí solo.** Para eso está «Revisar Bandeja»:
  el panel lo ofrece al crear o activar una regla, y cada regla activa tiene el botón. Encola un
  trabajo `review-inbox-with-rule` (uno en espera por regla) y no espera al resultado.
- **Qué correos se revisan:** los que siguen en la Bandeja de entrada (o sin carpeta comprobada),
  ya decididos y que el equipo no ha revisado: sin corrección y sin categorías puestas por una
  persona. Las que escribió el servicio no cuentan como revisión. Ahí manda lo que puso el equipo
  ([0008](0008-correcciones-y-metrica-de-acierto.md)).
- **Solo se vuelve a decidir donde la regla coincide.** El worker relee cada correo (Graph y
  docling, con la caché de adjuntos), comprueba esa regla y, si coincide, marca el correo para
  reprocesar y lo encola. La nueva decisión usa todas las reglas activas y el LLM si hace falta,
  como cualquier reproceso ([0007](0007-fallos-tecnicos-y-reproceso.md)). Revisar toda la Bandeja
  sin filtrar se descartó: llamaría al LLM en correos que la regla no toca y podría cambiar sus
  decisiones sin motivo.
- **En live escribe como cualquier correo nuevo.** Si la categoría de la regla está en live y el
  worker en modo real, la nueva decisión se escribe en el buzón; el panel lo avisa antes de
  confirmar. Nunca se quitan categorías.

## Consecuencias

- Mientras dura una revisión, los correos que coinciden aparecen un momento como «por reprocesar»
  en el Resumen hasta que el worker los decide.
- Una revisión lee del buzón todos los correos candidatos: con una Bandeja grande tarda minutos y
  el resultado se ve al recargar, en «Correos decididos». Caduca a la hora.
- Una regla media puede coincidir y no decidir (pierde frente a una fuerte o al hilo): el correo se
  vuelve a decidir igualmente y su decisión no cambia.
