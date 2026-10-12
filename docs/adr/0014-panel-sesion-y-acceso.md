# 0014. Panel: sesión sin estado y acceso por lista de usuarios

- **Estado:** aceptada

## Contexto

El panel (`apps/web`) está expuesto a Internet y muestra extractos de facturas. Estar en el tenant
de Microsoft no debe bastar para entrar. El panel vive en `https://clasificador.arcofood.com`.

## Decisión

- **Inicio de sesión con Microsoft (better-auth) y sesión sin estado:** cookie cifrada de 8 horas;
  no hay tablas `user`, `session`, `account` ni `verification`, y el esquema Prisma no depende de
  better-auth. A cambio, la sesión no se puede invalidar en el servidor antes de caducar.
- **`AllowedUser` es la autoridad y se consulta en cada petición** (página, layout y acciones del
  servidor). Quitar a alguien le corta el acceso en su siguiente petición aunque su cookie siga
  viva. Una cuenta del tenant que no esté en la lista ve «Sin acceso». Al principio solo está el
  administrador inicial (`<ADMIN_EMAIL>`).
- **Acceso atado a `oid` y `tid`, no solo al email.** `AllowedUser.oid` (nulo, único) se rellena en
  el primer acceso válido y desde entonces debe coincidir. El `tid` del token debe ser el de
  `MS_TENANT_ID`; se comprueba al iniciar sesión, el único momento en que se procesa un token de
  Microsoft. Para cambiar a alguien de cuenta hay que darle de baja y de alta.
- **Solo `openid`, `profile` y `email`**: no hace falta `User.Read`. La app de Entra es de un solo
  tenant.
- **`requireUser()` en cada página del grupo `(panel)` y en cada acción**, antes de leer datos: con
  el renderizado parcial de Next.js el layout no protege las páginas. Solo `/api/health` y
  `/api/auth` son route handlers. Una prueba lo comprueba sobre el código.
- **`AUTH_DEV_BYPASS`** solo vale con `NODE_ENV=development`; una compilación de producción lo
  ignora aunque la variable esté puesta.
- **Cabeceras:** `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
  `X-Content-Type-Options` y `Referrer-Policy`, contra el clickjacking de las acciones con
  confirmación.
- **Carreras de configuración:** quitar usuarios y cambiar el modelo se hacen en una transacción con
  bloqueo asesor de PostgreSQL, para que dos administradores no dejen la lista vacía ni dos
  modelos activos.

## Consecuencias

- Mientras alguien no haya iniciado sesión, su hueco está sin vincular (confianza en el primer
  uso): conviene vigilar la columna «Cuenta de Microsoft» de Configuración.
- El `oid` del id_token viaja en la sesión cifrada, como campo del usuario (`additionalFields`). No
  se lee de la lista de cuentas de better-auth: en modo sin estado vive en la memoria de cada
  instancia, y las acciones del servidor de Next.js corren en otra copia del módulo, así que allí
  salía vacía y toda acción respondía «no autorizado». El campo admite entrada (`input: true`) solo
  para que lo rellene `mapProfileToUser`; nadie puede escribirlo porque `/update-user` está
  desactivado y no hay registro con contraseña. Una sesión anterior al campo pide volver a entrar.
- El secreto de la app de login caduca: véase
  [credenciales y caducidades](../operacion/credenciales-y-caducidades.md).
