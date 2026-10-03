# 0002. Orden de decisión del clasificador

- **Estado:** aceptada

## Contexto

Cada categoría se decide por separado con varias señales: el CIF o la razón social de la sociedad
facturada, la conversación a la que pertenece el correo, palabras clave y un LLM. Hace falta un
orden claro cuando las señales se contradicen. El código está en `apps/worker/src/classify/`.

## Decisión

Para cada categoría, de más a menos prioridad:

1. **Regla fuerte** (CIF o razón social de una de las siete sociedades, en el propio correo).
   Gana a lo heredado del hilo (decisión del usuario: en un hilo manda el CIF). Si el correo
   identifica una sociedad del grupo, las categorías de las otras sociedades se descartan sin
   mirar nada más.
2. **Herencia del hilo:** una respuesta hereda la categoría de otro correo de la misma
   conversación. Se usan las **categorías finales del equipo**: por cada correo del hilo, la
   última corrección si existe; si no, las categorías que tiene en Outlook; solo si nadie lo ha
   revisado, la última decisión del sistema. Una decisión que el equipo corrigió, o que dejó sin
   categorías, no se hereda.
3. **Regla media** (palabras clave, remitente, dominio).
4. **LLM**, solo para las categorías en duda que existen en el buzón y que el equipo no puso ya.
5. **Duda:** sin categoría y marcado para revisión.

Además:

- **Umbral de confianza 0,8** (`CLASSIFY_CONFIDENCE_THRESHOLD`): una respuesta por debajo pasa a
  duda.
- **El pie de firma interno no dispara reglas fuertes.** Si el remitente es de un dominio del grupo
  (`INTERNAL_EMAIL_DOMAINS`, sin valor por defecto), el CIF y la razón social solo cuentan en los
  adjuntos y en el bloque reenviado o citado del cuerpo; el asunto y el resto del cuerpo no. Con
  remitente externo no cambia nada. Si el reenvío no tiene una marca reconocible, el cuerpo no
  cuenta y decide el adjunto o el LLM.
- Solo cuentan los siete CIF del grupo: en una factura también aparece el del proveedor. La
  dirección fiscal no sirve, porque las siete sociedades la comparten.
- El clasificador solo **propone**: la fusión con las categorías del equipo corresponde a quien
  las aplique.

## Consecuencias

- Antes la herencia del hilo iba por delante de las reglas fuertes; ya no.
- Un reenvío interno sin marca de reenvío reconocible depende del adjunto o del LLM.
- La decisión guarda el motivo en texto (`reason`) para poder auditarla.
