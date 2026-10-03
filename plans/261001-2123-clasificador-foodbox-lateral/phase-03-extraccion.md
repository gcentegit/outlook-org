---
title: "Phase 3: Extracción de correo y adjuntos"
status: done
effort: 1.5d
---

# Phase 3: Extracción de correo y adjuntos

## Estado

**Hecha en código**, probada con respuestas simuladas de Graph y con docling real en local (prueba
sintética 5/5, `plans/reports/extraction-test-261002-1713.md`). Se construyó el cliente de Graph, la
lectura de mensajes y adjuntos, la integración con docling-serve y la caché por hash
([ADR 0012](../../docs/adr/0012-adjuntos-y-extraccion.md)).

**Validación con datos reales: movida a la fase 10** (no se ha probado contra el buzón real ni con
facturas reales).

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
5. Prueba de extracción con facturas reales (ahora en la fase 10): ¿sale el CIF del cliente, la razón social y el total? Tiempo por documento en arm64.
6. Informe de la prueba, con datos de terceros en `data/history/` y no en `plans/reports/`.

## Todo

- [x] Cliente Graph (probado con respuestas simuladas)
- [x] Integración con docling-serve
- [x] Caché por hash
- [x] Script de prueba de extracción (`apps/worker/scripts/extraction-test.ts`) y prueba sintética

## Movido a otras fases

- Validar el cliente de Graph contra el buzón real: fase 10.
- Prueba de extracción con 20 facturas reales (CIF del cliente en ≥ 19 de 20; tiempo medio en el
  servidor arm64) e informe: fase 10.
- Contar cuántos adjuntos son `.eml` o `.msg` (no soportados hoy): fase 9; soportarlos o descartarlos
  de forma informada: fase 10.

## Success Criteria

Se cumplirán en la fase 10: el CIF del cliente aparece en el Markdown en ≥ 19 de 20 documentos
reales; tiempo medio por documento medido en el servidor arm64.

## Risk Assessment

Si los escaneos dan mal resultado con RapidOCR, probar PP-OCRv5 mobile como
alternativa (anotado en el ADR 0012).

## Security Considerations

Los Markdown contienen datos de terceros: se guardan solo en PostgreSQL interno
y con una política de retención definida (90 días, [ADR 0010](../../docs/adr/0010-retencion-y-datos-de-terceros.md)).
