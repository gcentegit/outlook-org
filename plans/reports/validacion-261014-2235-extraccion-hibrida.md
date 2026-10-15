# Validación: extracción híbrida con pdf.js

Migración decidida el 2026-10-13 tras la
[prueba de PaddleOCR](validacion-261013-0110-paddleocr-y-extraccion-hibrida.md): el worker lee la
capa de texto de los PDF con pdf.js (`pdfjs-dist`) y docling queda para los PDF sin texto, las
imágenes, DOCX y XLSX. Se midió con el código real del worker, antes (el de `main`, todo por docling)
y después, sobre los 185 adjuntos de la muestra de la fase 9 (105 correos), en `data/history/`, fuera
de git, con docling-serve local en el mismo servidor arm64. Las categorías salen de las reglas
fuertes actuales (CIF y razón social) aplicadas a los dos textos. Aquí solo van cifras agregadas.

## Tiempo por adjunto, con y sin OCR

| | Adjuntos | Antes | Ahora |
|---|---:|---:|---:|
| Sin OCR (PDF con texto y XLSX) | 183 | 4,3 s | 0,12 s |
| — de ellos, PDF con texto | 176 | 4,3 s | 0,03 s |
| — de ellos, XLSX (siguen en docling) | 6 | 2,0 s | 2,0 s |
| Con OCR (PDF escaneados; siguen en docling) | 2 | 22,0 s | 18,1 s |
| **Todos** | **185** | **4,5 s** | **0,31 s** |
| Total de la muestra | 185 | 824 s | 58 s |

- El «antes» de hoy salió más lento que los 2,6 s por adjunto medidos el 2026-10-12 porque durante
  la medición corrían las pruebas del repositorio en la misma máquina. Contra aquella cifra, un PDF
  con texto pasa de unos 2,5 s a 0,03 s.
- La única imagen de la muestra sigue yendo a docling con OCR; no tiene texto legible, así que
  docling no informa OCR y cuenta en la fila «sin OCR».

## Categorías

- Adjuntos con la misma categoría que antes: 183 de 185.
- Correos con la misma categoría que antes: 104 de 105. Ninguno pierde una categoría; uno gana.

- El correo que gana FOOD BOX está archivado en `Foodbox`: el CIF y la razón social están en la
  capa de texto del PDF y docling no los sacaba. El otro adjunto que cambia gana FOOD BOX en un
  correo que ya era FOOD BOX por otros adjuntos.
- El adjunto que en la prueba con `pypdfium2` ganaba LATERAL ya no cambia: con las reglas actuales
  los dos métodos dan lo mismo. No queda nada por revisar a mano.

## Cambios

- La caché de texto de adjuntos lleva la versión del método en la clave: los textos guardados con
  docling no se reutilizan; cada adjunto se vuelve a leer la próxima vez que haga falta.
- Las páginas del PDF se separan con un salto de página, el que espera `firstPage` del prompt.
- La imagen del worker incluye `pdfjs-dist`; se construyó y leyó un PDF dentro del contenedor.
