---
title: "Phase 1: Acceso a Microsoft 365 y cuentas"
status: todo
effort: 0.5d
---

# Phase 1: Acceso a Microsoft 365 y cuentas

## Estado

**Pendiente del usuario.** Está escrita la guía ([docs/guias/entra-id-rbac.md](../../docs/guias/entra-id-rbac.md))
y el script de certificado (`infra/scripts/generate-cert.sh`); el usuario aplazó el certificado y la
configuración en Entra ID y Exchange. Bloquea todo lo que toca el buzón real (fases 9 a 11) y el login
del panel. El certificado que genera el script dura 730 días: véase
[credenciales y caducidades](../../docs/operacion/credenciales-y-caducidades.md).

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

- [ ] Certificado generado y subido
- [ ] App registrada y service principal creado en Exchange
- [ ] Ámbito y asignaciones de rol creados
- [ ] Prueba InScope positiva y negativa
- [ ] Script de humo lee categorías e Inbox
- [x] Guía escrita (`docs/guias/entra-id-rbac.md`) y script de certificado (`infra/scripts/generate-cert.sh`)
- [ ] Cuenta de Anthropic y clave de API
- [ ] Cuenta de OpenRouter con privacidad configurada (si se usa)

## Success Criteria

La app lista las categorías maestras y los correos del buzón de Proveedores, y
recibe 403 al intentarlo con cualquier otro buzón.

## Risk Assessment

- Los cambios de RBAC tardan entre 30 minutos y 2 horas en aplicarse (caché de Exchange, según la documentación oficial): no diagnosticar un 403 antes. `Test-ServicePrincipalAuthorization` no usa esa caché.
- Si alguien concede `Mail.ReadWrite` en Entra ID, la restricción deja de servir: comprobarlo en la guía.

## Security Considerations

Clave privada del certificado como secreto de Dokploy, nunca en el repositorio.
