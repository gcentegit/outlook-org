# Despliegue: resumen operativo

Estado: **no hay nada desplegado**. Nada se sube a Dokploy sin autorización expresa del usuario
([ADR 0018](../adr/0018-despliegue-en-dokploy.md)). Este documento es el resumen y las advertencias;
el detalle del alta de servicios (tabla de servicios, variables, memoria, cómo ejecutar el script) está
en [infra/dokploy/README.md](../../infra/dokploy/README.md) y lo aplica
[`provision.ts`](../../infra/dokploy/provision.ts).

## Qué se despliega

Cuatro servicios independientes en Dokploy, sin Compose: web, worker, docling y PostgreSQL nativo.
La web y el worker son imágenes propias; docling y PostgreSQL son imágenes de terceros con versión
fijada. Los límites de memoria son un punto de partida y se ajustan con métricas reales tras la
primera semana.

## Orden recomendado la primera vez

1. Autorización del usuario y credenciales listas (certificado y guía de
   [Entra ID y RBAC](../guias/entra-id-rbac.md), claves de LLM): sin credenciales de Graph el
   worker arranca pero no sincroniza.
2. Activar las métricas del servidor (monitorización de Dokploy o Beszel).
3. `provision.ts` en simulación (`--dry-run`, el modo por defecto), revisar el resultado y solo
   entonces `--apply`. Crea PostgreSQL y docling; **no despliega web ni worker**.
4. Desplegar con el flujo de publicación (worker primero, después la web) con una etiqueta de imagen
   exacta ([ADR 0019](../adr/0019-publicacion-y-vuelta-atras.md)). Qué versión se publica y cuándo:
   [versiones y releases](versiones-y-releases.md).
5. Comprobar `GET /api/health` (web) y, desde el contenedor del worker, `GET /livez` y
   `GET /health`.
6. Dar de alta el monitor de Uptime Kuma y poner su URL de push en el worker.

## Advertencias

- **Actualización `stop-first`, nunca `start-first`:** el worker es de instancia única por bloqueo;
  con `start-first` la nueva no llegaría a estar sana y la anterior no se pararía.
- **`/health` del worker en 503 no siempre es un fallo:** sin credenciales de Graph responde 503
  `disabled` por diseño, y `/livez` responde 200. El `HEALTHCHECK` usa `/livez`.
- **Antes de cualquier migración, copia de seguridad reciente.** Las migraciones solo avanzan: una
  imagen anterior con un esquema posterior debe ser compatible, o se restaura la copia
  ([copias y restauración](copias-y-restauracion.md)).
- `MODE=live` no está soportado: el worker se niega a arrancar. Producción va en `MODE=shadow`.
- `ADMIN_EMAIL` y `MAILBOX` los exige `provision.ts` en su entorno; no hay valores por defecto.
- Las claves de LLM, el certificado y los secretos van en variables de entorno o ficheros montados de
  Dokploy, nunca en git ni en el chat ([credenciales y caducidades](credenciales-y-caducidades.md)).
- La consulta de contenedores de Dokploy que usa el flujo de publicación no se ha probado contra un
  Dokploy real.

## Volver atrás

Se despliega la versión anterior (`X.Y.Z`) con la ejecución manual del flujo; no hace falta reconstruir. Los
pasos exactos están en la sección «Cómo volver atrás» de
[infra/dokploy/README.md](../../infra/dokploy/README.md#cómo-volver-atrás).
