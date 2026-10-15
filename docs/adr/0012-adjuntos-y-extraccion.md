# 0012. Extracción de adjuntos: capa de texto, docling y límites conocidos

- **Estado:** aceptada (con un límite conocido sin medir)

## Contexto

El CIF de la sociedad facturada suele estar en una factura adjunta, normalmente un PDF con capa de
texto y a veces un escaneo. Código: `apps/worker/src/extract/` y `apps/worker/src/graph/messages.ts`.

## Decisión

- **La capa de texto de los PDF se lee en el worker**, con pdf.js (`pdfjs-dist`), sin docling. Casi
  todas las facturas la traen y basta para el CIF y la razón social. Con datos reales tarda unos 30
  ms por PDF, frente a unos 2,6 s con docling sin OCR, y no se perdió ninguna categoría
  ([medición](../../plans/reports/validacion-261014-2235-extraccion-hibrida.md)).
- **docling-serve (versión CPU) solo para lo demás**, como servicio independiente: los PDF sin capa
  de texto o que pdf.js no abre, con OCR RapidOCR; las imágenes, siempre con OCR; DOCX y XLSX, sin
  OCR. Nunca se calcula la estructura de tablas. Solo CPU: el servidor es arm64 sin GPU. Con datos
  reales, el OCR sobre PDF con texto solo leía logos y sellos: no aportó ningún CIF ni razón social
  y multiplicaba el tiempo por diez
  ([medición](../../plans/reports/validacion-261012-1530-velocidad-extraccion.md)).
- Se descartó PaddleOCR en lugar de docling: con OCR no es más rápido y en arm64 solo funciona sin
  oneDNN ([medición](../../plans/reports/validacion-261013-0110-paddleocr-y-extraccion-hibrida.md)).
- Se leen adjuntos `fileAttachment` que no sean inline, de tipo PDF, imagen (png, jpg, tiff), DOCX
  o XLSX; la extensión del nombre manda sobre el tipo MIME. Los demás se registran y se omiten.
- Límites configurables: `ATTACHMENT_MAX_BYTES` (15 MiB por defecto; los mayores se omiten sin
  descargarlos) y `ATTACHMENT_MAX_PAGES` (2 por defecto, porque el CIF suele estar en la primera
  página).
- Un mismo fichero reenviado varias veces se convierte una vez: la caché es por SHA-256, límite de
  páginas y versión del método ([0009](0009-modelo-de-datos.md)). Un resultado vacío no se cachea.
- Los fallos de docling se tratan según [0007](0007-fallos-tecnicos-y-reproceso.md).

## Consecuencias

- **Límite conocido:** los adjuntos que son un correo (`.eml`, `.msg`, `itemAttachment`) no están
  soportados: no se leen ni se avisa de ellos. Un reenvío que adjunta el correo original pierde el
  PDF que lleva dentro. No se ha medido cuántos casos hay; el descubrimiento con datos reales
  debe contarlos para decidir si se soportan o se descartan de forma informada.
- Si los escaneos dan mal resultado con RapidOCR, la alternativa a probar es PP-OCRv5 mobile.
- pdf.js corre en el propio proceso del worker: un PDF muy pesado ocupa su CPU mientras se lee. Lo
  acotan el tamaño máximo, el límite de páginas y el tiempo máximo (`DOCLING_TIMEOUT_SECONDS`).
- Un PDF cuya capa de texto no contiene el CIF pero sí lo lleva dibujado (en un sello o una imagen)
  no se lee con OCR. En la muestra real no hubo ningún caso; si aparecen, se verán como dudosos.
- Los textos extraídos son datos de terceros ([0010](0010-retencion-y-datos-de-terceros.md)).
