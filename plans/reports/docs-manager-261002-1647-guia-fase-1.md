# Informe: guía de la Fase 1 (registro de estado, 2026-10-02)

## Hecho
- `docs/guia-entra-id-rbac.md`: partes A-E, lista de comprobación y "Cómo deshacerlo" (menos de 400 líneas).
- `infra/scripts/generate-cert.sh` (ejecutable): RSA 2048, 730 días, CN `clasificador-proveedores`; `.cer` (DER), `.pem` (clave + certificado, 600), `.pfx` opcional (`--pfx`, contraseña por `PFX_PASSWORD` o por teclado); salida en `./secrets` o `--out`; no sobrescribe sin `--force`; muestra huella SHA-1 y caducidad.

## Verificado
- Cmdlets, parámetros y roles contra la documentación oficial (application-rbac, versión actualizada 2026-08): `New-ServicePrincipal -AppId -ObjectId -DisplayName`, `New-ManagementScope -RecipientRestrictionFilter`, `New-ManagementRoleAssignment -App -Role -CustomResourceScope`, `Test-ServicePrincipalAuthorization -Identity -Resource`, `Remove-ServicePrincipal`; roles `Application Mail.ReadWrite` y `Application MailboxSettings.ReadWrite` aparecen en la tabla oficial.
- Script ejecutado en el scratchpad (no en el repo) y borrado después. Salida resumida: generó .cer/.pem/.pfx; permisos `.cer` 644, `.pem` 600, `.pfx` 600; segunda ejecución sin `--force` falló con exit 1 listando los ficheros; con `--force` regeneró; la huella impresa coincidía con `openssl x509 -fingerprint -sha1` sobre el .cer. No se creó `secrets/` en el repo.

## Discrepancias con el plan
1. Propagación: el plan dice "hasta ~1 h"; la documentación oficial dice que la caché se renueva entre 30 minutos y 2 horas (30 min si la app no recibe llamadas, hasta 2 h si está activa). La guía usa la cifra oficial. La prueba `Test-ServicePrincipalAuthorization` ignora esa caché.
2. La documentación oficial indica que `Test-ServicePrincipalAuthorization` no considera permisos de Entra ID; la guía añade la comprobación manual de que no hay permisos de Graph consentidos.
3. El plan usa `-App <appId>`; la documentación admite ObjectID, AppID o DisplayName (sus ejemplos usan el ObjectId). Se mantiene appId.
4. La documentación avisa de que el "Object ID" de Registros de aplicaciones no es el del service principal; la guía lo señala.

## No verificado
- Scopes por defecto de better-auth con Microsoft: su documentación no los indica; la guía dice "User.Read según la librería", a confirmar en la Fase 7.
- Nombres exactos de las opciones de privacidad de OpenRouter y de la Console de Anthropic, y la inclusión del DPA en los Commercial Terms (dato del encargo): sin comprobar. Rutas de menús de Entra ID escritas de memoria, sin acceso al portal.
- `infra/` no existía; se creó `infra/scripts/`. No hay `.gitignore` (ni repo git): cuando exista, debe ignorar `secrets/`.
