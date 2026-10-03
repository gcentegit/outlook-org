# Credenciales y caducidades

**Hoy no hay ningún aviso automático de caducidad.** Si el certificado o el secreto de login caducan,
el servicio deja de funcionar sin previo aviso. Está planificado (días restantes en `/health` y aviso
con 30 días); mientras tanto, la fecha de cada caducidad se anota en el calendario del equipo al
crear la credencial. Las fechas reales no se escriben en este repositorio.

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

## Pendiente (en el plan)

Exponer los días restantes del certificado y del secreto en `/health` y avisar con 30 días de
antelación. Cuando exista, este documento debe describir dónde se ve el aviso y quién lo atiende.
