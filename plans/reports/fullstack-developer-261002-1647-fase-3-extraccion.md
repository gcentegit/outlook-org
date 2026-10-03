# Fase 3: extracción de correo y adjuntos

Fecha: 2026-10-02. Sin commits, sin tocar Microsoft 365 ni Dokploy.

## Qué se hizo

- `apps/worker/src/graph/client.ts`: cliente Graph mínimo sobre `fetch` con token de `ClientCertificateCredential` (`createGraphClient`). GET JSON/binario, paginación por `@odata.nextLink` y reintentos en 429/503/504 respetando `Retry-After` (segundos o fecha HTTP; sin cabecera, retroceso exponencial; si pide más de 60 s falla en vez de esperar).
- `graph/messages.ts`: `getMessage` con `$select` mínimo (subject, from, toRecipients, body, categories, hasAttachments, receivedDateTime, internetMessageId, conversationId), `listFileAttachments` (solo `#microsoft.graph.fileAttachment`, sin `isInline`, sin descargar contenido) y `downloadAttachment` (`/$value`).
- `extract/message-text.ts`: HTML a texto plano (sin hrefs, imágenes ni estilos).
- `extract/docling.ts`: `detectAttachmentKind` (PDF, png/jpg/tiff, DOCX, XLSX; manda la extensión, el MIME es respaldo porque Outlook usa a menudo `octet-stream`) y `convertWithDocling` (`POST /v1/convert/file`, `to_formats=md`, `do_ocr=true`, `ocr_preset=rapidocr`, `page_range=[1,N]` solo en PDF, `document_timeout`).
- `extract/attachment-text.ts`: caché por SHA-256 en `AttachmentText` (`expiresAt` = ahora + 90 días). Si hay entrada vigente no se llama a docling. Un fallo de docling deja el adjunto con markdown vacío y `method: 'skipped'`, se registra y no se cachea. Un resultado vacío tampoco se cachea.
- `extract/extract-email.ts`: `extractEmail(messageId, deps)` devuelve el `ExtractedEmail` (tipo de `@clasificador/shared`, sin modificar). Los adjuntos no soportados o por encima del límite se omiten sin descargarlos; un fallo en un adjunto no afecta al correo.
- `config.ts` (solo añadidas): `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PATH`, `MAILBOX` (opcionales hasta tener acceso al buzón), `ATTACHMENT_MAX_BYTES` (15 MiB), `ATTACHMENT_MAX_PAGES` (2), `DOCLING_TIMEOUT_SECONDS` (180). `DOCLING_URL` ya existía. Documentadas en `.env.example` (raíz; el de `apps/worker` no existe).
- `scripts/extraction-test.ts`: prueba sobre una carpeta (tabla por consola e informe Markdown en `plans/reports/`).

## Criterio de detección de OCR

docling-serve no dice si hubo OCR. Se usa `confidence.ocr_score` de la respuesta: informado (no null) significa que RapidOCR leyó contenido, y entonces `method = 'ocr'`; en un PDF con capa de texto viene null y solo se informa `parse_score`, y `method = 'text'`. Verificado con los dos casos reales abajo. Limitación: un PDF digital con una imagen que contenga texto podría salir como `ocr`; no afecta a la clasificación. En BD se guarda `texto`/`ocr`.

## Prueba sintética (docling local 1.36.0, aarch64, 2 páginas, RapidOCR)

Documentos SINTÉTICOS (proveedores y CIF ficticios), generados a mano en `/tmp/claude-1001/.../scratchpad/facturas-prueba/`. Los 2 escaneos son un PDF renderizado a imagen con ligero giro, desenfoque y ruido (PDF de una sola imagen y un PNG). No sustituyen a facturas reales.

| Fichero | Método | Tiempo (s) | CIF de sociedad detectado |
| --- | --- | ---: | --- |
| digital-1-foodbox.pdf | text | 10,1 | A87240420 (FOODBOX) |
| digital-2-lateral-iberia.pdf | text | 10,0 | B88300413 (LATERAL IBERIA) |
| digital-3-arcobeta.pdf | text | 4,0 | B87694121 (ARCO BETA) |
| escaneo-1-lateral-iberia.pdf | ocr | 8,0 | B88300413 (LATERAL IBERIA) |
| escaneo-2-foodbox.png | ocr | 14,0 | A87240420 (FOODBOX) |

CIF en 5/5; media 9,2 s. Informe generado por el script: `plans/reports/extraction-test-261002-1713.md`.

Observaciones: el tiempo no distingue digital de escaneado (el primero fue en frío; los tiempos salen en múltiplos de ~1 s, probablemente por el sondeo interno de docling-serve). El OCR deja pequeños fallos de espaciado ("C/ Mayor12", "FOODBOX,S.A.", "NúñezMorgado"), pero el CIF sale limpio; las reglas deben comparar el CIF normalizado. La prueba no mide calidad con escaneos reales (arrugas, sellos, baja resolución).

## Verificación

- `pnpm lint`: sin errores.
- `pnpm typecheck`: pasa en los 4 paquetes (incluye una comprobación de tipos de que el cliente Prisma encaja en la caché).
- `pnpm test`: worker 31 tests (nuevos: Graph con paginación, Retry-After, 429 agotado, isInline y nextLink; docling con servidor HTTP simulado; caché con vigente/caducada/fallo; ensamblado completo del correo), shared 8, db 2, web 3.
- Real: `docker compose -p clasificador-dev -f infra/docker/compose.dev.yml up -d postgres docling` (docling 127.0.0.1:5101, postgres 5442). Siguen levantados; no se ha hecho `down`.

## Pendientes y notas

- La prueba real de 20 facturas (10 digitales, 10 escaneadas; criterio ≥ 19/20 con CIF) queda pendiente del acceso al buzón (certificado aplazado). Hasta entonces el criterio de éxito de la fase no está demostrado con documentos reales.
- Graph no se ha probado contra Microsoft 365 (sin credenciales): solo con respuestas simuladas. Hay que validar con el buzón real el campo `@odata.type` de adjuntos con `$select` y `/$value`.
- Decisión: cliente Graph propio sobre `fetch` en lugar de `@microsoft/microsoft-graph-client`, para controlar `Retry-After` y poder inyectar `fetch` en las pruebas. La dependencia del SDK queda sin usar (se puede retirar de `package.json`, que no me corresponde tocar).
- La caché es por hash sin incluir el límite de páginas: si se sube `ATTACHMENT_MAX_PAGES`, los hashes ya cacheados conservan el texto de las páginas anteriores hasta caducar.
- Los adjuntos omitidos sin descargar llevan `sha256: ''` (el tipo exige string y no hay contenido que hashear).
- `extractEmail` aún no está conectado a ningún trabajo (llega con la sincronización); el worker arranca sin variables de Graph.
- Sin dependencias nuevas.

Status: DONE_WITH_CONCERNS
Summary: Fase 3 implementada y verificada (lint, typecheck y test en verde; 5/5 CIF en la prueba sintética contra docling local con tiempo medio de 9,2 s).
Concerns/Blockers: la prueba real de 20 facturas y la validación contra Graph real siguen pendientes del acceso al buzón.
