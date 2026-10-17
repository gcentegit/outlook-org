# Arquitectura: cómo funciona hoy

Este documento describe el sistema tal como está construido. El **porqué** de cada decisión está en
los [registros de decisión](adr/README.md); aquí solo se enlaza. Los detalles (campos, valores por
defecto, rutas) los define el código, que se cita por ruta.

Estado: desplegado en producción contra el buzón real. Escribe en los correos solo las categorías
que el panel tenga en live y con el worker en `MODE=live`; el resto funciona en modo sombra.

## Piezas

| Pieza | Qué hace | Dónde |
| --- | --- | --- |
| Worker | Sincroniza la Bandeja de entrada, extrae adjuntos, clasifica, guarda decisiones y atiende las peticiones del panel. Es el único que tiene el certificado de Graph y las claves de LLM. | `apps/worker/src/` |
| Web (panel) | Métricas, correos con su decisión, discrepancias, reglas (crear, activar, desactivar y revisar la Bandeja con una; [ADR 0023](adr/0023-reglas-desde-el-panel-y-revision-de-la-bandeja.md)), modelo de LLM, categorías del buzón y configuración. Sin credenciales del buzón: pide al worker por la cola. | `apps/web/src/` |
| PostgreSQL | Datos de la aplicación y la cola de trabajos (pg-boss). | `packages/db/prisma/schema.prisma` |
| docling-serve | Convierte a texto lo que el worker no lee solo: PDF sin capa de texto e imágenes (con OCR), DOCX y XLSX. Servicio aparte, solo CPU. | imagen de terceros |
| Microsoft Graph | Buzón de Proveedores (lectura) y categorías maestras. | `apps/worker/src/graph/` |
| Proveedor de LLM | Resuelve los casos que las reglas no deciden. Elegible desde el panel. | `apps/worker/src/classify/` |
| Uptime Kuma | Recibe un latido tras cada ronda de sincronización correcta (opcional). | `apps/worker/src/heartbeat.ts` |
| Registro de caídas | Tabla `Outage`: paradas de la sincronización (inicio, fin, causa), que el panel muestra junto al estado del servicio. Un worker caído se detecta al arrancar por el hueco desde la última sincronización. | `apps/worker/src/sync/outages.ts` |

Código compartido: `packages/shared` (esquema de la decisión, categorías, CIF, sociedades) y
`packages/db` (esquema, migraciones, semilla, cliente).

## Flujo de un correo, de principio a fin

```mermaid
flowchart TD
    A[Llega un correo a la Bandeja de entrada] --> B[Worker: ronda de delta query cada ~90 s]
    B -->|correo desconocido| C[Se registra Message como pendiente y se encola process-message]
    B -->|correo conocido con otras categorías| K[Se compara con la última decisión: posible corrección]
    C --> D[Worker: lee el correo y descarga adjuntos válidos]
    D --> E[Texto del PDF en el worker, o docling si no lo trae; caché por SHA-256]
    E --> F[Clasificador: reglas fuertes, hilo, reglas medias, LLM]
    F --> G{Fallo técnico?}
    G -->|pasajero, quedan reintentos| C
    G -->|no, o ya sin reintentos| H[Se guarda Decision y el correo queda procesado]
    H --> I[Panel: métricas y discrepancias]
    K --> J[Se guarda Correction]
    J --> I
    L[Worker: cada hora o desde el panel, busca en qué carpeta acabó cada correo] --> I
    H -. en live, se añaden en Outlook las categorías en live .-> A
```

1. **Detección** (`sync/delta.ts`). Una ronda de delta query sobre la Bandeja de entrada, secuencial y
   con un bloqueo de PostgreSQL que garantiza una sola instancia. Un correo desconocido se registra
   como `pending` y se encola; uno conocido con categorías distintas se compara con su última
   decisión y puede generar una corrección. Un correo que sale de la carpeta solo se cuenta. Tras
   una parada se recuperan los que llegaron y el equipo archivó mientras tanto.
   [ADR 0005](adr/0005-sincronizacion-delta-e-instancia-unica.md).
2. **Cola** (`jobs/`). Un trabajo `process-message` por correo, idempotente, con 5 reintentos y
   retroceso. [ADR 0006](adr/0006-cola-de-trabajos-con-pg-boss.md).
3. **Extracción** (`extract/`). Se lee el mensaje y sus adjuntos de fichero (no inline) de tipo PDF,
   imagen, DOCX o XLSX, dentro de los límites de tamaño y páginas. El texto se cachea por hash.
   [ADR 0012](adr/0012-adjuntos-y-extraccion.md).
4. **Clasificación** (`classify/`). Cada categoría se decide por separado, en el orden de abajo.
5. **Guardado.** `Message` y `Decision` en una transacción. Si hubo un fallo técnico se reintenta; si
   se agotan los reintentos la decisión queda marcada como degradada y el correo para reprocesar.
   [ADR 0007](adr/0007-fallos-tecnicos-y-reproceso.md).
6. **Carpeta de cada correo** (`sync/folders.ts`). Cada hora, y cuando se pide con el botón del
   panel, el worker busca en qué carpeta archivó el equipo cada correo (por conversación y fecha de
   recepción, porque el id cambia al moverlo). Solo lee.
7. **Lectura en el panel** (`apps/web/src/server/metrics.ts`). Solo cuentan para el acierto los
   correos que el equipo ha revisado: archivados en el árbol Foodbox o Lateral, o con categorías.
   Los que el equipo eliminó se cuentan aparte.
   [ADR 0008](adr/0008-correcciones-y-metrica-de-acierto.md).

## Orden de decisión del clasificador

Por categoría, de mayor a menor prioridad (detalle y motivos en
[ADR 0002](adr/0002-orden-de-decision-del-clasificador.md)):

1. Regla fuerte: CIF o razón social de una de las siete sociedades, en el propio correo. Si el correo
   identifica una sociedad, las categorías de las otras se descartan.
2. Herencia del hilo, con las categorías finales del equipo.
3. Regla media: palabras clave, remitente, dominio.
4. LLM, solo para lo que sigue en duda y existe en el buzón.
5. Duda: sin categoría y para revisión.

Una respuesta por debajo del umbral de confianza (0,8) cuenta como duda. El clasificador solo
propone; nunca quita categorías de personas.

## Datos que se guardan y cuánto tiempo

La lista de tablas y campos está en `schema.prisma`; aquí, lo que importa para la privacidad.

| Dato | Se guarda | Conservación |
| --- | --- | --- |
| Texto extraído de adjuntos | Sí (`AttachmentText`) | 90 días; limpieza diaria |
| Decisiones, correcciones | Sí | Sin límite |
| Remitente, asunto, fecha, conversación y categorías vistas de cada correo | Sí (`Message`) | Sin límite; plazo pendiente de decidir |
| Cuerpo del correo y ficheros adjuntos | No: se leen para clasificar y no se guardan | No aplica |
| Texto pegado en «Probar» | Solo en la cola de trabajos | Se borra al leer el resultado y, como máximo, a los 5 minutos |
| Claves de LLM, certificado | Nunca en la base de datos: variables de entorno y fichero montado en el worker | No aplica |

Lo que se envía al LLM (asunto, cuerpo y texto de las primeras páginas de los adjuntos, con tope de
caracteres) sale hacia el proveedor elegido. [ADR 0003](adr/0003-llm-configurable-y-privacidad.md) y
[ADR 0010](adr/0010-retencion-y-datos-de-terceros.md).

## Modo sombra y modo real

- **Sombra** (`MODE=shadow`, por defecto, o una categoría en sombra en el panel): lee el buzón,
  extrae, clasifica, llama al LLM, guarda decisiones y correcciones, las muestra en el panel y envía
  el latido. No toca ningún correo.
- **Real** (`MODE=live` y la categoría en live en el panel): además, al decidir un correo añade en
  Outlook las categorías en live, sin quitar ninguna y sin volver a poner las que el equipo quitó
  (`apps/worker/src/graph/apply-categories.ts`). Volver una categoría a sombra en el panel deja de
  escribirla en el siguiente correo.
- **Otra escritura en el buzón:** crear una categoría en la lista maestra cuando un usuario
  autorizado lo pide y confirma en el panel; no toca ningún correo. El worker la ejecuta; la web
  no puede. [ADR 0004](adr/0004-modo-sombra-y-activacion-por-categoria.md) y
  [ADR 0015](adr/0015-web-sin-credenciales-del-buzon.md).

## Límites conocidos

- **Adjuntos `.eml`, `.msg` y `itemAttachment`:** no se leen ni se avisa; un reenvío que adjunta el
  correo original pierde el PDF de dentro. No se ha medido cuántos casos hay.
- **Un correo que sale de la Bandeja y vuelve cambia de id** y pierde el registro de lo que escribió el
  servicio: en modo real podría volver a poner una categoría que el equipo le quitó.
- Un cambio de categorías del equipo mientras su correo se procesa no cuenta como corrección.
- La sesión del panel no se puede invalidar en el servidor antes de las 8 horas; el acceso sí se
  corta al instante quitando al usuario de la lista.
- Sin aviso automático de caducidad del certificado ni del secreto
  de login, y sin plazo de conservación de remitentes, asuntos y decisiones: están planificados.
- La imagen del worker pesa algo más de 1 GB: lleva el CLI de Prisma porque migra al arrancar.

## Salud y operación

El worker expone `/livez` (para el contenedor) y `/health` (para Uptime Kuma y personas); la web,
`/api/health`. Qué mide cada uno: [ADR 0017](adr/0017-imagenes-y-comprobaciones-de-salud.md).
Despliegue, copias y caducidades: [operacion/](operacion/despliegue.md).
