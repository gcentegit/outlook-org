---
title: Plan clasificador FOOD BOX y LATERAL
date: 2026-10-01
summary: Alcance inicial del clasificador del buzón de Proveedores acotado a FOOD BOX y LATERAL; plan de 7 fases
---

# Plan clasificador FOOD BOX y LATERAL

## What happened
Contexto del proyecto importado a docs/ (conversación, brief y captura). El usuario acotó el primer alcance a las categorías FOOD BOX y LATERAL.

## Decision
- Criterio: CIF/razón social de la sociedad facturada en el PDF + palabras clave en asunto/cuerpo; multietiqueta (puede llevar ambas).
- Reglas + Claude Haiku para los dudosos; despliegue en Dokploy Oracle arm64 (docling-serve-cpu tiene imagen arm64, verificado en GHCR).
- Acceso con RBAC for Applications de Exchange (roles Application Mail.ReadWrite y MailboxSettings.Read), sin consentimiento en Entra.
- PATCH de categories reemplaza la lista: fusionar siempre. Delta query es por carpeta.

## Next steps
Usuario aporta CIF, razones sociales y palabras clave; ejecutar fase 1 (acceso M365) y fase 2 (base del proyecto) en paralelo.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
