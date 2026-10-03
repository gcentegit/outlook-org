# 0013. Acceso al buzón con certificado y RBAC de Exchange

- **Estado:** aceptada (pendiente de aplicar: el usuario aplazó el certificado)

## Contexto

La app necesita leer correos y adjuntos del buzón de Proveedores y, en el futuro, escribir
categorías. No debe poder tocar ningún otro buzón del tenant. La guía paso a paso está en
[guias/entra-id-rbac.md](../guias/entra-id-rbac.md).

## Decisión

- **Microsoft Graph con certificado**, no con secreto: la clave privada solo la tiene el worker.
- Los permisos se conceden en **Exchange Online con RBAC for Applications**, con un ámbito que
  limita la app al buzón de Proveedores, y **no** en Entra ID. Si se concediera `Mail.ReadWrite`
  con consentimiento de administrador en Entra ID, valdría para todos los buzones y se sumaría al
  de Exchange, de modo que la restricción dejaría de servir.
- Roles asignados con ese ámbito: `Application Mail.ReadWrite` (leer correos y adjuntos, y escribir
  categorías) y `Application MailboxSettings.ReadWrite` (leer y crear categorías maestras).
- **Dos apps de Entra ID separadas**: la del buzón (certificado, solo el worker) y la del panel
  (inicio de sesión de personas, solo permisos delegados `openid`, `profile` y `email`), para no
  mezclar permisos.
- Una cuenta de empresa y una clave de API dedicadas para el proveedor de LLM
  ([0003](0003-llm-configurable-y-privacidad.md)).

## Consecuencias

- Los cambios de RBAC tardan entre 30 minutos y 2 horas en aplicarse (caché de Exchange);
  `Test-ServicePrincipalAuthorization` no la usa y sirve para comprobar el ámbito.
- El certificado caduca (730 días con el script del repositorio): véase
  [credenciales y caducidades](../operacion/credenciales-y-caducidades.md).
- Hasta que el usuario lo aplique, nada de lo que lee el buzón se ha probado con datos reales.
