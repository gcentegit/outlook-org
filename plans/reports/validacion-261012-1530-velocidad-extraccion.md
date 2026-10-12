# Validación: velocidad de la extracción de adjuntos

Tareas de velocidad de la fase 10. Se midió con los adjuntos de la muestra de la fase 9 (150
correos, 185 adjuntos: 178 PDF, 6 XLSX y 1 imagen), bajados a `data/history/` (fuera de git), contra
docling-serve 1.36.0 en CPU arm64, la misma versión que en Dokploy. Aquí solo van cifras agregadas.

## Variantes (submuestra fija de 62 adjuntos, uno de cada tres)

| Variante | Tiempo medio por adjunto | Adjuntos con CIF |
|---|---:|---:|
| Configuración anterior (OCR siempre, tablas, 2 páginas) | 22,5 s | 39 |
| Sin OCR y sin tablas, 2 páginas | 2,6 s | 39 |
| Sin OCR, lector `pypdfium2` | 2,6 s | 38 |
| Sin OCR, solo la primera página | 2,3 s | 38 |

- Todo CIF que encontraba la configuración anterior lo encuentra también la variante sin OCR. Los
  PDF sin CIF ya traían su texto: el OCR solo añadía unos 30 caracteres de logos y sellos.
- `pypdfium2` no gana tiempo y la primera página sola pierde un CIF: se descartan.
- `images_scale` y `ocr_lang` solo afectan al OCR, que ahora casi no se usa: no se cambian.

## Configuración elegida, validada con los 185 adjuntos

Un PDF se convierte sin OCR ni tablas; solo si no trae texto propio se repite con OCR. Las imágenes
van siempre con OCR. Se midió con el código real del worker y la misma regla fuerte del clasificador
(CIF y razón social).

| | Antes (fase 9) | Ahora |
|---|---:|---:|
| Tiempo medio por correo con adjuntos | unos 20 s | 4,5 s |
| Tiempo medio por adjunto | unos 22 s | 2,6 s |
| Adjuntos que pasan por OCR | 162 de 184 | 2 de 185 |
| Correos con la misma categoría en el adjunto | — | 149 de 150 |
| Correos que pierden una categoría | — | 0 |

El correo distinto gana una categoría que antes no salía.

## Lo que queda

- Las imágenes pequeñas que llegan como adjunto normal (logos de firma) solo eran 1 de 185: no
  compensa tratarlas aparte por ahora.
- Un PDF cuya capa de texto no tenga el CIF pero lo lleve dibujado no se lee con OCR. No hubo
  ningún caso en la muestra; lo dirá el modo sombra.
