# 0012. Extracción de adjuntos con docling y límites conocidos

- **Estado:** aceptada (con un límite conocido sin medir)

## Contexto

El CIF de la sociedad facturada suele estar en una factura adjunta, normalmente un PDF con capa de
texto y a veces un escaneo. Código: `apps/worker/src/extract/` y `apps/worker/src/graph/messages.ts`.

## Decisión

- La conversión la hace **docling-serve (versión CPU)** como servicio independiente, con OCR
  RapidOCR solo cuando hace falta. Solo CPU: el servidor es arm64 sin GPU.
- Se leen adjuntos `fileAttachment` que no sean inline, de tipo PDF, imagen (png, jpg, tiff), DOCX
  o XLSX; la extensión del nombre manda sobre el tipo MIME. Los demás se registran y se omiten.
- Límites configurables: `ATTACHMENT_MAX_BYTES` (15 MiB por defecto; los mayores se omiten sin
  descargarlos) y `ATTACHMENT_MAX_PAGES` (2 por defecto, porque el CIF suele estar en la primera
  página).
- Un mismo fichero reenviado varias veces se convierte una vez: la caché es por SHA-256
  ([0009](0009-modelo-de-datos.md)). Un resultado vacío no se cachea.
- Los fallos de docling se tratan según [0007](0007-fallos-tecnicos-y-reproceso.md).

## Consecuencias

- **Límite conocido:** los adjuntos que son un correo (`.eml`, `.msg`, `itemAttachment`) no están
  soportados: no se leen ni se avisa de ellos. Un reenvío que adjunta el correo original pierde el
  PDF que lleva dentro. No se ha medido cuántos casos hay; el descubrimiento con datos reales
  debe contarlos para decidir si se soportan o se descartan de forma informada.
- Si los escaneos dan mal resultado con RapidOCR, la alternativa a probar es PP-OCRv5 mobile.
- Los textos extraídos son datos de terceros ([0010](0010-retencion-y-datos-de-terceros.md)).
