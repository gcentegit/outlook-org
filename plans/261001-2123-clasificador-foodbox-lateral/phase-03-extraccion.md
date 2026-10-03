---
title: "Phase 3: Extracción de correo y adjuntos"
status: in-progress
effort: 1.5d
---

# Phase 3: Extracción de correo y adjuntos

## Overview

Convertir cada correo en un texto clasificable: asunto, remitente, cuerpo en
texto plano y Markdown de cada adjunto relevante.

## Key Insights

- La mayoría de facturas son PDF con capa de texto: docling la extrae sin OCR.
  RapidOCR solo actúa en escaneos o imágenes.
- El CIF de la sociedad facturada suele estar en la primera página: limitar
  páginas reduce tiempo y coste.
- Un mismo PDF puede llegar varias veces (reenvíos): cachear por hash SHA-256.

## Requirements

- Cliente Graph con `@azure/identity` (`ClientCertificateCredential`).
- Descarga de adjuntos `fileAttachment`; ignorar firmas, logos e imágenes inline (`isInline`).
- Tipos soportados: PDF, imágenes, DOCX, XLSX. Otros se registran y se omiten.
- Límite de tamaño y de páginas configurable.

## Related Code Files

Crear: `src/graph/client.ts`, `src/graph/messages.ts`, `src/extract/docling.ts`,
`src/extract/message-text.ts`, `scripts/extraction-test.ts`.

## Implementation Steps

1. Cliente Graph y lectura de mensaje con `$select` mínimo (`subject,from,toRecipients,body,categories,hasAttachments,receivedDateTime,internetMessageId`).
2. Cuerpo HTML a texto plano.
3. Envío del adjunto a docling-serve (`/v1/convert/file`, salida Markdown, OCR RapidOCR).
4. Caché por hash en `attachments_text`, registrando si hubo OCR y el tiempo.
5. Prueba de extracción con 10 facturas digitales y 10 escaneadas de FOOD BOX, LATERAL y ARCOBETA: ¿sale el CIF del cliente, la razón social y el total? Tiempo por documento en arm64.
6. Informe en `plans/reports/`.

## Todo

- [x] Cliente Graph (probado con respuestas simuladas; falta validarlo contra el buzón real)
- [x] Integración con docling-serve
- [x] Caché por hash
- [ ] Prueba de 20 documentos reales e informe (bloqueada por el certificado; prueba sintética 5/5 en `plans/reports/extraction-test-261002-1713.md`)

## Success Criteria

El CIF del cliente aparece en el Markdown en ≥ 19 de 20 documentos; tiempo
medio por documento medido en el servidor arm64.

## Risk Assessment

Si los escaneos dan mal resultado con RapidOCR, probar PP-OCRv5 mobile como
alternativa (registrado en DECISIONS).

## Security Considerations

Los Markdown contienen datos de terceros: se guardan solo en PostgreSQL interno
y con una política de retención definida.
