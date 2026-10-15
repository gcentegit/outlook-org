# Credenciales y caducidades

El panel avisa en el **Resumen** (encima de «Estado del servicio») cuando el certificado de Graph o
el secreto de login caducan en 30 días o menos, o ya han caducado. El worker lee la caducidad del
certificado al arrancar y la deja en la base de datos para el panel, que no tiene el certificado; la
del secreto de login no se puede leer de forma fiable, así que se declara con `MS_CLIENT_SECRET_EXPIRES`
(`AAAA-MM-DD`) en la web: sin ella no hay aviso del secreto. Al renovar el certificado hay que reiniciar
el worker (lo lee al arrancar); al renovar el secreto, actualizar también esa fecha. Las fechas reales
no se escriben en este repositorio.

Los valores de las credenciales nunca van en git, en el chat ni en documentos: viven en un `.env`
local (fuera de git) y, desplegado, en las variables de entorno o ficheros montados de Dokploy.

## Qué caduca

| Credencial | Dónde vive | Caduca | Cómo se renueva |
| --- | --- | --- | --- |
| Certificado de Graph (app del buzón) | `secrets/` en local; montado como fichero solo en el worker | A los 730 días de generarlo con `infra/scripts/generate-cert.sh` | Generar uno nuevo, subir el `.cer` a la app del buzón en Entra ID, actualizar el fichero montado en el worker, comprobar que sincroniza y retirar el anterior de Entra ID |
| Secreto de cliente de la app de login (`MS_CLIENT_SECRET`) | Variable de entorno de la web | En la fecha elegida al crearlo en Entra ID | Crear un secreto nuevo, actualizarlo en la web, redesplegar y borrar el anterior; el valor solo se ve al crearlo |
| Claves de API de LLM (`ANTHROPIC_API_KEY` y similares) | Variables de entorno del worker | No consta en el repositorio; depende de la política de cada proveedor, a comprobar en su consola | Crear una clave nueva dedicada a este servicio, actualizarla en el worker y revocar la anterior |
| `BETTER_AUTH_SECRET` | Variable de entorno de la web | No caduca | Solo se cambia si se sospecha una fuga; las sesiones abiertas dejan de valer |

Los pasos de Entra ID están en la [guía de Entra ID y RBAC](../guias/entra-id-rbac.md): subida del
certificado (parte A), secreto de la app de login (parte C) y rotación de credenciales (sección «Cómo deshacerlo»).

## Cómo ver cuánto falta

- **Certificado:** `openssl x509 -in secrets/clasificador-proveedores.pem -noout -enddate` (el `.pem`
  lleva la clave y el certificado; no lo compartas). El script de generación también imprime la
  fecha al terminar. Entra ID la muestra en **Certificados y secretos** de la app.
- **Secreto de login:** solo en Entra ID, en **Certificados y secretos** de la app del panel.

## Qué pasa si caduca

- Certificado: el worker no obtiene token de Graph; la ronda falla, `/health` acaba en 503 y el latido avisa de la caída a
  Uptime Kuma. El servicio no pierde datos, pero no sincroniza hasta renovar.
- Secreto de login: nadie puede iniciar sesión en el panel; el worker no se ve afectado.

## Dónde se ve

- **Panel (Resumen):** aviso con los días que faltan, visible solo con sesión iniciada.
- **`/health` del worker** (interno, no público): `certificateDaysRemaining` con los días que faltan para
  que caduque el certificado (negativo si ya caducó), nunca la fecha. Ausente si no se pudo leer.
- **`/api/health` de la web** (público): no lleva nada de esto.

No hay aviso por correo ni por Uptime Kuma: quien abre el panel lo ve. Lo atiende quien administra el
servicio, siguiendo la renovación de la tabla anterior.
