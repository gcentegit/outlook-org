# Validación: docling-serve con espera de 1 s en producción

Comprobación de `DOCLING_SERVE_SYNC_POLL_INTERVAL=1`, aplicada a docling en producción el
2026-10-19 a las 14:06 (hora de Madrid), frente a la espera de 2 s por defecto medida en el
[informe anterior](validacion-261019-1345-tiempos-extraccion-produccion.md). Salen de los registros
del worker (`extracción: … (método) en N ms`) y de docling-serve en Dokploy. Aquí solo van cifras
agregadas.

## Resultado

**La variable está aplicada y funciona.** Las respuestas de docling ya no son múltiplos de 2 s:
salen en 1,0 s, 6,0 s, 7,0 s y 8,0 s. Tras terminar la conversión, docling tarda en responder entre
0,3 y 1,0 s; antes, hasta 2 s.

## Fuentes y límites

- Registros de docling: completos desde el redespliegue del 2026-10-19 a las 14:06 hasta el
  2026-10-20 a las 19:06.
- Registros del worker: desde su último arranque (versión 1.3.2), el 2026-10-19 a las 15:01.
- Docling no recibió ningún adjunto hasta el 2026-10-20 a las 08:12. En todo el periodo le
  llegaron 5, todos con respuesta 200. Son pocos: confirman el cambio, pero no dan una media
  fiable por tipo.
- Ninguna extracción falló en el periodo.

## Producción, 2026-10-19 15:01 a 2026-10-20 19:05: 150 extracciones

| Tipo | Extracciones | Cómo se lee | Tiempo en el worker | Conversión real en docling |
|---|---:|---|---|---|
| PDF con texto | 145 | pdf.js, sin docling | mediana 28 ms, media 54 ms (máx. 0,8 s) | — |
| XLSX | 2 | docling sin OCR | 1,0 s las dos | 0,03–0,04 s |
| Imágenes | 1 | docling con OCR | 6,0 s | 4,2 s |
| PDF escaneados | 2 | docling con OCR | 7,0 s y 8,0 s | 5,0 s y 7,7 s |

En cada petición, el tiempo en el worker suma tres partes: la preparación del conversor en docling
(de 0 a 1,2 s según la petición), la conversión y la espera hasta la siguiente comprobación.

## Antes y después de la espera de 1 s

| | Espera de 2 s (2026-10-17 a 19) | Espera de 1 s (2026-10-20) |
|---|---|---|
| XLSX | 2,0 s | 1,0 s |
| Imágenes | 4,0 s (conversión 2,7–3,7 s) | 6,0 s (conversión 4,2 s) |
| PDF escaneados | 10,0 s (conversión 8,5–9,7 s) | 7,0–8,0 s (conversión 5,0–7,7 s) |
| Respuesta tras terminar la conversión | hasta 2 s | 0,3–1,0 s |

- El XLSX es la prueba directa: la conversión dura lo mismo y la respuesta baja de 2,0 a 1,0 s.
- En imágenes y PDF escaneados, el total depende sobre todo de cuánto dura el OCR de cada
  documento. La imagen de hoy tardó más en convertirse que las de antes, y por eso tarda más en
  total. No es un efecto de la espera.
- El ahorro coincide con lo previsto en la prueba local: medio segundo de media por adjunto que
  pasa por docling y un segundo en los XLSX. Con unos 5 adjuntos al día por docling, son pocos
  segundos al día.
