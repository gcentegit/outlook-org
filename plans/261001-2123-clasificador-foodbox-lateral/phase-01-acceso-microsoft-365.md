---
title: "Phase 1: Acceso a Microsoft 365 y cuentas"
status: done
effort: 0.5d
---

# Phase 1: Acceso a Microsoft 365 y cuentas

## Estado

**Hecha** (2026-10-09), salvo las cuentas de LLM, que se aplazan a la fase 10 por decisión del
usuario: la fase 9 no usa el LLM. El usuario configuró las dos apps en Entra ID y el ámbito en
Exchange siguiendo la [guía](../../docs/guias/entra-id-rbac.md). Comprobado:

- `Test-ServicePrincipalAuthorization` da `InScope = True` con el buzón de Proveedores y `False` con
  otro buzón.
- Con el certificado, la app lee la lista maestra de categorías (FOOD BOX, LATERAL y ARCOBETA
  existen) y la Bandeja de entrada del buzón, y recibe 403 con otro buzón. Prueba de humo puntual
  con el cliente de Graph del worker, de solo lectura; no queda como script en el repositorio.
- El login del panel con Microsoft funciona y el administrador queda atado a su `oid`.

Las fechas de caducidad del certificado y del secreto del panel están en el calendario del equipo,
no en este repositorio ([credenciales y caducidades](../../docs/operacion/credenciales-y-caducidades.md)).

## Overview

Registrar una app en Entra ID que pueda leer y modificar categorías **solo** en
el buzón compartido de Proveedores. Lo ejecuta el usuario (admin del tenant)
siguiendo una guía que se escribe en esta fase.

## Key Insights

- Se usa **RBAC for Applications de Exchange Online** (sucesor de las Application
  Access Policies): https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- El permiso **no** se concede en Entra ID (consentimiento de admin de
  `Mail.ReadWrite`): si se concede allí, aplica a todo el tenant y se suma al de
  Exchange. Se asigna en Exchange con un ámbito de gestión.
- Roles necesarios: `Application Mail.ReadWrite` (leer correos, adjuntos y hacer
  `PATCH` de `categories`) y `Application MailboxSettings.ReadWrite` (leer la
  lista maestra de categorías en `/outlook/masterCategories` y crear categorías
  nuevas desde el panel).
- Autenticación con certificado, no con secreto.

## Requirements

- Buzón compartido: `<MAILBOX>` (también accesible desde otra dirección del grupo; no afecta al ámbito, que se limita a la dirección de Proveedores).
- App con certificado autofirmado (clave privada solo en el servidor).
- Acceso limitado y verificado al buzón de Proveedores.

## Implementation Steps

1. Generar certificado (`openssl req -x509 -newkey rsa:2048 -days 730 ...`); subir el `.cer` a la app.
2. Registrar la app en Entra ID sin permisos de Graph de aplicación.
3. En Exchange Online PowerShell:
   - `New-ServicePrincipal -AppId <appId> -ObjectId <enterpriseAppObjectId> -DisplayName "Clasificador Proveedores"`
   - `New-ManagementScope -Name "Buzon-Proveedores" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '<MAILBOX>'"`
   - `New-ManagementRoleAssignment -App <appId> -Role "Application Mail.ReadWrite" -CustomResourceScope "Buzon-Proveedores"`
   - Igual con `Application MailboxSettings.ReadWrite`.
4. Verificar con `Test-ServicePrincipalAuthorization -Identity <appId> -Resource <buzon>` (InScope = True) y con otro buzón (InScope = False).
5. Script de humo en TS: token por certificado, `GET /users/<buzon>/outlook/masterCategories` y `GET .../mailFolders/inbox/messages?$top=1`.
6. Escribir la guía en `docs/guias/entra-id-rbac.md`.
7. Crear la cuenta de empresa en la Console de Anthropic (acepta los Commercial Terms, que incluyen el DPA) y una clave de API solo para este servicio. Si se usará OpenRouter, crear la cuenta y activar "no entrenar con los datos" y ZDR.

## Todo

- [x] Certificado generado y subido a Entra ID
- [x] App registrada y service principal creado en Exchange
- [x] Ámbito y asignaciones de rol creados
- [x] Prueba InScope positiva y negativa
- [x] Prueba de humo: lee categorías e Inbox, y 403 con otro buzón
- [x] Guía escrita (`docs/guias/entra-id-rbac.md`) y script de certificado (`infra/scripts/generate-cert.sh`)
- [ ] Cuenta de Anthropic y clave de API (aplazada a la fase 10)
- [ ] Cuenta de OpenRouter con privacidad configurada, si se usa (aplazada a la fase 10)

## Success Criteria

La app lista las categorías maestras y los correos del buzón de Proveedores, y
recibe 403 al intentarlo con cualquier otro buzón.

## Risk Assessment

- Los cambios de RBAC tardan entre 30 minutos y 2 horas en aplicarse (caché de Exchange, según la documentación oficial): no diagnosticar un 403 antes. `Test-ServicePrincipalAuthorization` no usa esa caché.
- Si alguien concede `Mail.ReadWrite` en Entra ID, la restricción deja de servir: comprobarlo en la guía.

## Security Considerations

Clave privada del certificado como secreto de Dokploy, nunca en el repositorio.
