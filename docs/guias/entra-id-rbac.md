# Guía: dar acceso a la app del clasificador en Microsoft 365

Esta guía la sigue una persona con rol de administrador del tenant de la empresa. Al terminar, la app del clasificador podrá leer y poner categorías **solo** en el buzón compartido de Proveedores, y el panel tendrá su propio inicio de sesión.

## Datos fijos

| Dato | Valor |
|------|-------|
| Buzón compartido | el buzón configurado en `MAILBOX` (`<MAILBOX>` en esta guía) |
| Tenant | el de la empresa |
| Panel | `https://clasificador.arcofood.com` |
| URL de retorno del login | `https://clasificador.arcofood.com/api/auth/callback/microsoft` |

Se crean **dos apps** de Entra ID separadas, para no mezclar permisos:

- **Clasificador Proveedores - Buzón**: lee el buzón y escribe categorías. Se autentica con certificado, que solo tiene el worker: el panel no lleva ninguna credencial del buzón y, cuando necesita leer o crear categorías, se lo pide al worker.
- **Clasificador Proveedores - Panel**: solo sirve para que las personas inicien sesión en el panel.

## Por qué los permisos no se conceden en Entra ID

El acceso al buzón se da en Exchange Online (RBAC for Applications) y **no** en Entra ID. Si se concediera `Mail.ReadWrite` en Entra ID con consentimiento de administrador, ese permiso valdría para todos los buzones del tenant y se sumaría al de Exchange, de modo que la restricción al buzón de Proveedores dejaría de servir. Referencia oficial: [RBAC for Applications en Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

Requisitos de quien ejecuta la guía: pertenecer al grupo de roles Organization Management de Exchange y tener el rol Exchange Administrator en Entra ID. Para la Parte B hace falta PowerShell con el módulo `ExchangeOnlineManagement`.

---

## Parte A. App del buzón

### A1. Generar el certificado

Desde la raíz del repositorio:

```bash
infra/scripts/generate-cert.sh          # añade --pfx si quieres también un .pfx
```

El script escribe en `secrets/` (fuera de git) el `.cer` (público, se sube a Entra ID) y el `.pem` (clave privada, lo usa la app). Al final muestra la **huella SHA-1**. Anótala: es la que Entra ID enseña después de subir el certificado y sirve para comprobar que se subió el correcto. Si los ficheros ya existen, el script se niega a sobrescribirlos salvo con `--force`. Las opciones están en `--help`.

La clave privada nunca se sube al repositorio ni se pega en ningún chat.

### A2. Registrar la app

1. Entra en el centro de administración de Microsoft Entra (`entra.microsoft.com`) y ve a **Identidad > Aplicaciones > Registros de aplicaciones > Nuevo registro**.
2. Nombre: `Clasificador Proveedores - Buzón`.
3. Tipos de cuenta compatibles: **Solo cuentas de este directorio organizativo** (un solo tenant).
4. No indiques URI de redirección. Pulsa **Registrar**.
5. Ve a **Permisos de API**. La lista debe quedar **sin ningún permiso de aplicación de Microsoft Graph** y sin consentimiento de administrador. Puede aparecer `User.Read` delegado por defecto; no hace falta y puedes quitarlo.

### A3. Subir el certificado

En la app, **Certificados y secretos > Certificados > Cargar certificado** y elige `secrets/clasificador-proveedores.cer`. Comprueba que la huella que muestra Entra ID coincide con la que imprimió el script.

### A4. Anotar los identificadores

| Dato | Dónde está |
|------|-----------|
| `tenantId` | Registro de la app > **Información general** > "Id. de directorio (inquilino)". |
| `appId` | Registro de la app > **Información general** > "Id. de aplicación (cliente)". |
| `objectId` del service principal | **Aplicaciones empresariales** > busca `Clasificador Proveedores - Buzón` > **Información general** > "Id. de objeto". |

Atención: el "Id. de objeto" que aparece en **Registros de aplicaciones** es otro valor y **no** sirve para la Parte B. Hay que usar el de **Aplicaciones empresariales**.

---

## Parte B. Exchange Online PowerShell

Sustituye `<appId>` y `<objectIdEnterpriseApp>` por los valores anotados en A4.

### B1. Conectar y crear el service principal

```powershell
Connect-ExchangeOnline

New-ServicePrincipal -AppId <appId> -ObjectId <objectIdEnterpriseApp> -DisplayName "Clasificador Proveedores"
```

En Exchange, el service principal es solo un puntero al de Entra ID, por eso hace falta que la app ya esté registrada.

### B2. Crear el ámbito limitado al buzón

```powershell
New-ManagementScope -Name "Buzon-Proveedores" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '<MAILBOX>'"
```

### B3. Asignar los dos roles con ese ámbito

```powershell
New-ManagementRoleAssignment -App <appId> -Role "Application Mail.ReadWrite" -CustomResourceScope "Buzon-Proveedores"

New-ManagementRoleAssignment -App <appId> -Role "Application MailboxSettings.ReadWrite" -CustomResourceScope "Buzon-Proveedores"
```

- `Application Mail.ReadWrite`: leer correos y adjuntos y modificar las categorías de cada correo. No permite enviar correo.
- `Application MailboxSettings.ReadWrite`: leer la lista maestra de categorías del buzón y crear categorías nuevas. Lo ejecuta el worker cuando el panel se lo pide (pantalla Categorías).

### B4. Verificar

```powershell
# Debe mostrar InScope = True en las dos filas
Test-ServicePrincipalAuthorization -Identity <appId> -Resource <MAILBOX> | Format-Table

# Debe mostrar InScope = False en las dos filas (usa cualquier otro buzón real)
Test-ServicePrincipalAuthorization -Identity <appId> -Resource <otro-buzon> | Format-Table
```

Esta prueba ignora la caché de permisos, así que refleja la configuración real de Exchange. **No** tiene en cuenta los permisos concedidos en Entra ID: por eso hay que comprobar aparte, en el paso A2.5, que la app no tiene permisos de Graph en Entra ID.

### B5. Propagación

Los cambios de permisos pasan por una caché que se renueva **entre 30 minutos y 2 horas**, según el uso reciente de la app (30 minutos si no recibe llamadas; hasta 2 horas si está activa). Si la app recibe un 403 justo después de configurar, espera antes de diagnosticar.

---

## Parte C. App de login del panel

1. **Registros de aplicaciones > Nuevo registro**. Nombre: `Clasificador Proveedores - Panel`.
2. Tipos de cuenta: **Solo cuentas de este directorio organizativo** (un solo tenant).
3. URI de redirección: plataforma **Web**, valor `https://clasificador.arcofood.com/api/auth/callback/microsoft`. Para probar el login en local añade una segunda URI Web: `http://localhost:3110/api/auth/callback/microsoft` (con `BETTER_AUTH_URL=http://localhost:3110` en el `.env`). Quítala cuando termines las pruebas.
4. En **Permisos de API**, solo permisos **delegados** de Microsoft Graph: `openid`, `profile` y `email`. `User.Read` **no hace falta**: el panel pide únicamente esos tres ámbitos y toma el correo del token de identidad. Nunca permisos de aplicación. Si Entra ID añadió `User.Read` por defecto al registrar la app, puedes quitarlo.
5. **Certificados y secretos > Secretos de cliente > Nuevo secreto de cliente**. Elige una caducidad (cuanto más corta, más seguro; hay que renovarlo antes de que venza) y **anota la fecha de caducidad** en el calendario del equipo. Copia el valor del secreto en el momento: Entra ID no lo vuelve a mostrar.
6. Anota `tenantId` y `appId` de esta app (misma ubicación que en A4).

El valor del secreto se guarda solo en el `.env` local (fuera de git) y, más adelante, en las variables de entorno de Dokploy.

**Cómo se ata el acceso.** El alta de un usuario en el panel es por email, pero el email no basta: Microsoft no lo verifica y se puede editar. En el primer acceso válido (token del tenant configurado en `MS_TENANT_ID`, email dado de alta) el panel guarda el `oid` de la cuenta y desde entonces exige que coincida. Un token de otro tenant se rechaza. Si alguien cambia de cuenta de Microsoft, un administrador debe darle de baja y de alta de nuevo en Configuración.

---

## Parte D. Cuentas de LLM

1. **Anthropic.** Crea una cuenta de empresa en la Console de Anthropic. Al aceptar los Commercial Terms se incluye el DPA (acuerdo de tratamiento de datos). Crea una **clave de API dedicada** a este servicio, con un nombre que lo identifique, para poder revocarla sin afectar a nada más.
2. **OpenRouter (opcional).** Solo si se va a usar. En los ajustes de privacidad de la cuenta, activa la opción de no permitir proveedores que entrenen con los datos y activa Zero Data Retention (ZDR). Los nombres exactos pueden variar en la interfaz.

Las claves de API se guardan en el `.env` local, nunca en el repositorio.

---

## Parte E. Qué datos pasar al terminar

Pasa al equipo de desarrollo, por el chat:

- `tenantId`.
- `appId` de la app del buzón y `appId` de la app del panel.
- `objectId` de la aplicación empresarial del buzón (opcional, ayuda a diagnosticar).
- Ruta local del `.pem` (y del `.pfx` si lo generaste) y la huella SHA-1.
- Fecha de caducidad del certificado y del secreto del panel.
- Confirmación de que las pruebas de B4 dieron `True` y `False`.

**Nunca pegues en el chat** claves privadas, el contenido del `.pem` o `.pfx`, secretos de cliente ni claves de API. Se guardan en un `.env` local fuera de git y se pasan a Dokploy cuando el usuario lo autorice.

---

## Lista de comprobación final

- [ ] Certificado generado en `secrets/` y huella anotada.
- [ ] App "Clasificador Proveedores - Buzón" registrada, de un solo tenant.
- [ ] Certificado subido y huella coincidente en Entra ID.
- [ ] La app del buzón no tiene permisos de aplicación de Graph en Entra ID ni consentimiento de administrador.
- [ ] `tenantId`, `appId` y `objectId` de la aplicación empresarial anotados.
- [ ] `New-ServicePrincipal` ejecutado.
- [ ] Ámbito `Buzon-Proveedores` creado.
- [ ] Roles `Application Mail.ReadWrite` y `Application MailboxSettings.ReadWrite` asignados con ese ámbito.
- [ ] `Test-ServicePrincipalAuthorization` con `InScope = True` para `<MAILBOX>`.
- [ ] `Test-ServicePrincipalAuthorization` con `InScope = False` para otro buzón.
- [ ] App "Clasificador Proveedores - Panel" registrada, de un solo tenant, con redirección Web correcta.
- [ ] Permisos del panel solo delegados: `openid`, `profile` y `email` (sin `User.Read`).
- [ ] Secreto del panel creado y fecha de caducidad anotada.
- [ ] Cuenta de empresa y clave de API dedicada de Anthropic creadas.
- [ ] (Si se usa) OpenRouter con no-entrenamiento y ZDR activados.
- [ ] Datos de la Parte E enviados sin secretos.

---

## Cómo deshacerlo

En Exchange Online PowerShell, tras `Connect-ExchangeOnline`:

```powershell
# Ver los nombres de las asignaciones de la app
Get-ManagementRoleAssignment -RoleAssignee <appId> | Format-Table Name, Role

Remove-ManagementRoleAssignment -Identity "<nombre de la asignación>"   # una vez por cada asignación
Remove-ManagementScope -Identity "Buzon-Proveedores"
Remove-ServicePrincipal -Identity <appId>
```

Borra el ámbito después de las asignaciones. Después, en Entra ID, elimina los registros `Clasificador Proveedores - Buzón` y `Clasificador Proveedores - Panel` (**Registros de aplicaciones > Eliminar**). Si borras primero la aplicación en Entra ID, Exchange elimina solo sus asignaciones y su service principal, pero el ámbito se queda y hay que borrarlo a mano.

Para parar solo el acceso sin borrar nada, basta con eliminar las asignaciones de rol. Para rotar credenciales, sube un certificado nuevo (o crea otro secreto en el panel) y retira el anterior.
