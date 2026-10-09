# 0008. Correcciones del equipo y métrica de acierto

- **Estado:** aceptada

## Contexto

El servicio necesita saber cuándo el equipo discrepa de lo que propone, y el acierto tiene que
medirse de forma honesta. Hoy el equipo pone las etiquetas FOOD BOX y LATERAL solo a veces, y
ARCOBETA no existió hasta el 2026-10-09, así que el histórico no es una verdad completa. Código:
`apps/worker/src/corrections.ts` y `apps/web/src/server/metrics.ts`.

## Decisión

**Correcciones**

- Un cambio de categorías en un correo ya registrado se compara con su última decisión, solo en
  FOOD BOX/LATERAL/ARCOBETA y sin importar el orden. En modo sombra todo cambio es del equipo. En
  modo live, un cambio que solo suma lo decidido por el servicio es propio y se ignora.
- Si el equipo vuelve a dejar lo propuesto después de haberlo corregido, se registra una corrección
  con `proposed` igual a `final`, para que la última corrección de cada correo sea la vigente. Un
  acuerdo sin corrección previa no se registra. `Message.seenCategories` se actualiza siempre que
  algo cambie.

**Métrica**

- **Solo cuentan los correos que el equipo ha revisado**: los que tienen alguna categoría en
  Outlook (aunque no sea de las tres) o una corrección. Los demás no suman ni como acierto ni como
  fallo (ni por categoría, ni por modelo, ni en las discrepancias) y se muestran aparte como
  «pendientes de revisar». Las decisiones degradadas tampoco cuentan.
- El panel limita el rango de fechas a 366 días (carga en memoria los correos del periodo).
- **La verdad de referencia es una muestra de unos 200 correos revisada a mano**, no el histórico
  tal cual: el equipo no etiqueta siempre. El histórico sirve para sacar reglas candidatas y
  discrepancias, no para puntuar.
- Criterio de aceptación: precisión ≥ 95 % por categoría contra esa muestra **y** una cobertura
  mínima por categoría, cuya cifra se fijará con los datos del descubrimiento (decisión pendiente
  del usuario).

## Consecuencias

- Sin revisión humana no hay acierto: durante el modo sombra hace falta revisar una muestra
  semanal en el panel.
- Un sistema que etiquetara el 5 % de los correos con un 100 % de precisión cumpliría solo el
  primer criterio; por eso se exige también cobertura.
- En modo live las categorías puestas por el servicio se mezclarían con las del equipo y el acierto
  saldría más optimista.
