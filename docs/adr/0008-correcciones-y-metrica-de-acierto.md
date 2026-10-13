# 0008. Correcciones del equipo y métrica de acierto

- **Estado:** aceptada

## Contexto

El servicio necesita saber cuándo el equipo discrepa de lo que propone, y el acierto tiene que
medirse de forma honesta. Hoy el equipo pone las etiquetas FOOD BOX y LATERAL solo a veces, y
ARCOBETA no existió hasta el 2026-10-09, así que el histórico no es una verdad completa. Código:
`apps/worker/src/corrections.ts`, `apps/worker/src/sync/folders.ts` y
`apps/web/src/server/metrics.ts`.

## Decisión

**Correcciones**

- Un cambio de categorías en un correo ya registrado se compara con su última decisión, solo en
  FOOD BOX/LATERAL/ARCOBETA y sin importar el orden. En modo sombra todo cambio es del equipo. En
  modo live, un cambio que solo suma lo que escribió el servicio (`AppliedCategory`, no la decisión
  entera: con la activación por categoría puede escribir solo una parte) es propio y se ignora.
- Si el equipo vuelve a dejar lo propuesto después de haberlo corregido, se registra una corrección
  con `proposed` igual a `final`, para que la última corrección de cada correo sea la vigente. Un
  acuerdo sin corrección previa no se registra. `Message.seenCategories` se actualiza siempre que
  algo cambie.

**Métrica**

- **Solo cuentan los correos que el equipo ha revisado**: los archivados en el árbol de una
  sociedad y los que tienen alguna categoría en Outlook (aunque no sea de las tres) o una
  corrección. Los demás no suman ni como acierto ni como fallo (ni por categoría, ni por modelo, ni
  en las discrepancias) y se muestran aparte como «sin contrastar». Las decisiones degradadas
  tampoco cuentan.
- **Con solo la carpeta se comparan FOOD BOX y LATERAL.** La carpeta no dice nada de ARCOBETA, que
  no tiene árbol propio y se archiva en Lateral: ARCOBETA solo se compara cuando el equipo pone una
  categoría del grupo. Las categorías del equipo se suman a la de la carpeta.
- **El árbol Lateral vale por «LATERAL o ARCOBETA»** (provisional, hasta que el equipo diga cómo
  archiva ARCOBETA): si la propuesta o el equipo dicen ARCOBETA, la carpeta no cuenta como LATERAL
  ni como fallo de LATERAL.
- El panel limita el rango de fechas a 366 días (carga en memoria los correos del periodo).
- **La verdad de referencia es la carpeta donde el equipo archiva cada correo**, más una revisión
  a mano de los casos que la carpeta no resuelve. El descubrimiento mostró que el equipo mueve casi
  todos los correos de la Bandeja de entrada a subcarpetas: el árbol `Foodbox` corresponde a
  FOOD BOX y el árbol `Lateral` a LATERAL, y casi nunca contradicen las etiquetas, que el equipo
  pone solo a veces. Los correos de otras carpetas, los de varias sociedades y ARCOBETA (sin
  carpeta propia) necesitan revisión a mano o el modo sombra.
- Criterio de aceptación: precisión ≥ 95 % por categoría **y** cobertura ≥ 90 % para FOOD BOX y
  LATERAL, con reglas y LLM, medidas contra esa verdad. ARCOBETA no tiene cobertura mínima hasta
  tener datos del modo sombra.

## Consecuencias

- La sincronización solo sigue la Bandeja de entrada, así que no ve a qué carpeta se mueve un
  correo. El worker lo comprueba aparte cada hora y cuando se pide desde el panel: busca cada correo
  por su conversación y su fecha de recepción (el id de Graph cambia al moverlo), guarda la carpeta
  en `Message.folder` (con su ruta en `folderPath`, que el panel muestra en «Correos») y, fuera de la Bandeja, anota también sus categorías con la misma lógica que
  la sincronización (con su corrección, si la hay). Los que siguen en la Bandeja se miran en cada
  ronda; los archivados en el último mes, una vez al día; los que ya no están, nunca más. Solo lee
  el buzón.
- Un correo de varias sociedades archivado en una sola carpeta cuenta como fallo de la otra
  categoría: la carpeta solo admite una sociedad. Hasta que el equipo decida qué hacer con las
  facturas entre sociedades, esos casos se revisan a mano.
- Sin revisión humana no hay acierto: durante el modo sombra hace falta revisar una muestra
  semanal en el panel.
- Un sistema que etiquetara el 5 % de los correos con un 100 % de precisión cumpliría solo el
  primer criterio; por eso se exige también cobertura.
- En modo live las categorías puestas por el servicio se mezclarían con las del equipo y el acierto
  saldría más optimista.
