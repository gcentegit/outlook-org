# Evaluación del acierto contra las carpetas (solo reglas)

Fecha: 2026-10-13. Fase 10. Solo cifras agregadas; los casos y el detalle por correo están en
`data/history/evaluacion/` (fuera de git).

## Resultado

Con solo reglas, sin LLM, **LATERAL acierta casi siempre (98,7 %)** pero se queda corto de
cobertura (74 %). **FOOD BOX acierta el 93,1 %** y cubre el 84,5 %. Ninguna llega todavía al objetivo
(95 % de precisión y 90 % de cobertura, con reglas y LLM). Casi todos los «fallos» de precisión son
documentos con varias sociedades del grupo, que hay que revisar a mano antes de darlos por errores.

## Cómo se ha medido

- **Muestra:** 800 correos al azar (semilla fija), 400 del árbol Foodbox y 400 del árbol Lateral,
  recibidos entre el 2026-05-01 y el 2026-10-09 ([`build-eval-cases.ts`](../../apps/worker/scripts/build-eval-cases.ts)).
- **Lectura:** cada correo se leyó del buzón y se extrajo con el mismo código y la misma
  configuración de docling que el worker en producción. Solo lectura; ningún dato salió fuera.
- **Verdad:** el árbol donde el equipo archivó el correo (Foodbox → FOOD BOX, Lateral → LATERAL)
  más las etiquetas que hubiera puesto.
- **Clasificador:** las 16 reglas de producción (CIF y razón social con sus variantes), los dominios
  del grupo y el umbral 0,8, sin LLM ([`evaluate.ts`](../../apps/worker/scripts/evaluate.ts)). La
  herencia del hilo solo ve los correos de la muestra, así que en producción cubre algo más.

## Cifras

| Categoría | Precisión | Cobertura | Aciertos | Falsos positivos | No detectados |
| --- | ---: | ---: | ---: | ---: | ---: |
| FOOD BOX | 93,1 % | 84,5 % | 338 | 25 | 62 |
| LATERAL | 98,7 % | 74,0 % | 296 | 4 | 104 |

Por periodo, para ver si las reglas se ajustaron demasiado a los correos con los que se sacaron
(fase 9, antes del 2026-08-20):

| Periodo | Correos | FOOD BOX (precisión / cobertura) | LATERAL (precisión / cobertura) |
| --- | ---: | --- | --- |
| 2026-05-01 a 2026-08-19 | 518 | 94,3 % / 84,8 % | 98,5 % / 74,0 % |
| 2026-08-20 a 2026-10-09 | 282 | 91,0 % / 84,0 % | 99,0 % / 73,9 % |

Los dos tramos dan casi lo mismo: la cifra total es representativa de lo que llega ahora.

## Qué explica los fallos

**ARCOBETA se archiva en Lateral.** De los 49 correos con ARCOBETA, 48 están en el árbol Lateral.
Confirma la sospecha de la fase 9. Si se cuenta ARCOBETA como acierto dentro de Lateral, el
clasificador encuentra la sociedad en 336 de 400 correos de ese árbol (84 %).

**FOOD BOX en correos de Lateral (25).** En 20 de ellos el documento nombra también a LATERAL o a
ARCOBETA: facturas o documentos con varias sociedades del grupo, posiblemente facturas entre
sociedades donde FOODBOX es el emisor y no el cliente. Los otros 5 solo tienen FOOD BOX. No se
pueden dar por errores sin mirarlos: la carpeta solo admite una sociedad.

**No detectados (166).**

| Causa | FOOD BOX | LATERAL |
| --- | ---: | ---: |
| Sin adjuntos (respuestas, avisos, conversaciones) | 46 | 52 |
| Con adjunto leído sin CIF ni razón social del grupo | 16 | 47 |
| Solo adjuntos no leídos (`.eml`, `.msg`, demasiado grandes) | 0 | 5 |

Los correos sin adjuntos son el grueso. Tres de cada cuatro (72 de 98) vienen de remitentes del grupo, que reenvían o
responden sin factura. En producción parte de ellos los cubre la herencia del hilo; el resto es
trabajo del LLM o de reglas de remitente.

## Qué sigue

1. Revisar a mano los 29 correos con una sociedad que no es la de su carpeta (25 con FOOD BOX en
   Lateral y 4 con LATERAL en Foodbox, uno de ellos también con ARCOBETA), para separar errores de
   documentos con varias sociedades. La hoja, con enlace a cada correo, está en
   `data/history/evaluacion/revision-sociedad-distinta-de-la-carpeta.csv`: esos 29 van primero y
   después los 41 que solo añaden ARCOBETA en Lateral.
2. Decidir si ARCOBETA cuenta como acierto en el árbol Lateral.
3. Medir cuánto sube la cobertura con reglas de remitente y con el LLM (local o externo), cuando el
   usuario lo decida tras hablar con el equipo de Proveedores.

## Preguntas abiertas

- ¿Las facturas entre sociedades del grupo deben llevar la categoría de las dos, solo la del cliente
  o ninguna?
- ¿Se cuenta ARCOBETA como acierto cuando el correo está en el árbol Lateral?
