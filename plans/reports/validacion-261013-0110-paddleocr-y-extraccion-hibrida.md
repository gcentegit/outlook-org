# Validación: PaddleOCR frente a docling y extracción híbrida

Prueba del 2026-10-13 para ver si PaddleOCR es más rápido que docling con la misma precisión. Se
usaron los adjuntos de la [prueba de velocidad](validacion-261012-1530-velocidad-extraccion.md)
(185 adjuntos de la muestra de la fase 9, en `data/history/`, fuera de git), en el mismo servidor
arm64 sin GPU. Acierto: las mismas reglas fuertes del clasificador (CIF y razón social) aplicadas al
texto de cada adjunto, comparadas con lo que da docling con su configuración actual. Aquí solo van
cifras agregadas.

## Variantes

- **PaddleOCR siempre:** PaddleOCR 3.7 (modelos PP-OCRv5 *mobile*, reconocimiento latino) sobre las
  dos primeras páginas de cada PDF rasterizadas a 144 ppp.
- **Híbrida:** el texto propio del PDF se lee con `pypdfium2`, sin docling; solo los PDF sin texto
  (menos de 50 caracteres alfanuméricos, el mismo umbral del worker) y las imágenes pasan por
  PaddleOCR. Es distinto de la opción `pypdfium2` de docling medida el 2026-10-12, que sigue pasando
  por docling.

## Resultado

| Variante | Adjuntos | Tiempo medio por adjunto | Misma categoría | Pierden | Ganan |
|---|---:|---:|---:|---:|---:|
| docling actual (texto; OCR si no hay) | 185 | 2,6 s | — | — | — |
| docling con OCR siempre (configuración anterior) | 40 | 22 s | — | — | — |
| PaddleOCR siempre | 40 | 27,2 s | 40 | 0 | 0 |
| Híbrida | 179 | 0,15 s | 176 | 0 | 3 |

- PaddleOCR siempre se paró a los 40 de los 62 adjuntos de la submuestra: el resultado ya era
  estable. Acierta lo mismo que docling con OCR, pero es algo más lento. docling ya usa modelos de
  Paddle por dentro (PP-OCR con RapidOCR).
- PaddlePaddle 3.2 en arm64 se cae (segmentation fault) con oneDNN activado; solo funciona sin él.
- En la híbrida, leer la capa de texto tarda 5 ms de media por adjunto; solo 3 de 179 pasan por
  OCR (12 a 14 s cada PDF). Los 6 XLSX quedan fuera: ni PaddleOCR ni `pypdfium2` los leen.
- Los 3 adjuntos que ganan categoría: uno archivado en `Foodbox` gana FOOD BOX (CIF y razón
  social); otro está en un correo que ya era FOOD BOX por otros adjuntos; el tercero, archivado
  fuera de `Foodbox` y `Lateral`, gana LATERAL solo por razón social y está por revisar a mano.
  Sin comprobar: docling podría quitar cabeceras y pies de página al exportar a Markdown.

## Conclusión

PaddleOCR no sustituye a docling: no es más rápido y añade un servicio de Python delicado en arm64.
Lo que acelera la extracción es no pasar por docling los PDF con texto propio. El usuario decide
apuntar al plan la migración a la extracción híbrida, con docling solo para escaneos, imágenes y
ficheros de Office (fase 10).

## Pendiente

- Revisar a mano el adjunto que gana LATERAL.
- Repetir la medición con la librería de Node que se elija para el worker, que puede extraer el texto
  de otra forma que `pypdfium2`.
