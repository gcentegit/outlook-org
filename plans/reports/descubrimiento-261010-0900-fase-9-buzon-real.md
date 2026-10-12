# Descubrimiento del buzón real (fase 9)

Fecha: 2026-10-09. Solo lectura: no se escribió ni se movió nada en el buzón. Este informe lleva
solo cifras agregadas; los listados, la muestra y la hoja de revisión están en `data/history/`
(fuera de git).

## Resultado

Las reglas fuertes (CIF y razón social de las siete sociedades), sin LLM, encuentran la sociedad
correcta en el 82 % de los correos de la carpeta Foodbox y en el 76 % de los de Lateral. La
carpeta donde el equipo archiva cada correo resulta ser una verdad de referencia mucho más completa
que las etiquetas, y pasa a ser la base de la medición
([ADR 0008](../../docs/adr/0008-correcciones-y-metrica-de-acierto.md)).

## Volumen (últimos 6 meses, importación completa)

| Medida | Valor |
| --- | --- |
| Correos importados (todas las carpetas) | 22.483 |
| Recibidos (sin Enviados ni Borradores) | 19.244 |
| Correos al día | 105 de media; 138 por día laborable |
| Con adjuntos | 75 % |
| Con FOOD BOX, LATERAL o ARCOBETA puesto por el equipo | 27,6 % (FOOD BOX 5.161; LATERAL 176; ARCOBETA 0; ambas 21) |
| Reglas de servidor en la Bandeja de entrada | Ninguna |

## Dónde acaban los correos

El equipo mueve a mano casi todos los correos de la Bandeja de entrada a subcarpetas: en ella solo
quedan 49, los de los últimos días.

| Árbol de carpetas | Correos | Con etiqueta FOOD BOX | Con etiqueta LATERAL |
| --- | ---: | ---: | ---: |
| Foodbox | 8.342 | 5.087 | 2 |
| Lateral | 9.517 | 2 | 144 |
| Otras (Tesorería, Programas, Albaranes…) | 1.336 | 70 | 24 |
| Bandeja de entrada | 49 | 2 | 6 |

Consecuencias:

- La carpeta y la etiqueta casi nunca se contradicen, y la carpeta cubre todos los correos.
- El worker sigue solo la Bandeja de entrada. Funciona porque los correos pasan ahí horas o días
  antes de moverse, pero si el worker está parado más tiempo que eso, esos correos no se procesan.
- ARCOBETA no tiene carpeta ni etiquetas: en la muestra, las reglas lo encuentran sobre todo en
  correos archivados en Lateral.

## Muestra con adjuntos (150 correos: 50 por árbol)

| Árbol | Reglas encuentran la sociedad de la carpeta | Reglas encuentran también otra | CIF o razón social del grupo en el adjunto |
| --- | ---: | ---: | ---: |
| Foodbox (50) | 41 (82 %) | 3 | 35 (70 %) |
| Lateral (49) | 37 (76 %) | 4 | 34 (69 %) |
| Otras (50) | 33 con alguna sociedad | 6 con varias | 27 (54 %) |

- Un correo falló por un error pasajero de Graph (502).
- Adjuntos `.eml`, `.msg` o de tipo elemento: 4 de 149 correos (2,7 %).
- Docling tardó unos 20 s por correo en CPU y pasó por OCR 162 de 184 adjuntos convertidos, casi
  siempre por logos y sellos. Las mejoras de velocidad son tareas de la fase 10.

## Revisión a mano

Se preparó una hoja con 80 correos dudosos: 50 de otras carpetas, 21 con FOOD BOX y LATERAL a la
vez y 9 con carpeta, etiqueta o reglas en conflicto. El usuario revisó una parte y dio por buenas
las sociedades que proponían las reglas. Fue una comprobación parcial, no una verdad completa: los
casos de varias sociedades y ARCOBETA se seguirán revisando en el modo sombra.

## Decisiones del usuario (2026-10-09 y 2026-10-10)

- Verdad de referencia: la carpeta más una revisión corta de los casos dudosos.
- Cobertura mínima: 90 % para FOOD BOX y LATERAL con reglas y LLM, con precisión ≥ 95 %. ARCOBETA
  sin mínimo hasta tener datos del modo sombra.
- Se adelanta el despliegue en Dokploy en modo sombra, con un dominio temporal; las dos semanas de
  observación de la fase 11 siguen contando tras la fase 10.

## Preguntas abiertas

- ¿Archiva el equipo lo de ARCO BETA en la carpeta Lateral? Las reglas lo apuntan; se confirmará
  con el modo sombra.
- ¿Deben llevar categoría los correos de otras carpetas (Tesorería, Programas…) cuando el
  documento es de una sociedad del grupo? Las reglas se la ponen hoy.
