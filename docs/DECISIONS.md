# Decisiones de arquitectura

Registro de decisiones del clasificador del buzón de Proveedores y su motivo. Las primeras salen del plan (`plans/261001-2123-clasificador-foodbox-lateral/`); las de la última sección se tomaron al montar la base del proyecto (2026-10-02).

## Alcance y comportamiento

- **Categorías automatizadas:** solo FOOD BOX, LATERAL y ARCOBETA. La sociedad facturada decide: FOODBOX → FOOD BOX, ARCO BETA → ARCOBETA, y las sociedades con "Lateral" en el nombre → LATERAL ([sociedades-categorias.md](sociedades-categorias.md)).
- **Orden de decisión:** reglas fuertes (CIF o razón social del propio correo) > herencia del hilo > reglas medias (palabras clave) > LLM > duda. Los correos dudosos se dejan sin categoría y se registran. Antes la herencia del hilo iba por delante de las reglas fuertes; el usuario decidió el 2026-10-02 que manda el CIF (ver «Correcciones de la revisión de código»).
- **Hilos:** una respuesta hereda la categoría de un correo anterior de la misma conversación (usando las categorías finales del equipo, nunca una decisión del sistema que el equipo corrigió); si no hay, se analiza. Una regla fuerte del propio correo gana a lo heredado.
- **Carpeta:** solo se sigue la Bandeja de entrada; los correos se quedan en ella al llegar.
- **Categorías de personas:** el clasificador nunca quita las que ponen las personas ni crea categorías por su cuenta. El panel permite ver la lista maestra y crear categorías nuevas (nombre y color) con confirmación, a través del worker; no renombra ni borra.
- **Retención:** el texto extraído de adjuntos se conserva 90 días; las decisiones, siempre.
- **Panel:** `https://clasificador.arcofood.com`, con SSO de Microsoft y una lista de usuarios autorizados (al principio solo el administrador inicial, `<ADMIN_EMAIL>`).
- **LLM:** proveedor y modelo activos en la tabla `LlmSetting`; el worker los lee en cada trabajo, así que cambiarlos no requiere redesplegar. Por defecto, Anthropic `claude-haiku-4-5-20251001`. Solo proveedores que no entrenen con los datos (RGPD).
- **PostgreSQL y pg-boss:** las colas usan el mismo PostgreSQL; no hace falta Redis.

## Despliegue

- **Nada en Dokploy hasta que el usuario lo autorice:** desarrollo y pruebas en local.
- **Dokploy sin Compose:** cada pieza (web, worker, docling, PostgreSQL nativo) es un servicio independiente, como `cpa.arcofood`. `compose.dev.yml` es solo para local.

### Mejoras respecto al despliegue de CPA

1. **Versión exacta, no `:latest`:** el flujo de publicación fija la imagen `:<sha corto>` y despliega; volver atrás es desplegar la etiqueta anterior. La versión se ve en `/health` y `/api/health` (`APP_VERSION`).
2. **Comprobación de salud en todos los servicios:** web, worker, docling (`/health`) y PostgreSQL (`pg_isready`).
3. **Reserva y límite de memoria en todos:** web 256 MiB / 512 MiB, worker 256 MiB / 1 GiB, docling 1,5 GiB / 4 GiB, PostgreSQL 256 MiB / 1 GiB; se ajustan con métricas reales tras la primera semana.
4. **Infraestructura descrita en el repositorio:** `infra/dokploy/provision.ts` idempotente a través de la API de Dokploy; no hay Compose para Dokploy.
5. **Una sola vía de despliegue:** `autoDeploy` apagado; solo despliega el flujo de publicación.
6. **Copias de seguridad comprobadas:** copia diaria al MinIO existente (7 copias) y `infra/scripts/restore-check.sh` mensual.
7. **Métricas visibles** antes del primer despliegue (monitorización de Dokploy o Beszel).

El detalle y la evidencia están en un informe interno que no se versiona en este repositorio.

## Base del proyecto

### Prisma 7 con `@prisma/adapter-pg` (no la 6.x de CPA)

- **Decisión:** Prisma 7.10.0 (versión fijada) con el adaptador `pg`, generador `prisma-client` (TypeScript en `packages/db/src/generated`, sin versionar) y `prisma.config.ts`.
- **Motivo:** el cliente no lleva motor de consultas en Rust, así que no hay binarios por plataforma que acertar en arm64 ni `binaryTargets`. Probado en esta máquina (aarch64): `generate`, `migrate dev` y `migrate deploy` funcionan, y la imagen del worker construye y migra en `linux/arm64`.
- **Coste:** solo el motor de migraciones sigue siendo un binario (lo descarga `prisma` en su postinstall; por eso `pnpm-workspace.yaml` lo aprueba en `allowBuilds`). `prisma` es dependencia de producción de `@clasificador/db` para que el worker ejecute `migrate deploy` al arrancar.
- **No se usa Prisma 8:** el `latest` del registro es una versión candidata (`8.0.0-rc`).

### Monorepo

- pnpm 11 con `apps/web`, `apps/worker`, `packages/db` y `packages/shared`, sin Turborepo: con cuatro paquetes `pnpm -r` basta. Un único `eslint.config.mjs` raíz.
- El worker ejecuta TypeScript con `tsx` en producción (como CPA), sin paso de compilación propio.

### Modelo de datos

- Las categorías se guardan como texto, no como enum: la lista maestra del buzón es dinámica. FOOD BOX | LATERAL | ARCOBETA se valida con Zod en `@clasificador/shared`.
- `Decision` guarda el JSON completo y una copia de `categories` (`text[]`) para contar y filtrar en el panel sin abrir el JSON. Un correo puede tener varias decisiones (reevaluaciones, modo sombra y live).
- `Rule` es única por `(type, value, category)`, lo que hace idempotente la semilla. Los CIF se guardan normalizados (mayúsculas, sin espacios, guiones ni puntos).
- `source` de la decisión admite `rule`, `llm`, `thread` (herencia del hilo) y `none` (sin señal ni LLM: `ruleId` y `model` a null y, salvo que el equipo ya haya etiquetado todo, en revisión), además de los dos del brief original. Es texto dentro del JSON, no un enum de base de datos: no hay migración.
- La caché de texto de adjuntos (`AttachmentText.hash`) usa como clave `sha256:p<ATTACHMENT_MAX_PAGES>`, de modo que cambiar el límite de páginas no sirve texto extraído con otro límite; el `sha256` del adjunto extraído sigue siendo el hash puro del fichero.
- `CategorySetting` (una fila por categoría, `mode` sombra/live, quién y cuándo) guarda el interruptor que se maneja desde el panel. Sin fila, la categoría está en sombra. El panel accede con SQL directo (tolera que la tabla no exista) y el worker la lee con Prisma solo para exponerla.
- Solo puede haber un `LlmSetting` activo: lo garantiza la aplicación al cambiarlo (en una transacción con bloqueo), no un índice parcial (Prisma no gestiona índices parciales y la migración quedaría fuera de su control).
- `Message.status` (`pending`, `processed`, `failed`) y `Message.needsReprocess`, `Decision.degraded` y `AllowedUser.oid` (nulo, único) son de la migración `estado_de_correos_oid_y_reproceso`; los correos que ya tenían decisión pasan a `processed`.

### Contenedores

- Imágenes sobre `node:22-bookworm-slim` (glibc) en vez de Alpine como en CPA: el motor de migraciones de Prisma y `tsx` no dan sorpresas de musl. A cambio, pesan más (web ~430 MB, worker ~1,9 GB por el CLI de Prisma).
- Usuario `node` sin privilegios, `HEALTHCHECK` por `fetch` de Node (no hace falta `curl`): web contra `/api/health`, worker contra `/livez` (ver «Correcciones de la revisión de código»).
- `/health` del worker responde 503 si `SyncState.lastSyncAt` es nulo o tiene más de 5 minutos, o si la base de datos no responde.
- Puertos de desarrollo: PostgreSQL 5442, docling 127.0.0.1:5101, web 3110 (configurable con `WEB_HOST_PORT`); el 3000, 3001 y 5432 los usan otros proyectos. Todos los puertos publicados escuchan solo en 127.0.0.1.

## Servicio en modo sombra y despliegue

### Sincronización con el buzón

- **Delta query por carpeta, una sola corriente:** solo la Bandeja de entrada (`/mailFolders/inbox/messages/delta`) con `$select=id,receivedDateTime,conversationId,categories`. No se usa `changeType`: Graph no distingue creados de actualizados en la carga útil, así que se decide por la base de datos (correo desconocido = nuevo y se encola; conocido = posible corrección). Los `@removed` (movido o borrado) solo se cuentan: la última corrección registrada antes del movimiento es la que cuenta.
- **Primera ronda sin histórico:** sin estado previo se pide solo `receivedDateTime ge <ahora - 1 min>` (el filtro queda codificado en el `deltaLink`), de modo que no se reprocesa el histórico (de eso se encarga la importación) y solo se obtiene el `deltaLink`. El minuto de margen cubre el desfase de reloj con Exchange; un duplicado es inocuo por la idempotencia.
- **`deltaLink` solo al terminar la ronda:** si algo falla (Graph, base de datos o cola) la siguiente ronda repite los mismos cambios. Un 410 olvida el `deltaLink` y resincroniza desde la fecha de recepción del correo registrado más antiguo (o la última sincronización si no hay ninguno), para que el nuevo `deltaLink` siga viendo las correcciones de los correos ya conocidos; un segundo 410 seguido se propaga.
- **Sondeo:** `POLL_INTERVAL_SECONDS` (90 por defecto, recomendado 60-120, admite 15-600), rondas secuenciales (nunca solapadas), `Retry-After` lo respeta el cliente de Graph. `WORKER_CONCURRENCY` (2) limita los correos en proceso.
- **Una sola instancia:** bloqueo asesor de PostgreSQL (`pg_try_advisory_lock`) en una conexión dedicada de `pg` (dependencia directa del worker). Una segunda instancia espera (`/health` 503 "esperando el bloqueo") y toma el relevo cuando la primera termina; si la conexión del bloqueo se pierde, el proceso sale para que Swarm lo reinicie. Por eso el servicio no debe usar actualización `start-first`.
- **Categorías disponibles:** `/outlook/masterCategories` del buzón con caché de 5 minutos; si el refresco falla se usa la copia anterior.

### Trabajos (pg-boss)

- **Cola `process-message`:** un trabajo en espera por correo (`policy: short` + `singletonKey = messageId`), 5 reintentos con retroceso exponencial desde 30 s y caducidad de 30 minutos (la extracción con OCR puede tardar). Es idempotente: no hace nada si ya hay una `Decision` del mismo modo, y dentro del proceso un mismo correo no se procesa dos veces a la vez. Un 404 de Graph (correo ya movido o borrado) termina el trabajo sin error.
- **Qué guarda:** `Message` al detectarlo (pendiente) y, al terminar, `Message` y `Decision` en una transacción; `Decision.model`, `inputTokens`, `outputTokens`, `costUsd` y `latencyMs` (milisegundos de la llamada al LLM, null si no hubo) salen de la decisión y del uso del LLM; `mode` es el de la ejecución.
- **Cambios del equipo durante el procesado:** como el correo ya existe desde que se detecta, un cambio de categorías mientras su trabajo está en curso actualiza `seenCategories` (y el trabajo no lo pisa al guardar la decisión). Si el cambio llega antes de que se extraiga el correo, el clasificador lo trata como puesto por el equipo al llegar, no como corrección.
- **Limpieza:** cola `cleanup-attachment-text`, programada cada día a las 03:30 (Europe/Madrid), que llama a `deleteExpiredAttachmentTexts`.

### Correcciones

- Un cambio de categorías en un correo ya registrado se compara con su última decisión, solo en FOOD BOX/LATERAL/ARCOBETA y sin importar el orden. En modo sombra todo cambio es del equipo. En modo live, un cambio que solo suma lo decidido por el servicio es propio y se ignora.
- Si el equipo vuelve a dejar lo propuesto después de haberlo corregido, se registra una corrección con `proposed` igual a `final`, para que la última corrección de cada correo sea la vigente. Un acuerdo sin corrección previa no se registra. `Message.seenCategories` se actualiza siempre que cambie algo.

### Modo y salud

- `CategorySetting` solo se expone: `/health` incluye `categoryModes` y, si el panel pone una categoría en live, el worker lo registra como aviso (una vez por cambio) y sigue en sombra. La activación real (aplicar categorías en Outlook) no existe todavía.
- `MODE=shadow` por defecto. `MODE=live` se acepta en la configuración pero el worker se niega a arrancar con un mensaje claro: el PATCH de categorías no está implementado.
- **Sin credenciales de Graph** el worker arranca, aplica migraciones, mantiene la limpieza diaria, no sincroniza, lo dice en el log y `/health` responde 503 con `status: "disabled"` y `reason`.
- **`/health`:** 200 solo con una sincronización correcta de menos de `SYNC_STALE_SECONDS`; incluye `version` (la `APP_VERSION` de la imagen, el sha corto; no se introduce una variable `IMAGE_TAG` aparte porque la web y el Dockerfile ya usan `APP_VERSION`), `mode`, `lastSyncAt` y, si no está sano, `reason` (error de la última ronda, retraso, base de datos caída o motivo de arranque).
- **Heartbeat:** `UPTIME_KUMA_PUSH_URL` opcional; `status=up` tras cada ronda correcta y `status=down` con el error si falla. Nunca interrumpe la sincronización.

### Publicación y despliegue

- **Imágenes por commit:** cada push a `main` publica `clasificador-web` y `clasificador-worker` (linux/arm64, runner arm64 nativo) con la etiqueta del sha corto, que es también la `APP_VERSION` horneada; `latest` solo como referencia.
- **Despliegue solo en tag `vX.Y.Z` o a mano, y solo con `DOKPLOY_API_KEY`:** fija la imagen exacta (`application.saveDockerProvider`), despliega el worker (`application.deploy`), espera a que su despliegue termine bien y su contenedor esté sano con la imagen nueva (`infra/scripts/wait-dokploy-app.sh`), despliega la web, espera a que `/api/health` devuelva esa versión y vuelve a comprobar el worker. Las aplicaciones se localizan por nombre, sin un secreto con identificadores. Volver atrás es lanzar el workflow con la etiqueta anterior.
- **`provision.ts` no despliega web ni worker:** solo PostgreSQL y docling, la primera vez. Nunca cambia la imagen de una aplicación existente (es cosa del flujo de publicación). Docling se fija a `v1.36.0` (la versión probada en local), no a `latest`.
- **Unidades de Dokploy:** la memoria va en bytes sin sufijos y las comprobaciones de salud de Swarm en nanosegundos, tal como las pasa Dokploy a Docker. Los `appName` los asigna Dokploy (con sufijo), así que el script los lee tras crear cada servicio y los escribe en `DATABASE_URL` y `DOCLING_URL`.
- **`infra/dokploy` es un paquete del workspace** (`@clasificador/dokploy-provision`) para que sus pruebas, tipos y lint entren en `pnpm test`, `typecheck` y `lint`. Las imágenes no lo necesitan: se verificó que `pnpm install --frozen-lockfile --filter` funciona sin ese directorio.
- **`restore-check.sh`:** restaura en un `postgres:16-alpine` temporal de nombre único y exige filas en `Message`, `Decision` y `Rule` y todas las migraciones del repositorio aplicadas y terminadas. Detecta solo el formato (custom o SQL, con o sin gzip) porque Dokploy llama `.sql.gz` a copias que pueden ser formato custom comprimido.

### Advertencias de despliegue

- **El worker sin credenciales de Graph ya no se reinicia en bucle:** el `HEALTHCHECK` usa `/livez`, que no mide la sincronización. Aun así no sincroniza hasta que se configuren `GRAPH_*` y el certificado montado.
- **Actualización `stop-first` (la de por defecto).** Con `start-first` la instancia nueva esperaría el bloqueo de instancia única y nunca llegaría a estar sana; la anterior no se pararía.

## Panel

### Sesión y acceso

- **Sesión sin estado (better-auth).** La sesión viaja en una cookie cifrada de 8 horas; no hay tablas `user`, `session`, `account` ni `verification` y el esquema Prisma no depende de better-auth. A cambio, la sesión no se puede invalidar en el servidor antes de caducar.
- **`AllowedUser` es la autoridad y se consulta en cada petición.** Estar en el tenant de Microsoft no basta: cada página del panel, el layout y todas las acciones del servidor comprueban la lista, de modo que quitar a alguien le corta el acceso en su siguiente petición aunque su cookie siga viva. Una cuenta del tenant que no esté en la lista ve "Sin acceso".
- **Solo `openid`, `profile` y `email`.** No hace falta `User.Read` (se desactivan los ámbitos por defecto de better-auth); el correo sale del token de identidad. La app de Entra es de un solo tenant.
- **`AUTH_DEV_BYPASS`** solo vale con `NODE_ENV=development`; una compilación de producción lo ignora aunque la variable esté puesta.

### Modo por categoría

- Los interruptores sombra/live de `/configuracion` escriben en `CategorySetting`. Pasar a live exige una casilla de confirmación, validada también en el servidor. Hoy es solo una preferencia guardada: el worker no aplica categorías (ver "Modo y salud").

### Botón «Probar» (pg-boss)

- El panel no incluye el clasificador ni las claves de LLM. «Probar» encola en pg-boss un trabajo `test-classify` (proveedor, modelo y un correo: el pegado o uno sintético con el CIF de una sociedad de la tabla) y espera el resultado por sondeo, hasta 60 s. Pasado ese tiempo cancela el trabajo para que el worker no llame al modelo cuando ya nadie espera.
- El worker lo atiende con el clasificador usando **ese** proveedor y modelo, sin tocar `LlmSetting`, y devuelve la decisión, tokens, coste y latencia. El correo va directo al LLM, sin reglas ni herencia del hilo (con reglas, un correo con un CIF de la tabla nunca llegaría al modelo). Si falta la clave del proveedor, el resultado es `unavailable` con el nombre de la variable que falta.
- La cola no tiene reintentos y caduca a los 120 s. El panel usa un cliente de pg-boss que no migra, no supervisa ni programa (eso es del worker), así que la cola existe cuando el worker ha arrancado al menos una vez. El worker registra el atendedor aunque no tenga credenciales de Graph.
- Solo usuarios autenticados (acción del servidor tras `requireUser`). El texto pegado viaja en los datos del trabajo de pg-boss: el panel lo borra en cuanto lee el resultado, y la cola lo elimina a los 5 minutos como máximo (`deleteAfterSeconds`). No se guarda en ninguna otra tabla; no hay que pegar datos que no deban salir hacia el proveedor elegido.

## Correcciones de la revisión de código (2026-10-02)

Decisiones tomadas al corregir la revisión completa (`plans/reports/code-reviewer-261002-1816-revision-completa.md`). El informe de la corrección está en `plans/reports/fullstack-developer-261002-1836-correcciones-revision.md`.

### Clasificador

- **Hilo contra CIF: manda el CIF (decisión del usuario).** Una regla fuerte (CIF o razón social) del propio correo gana a la herencia del hilo y descarta las demás categorías, como ya hacía entre sociedades. La herencia queda por delante de las reglas medias.
- **La herencia usa las categorías finales del equipo.** Por cada correo del hilo: la última corrección si existe; si no, las categorías que tiene en Outlook; solo si nadie lo ha revisado (sin corrección ni categorías), su última decisión. Una decisión que el equipo corrigió, o que dejó sin categorías, no se hereda.
- **El pie de firma interno no dispara reglas fuertes.** Si el remitente es de un dominio del grupo (`INTERNAL_EMAIL_DOMAINS`, sin valor por defecto), el CIF y la razón social solo cuentan en los adjuntos y en el bloque reenviado o citado del cuerpo (detectado por «Mensaje original», «Forwarded message», cabecera «De:/Enviado:» o «… escribió:»); el asunto y el resto del cuerpo, que llevan su pie legal, no cuentan. Con remitente externo no cambia nada. Si el correo reenviado no tiene marca de reenvío reconocible, el cuerpo no cuenta (decide el adjunto o el LLM).
- **Fallos técnicos frente a decisión válida.** Docling caído (conexión rechazada o cortada, tiempo agotado, 408, 429, 502, 503, 504) o descarga de adjunto con error de servidor o de red, y LLM fallido (`failed`): el trabajo lanza y pg-boss reintenta con retroceso (5 reintentos, unos 15 minutos). Agotados, se guarda la decisión marcada `Decision.degraded` y el correo con `Message.needsReprocess`. Un LLM no disponible (sin clave o sin modelo activo) o no se arregla solo: se guarda degradada a la primera, sin reintentos. Un fichero que docling no sabe convertir (4xx, 500, `failure`) no es un fallo técnico: se omite el adjunto como antes. Un trabajo que agota los reintentos sin decisión deja el correo `failed` y marcado. Una decisión degradada no cuenta como decisión válida para la idempotencia, no entra en las métricas ni en el acierto por modelo, y se sustituye al reprocesar (nueva `Decision`; la vigente es la más reciente).
- **Reproceso.** Botón en el Resumen y `pnpm --filter @clasificador/worker reprocess` (`--dry-run` solo cuenta): vuelven a encolar los correos con `needsReprocess`. El botón encola un trabajo `reprocess-flagged` y espera a que el worker responda cuántos eran.
- **`Message` desde la detección.** La delta registra el correo como `pending` (remitente y asunto vacíos hasta procesarlo) antes de encolarlo; al terminar pasa a `processed` (o `failed`). Así «pendientes» y «fallidos» son reales y los cambios del equipo durante el procesado no se pierden. Un cambio en un correo conocido que sigue pendiente lo vuelve a encolar (es idempotente). Un correo que da 404 al procesarlo se borra si nunca tuvo decisión.
- **Limitación.** Los adjuntos que son un correo (`.eml`, `.msg`, `itemAttachment`) no están soportados: no se leen ni se avisa de ellos; un reenvío que adjunta el correo original pierde el PDF que lleva dentro. No se ha medido cuántos casos hay en el histórico.

### Métrica de acierto

- **Solo cuentan los correos que el equipo ha revisado**, es decir, los que tienen alguna categoría en Outlook (aunque no sea de las tres) o una corrección. Los demás no suman ni como acierto ni como fallo (ni en la tabla por categoría, ni en el acierto por modelo, ni en las discrepancias) y se muestran aparte como «pendientes de revisar». Las decisiones degradadas tampoco cuentan (están pendientes de reprocesar). Antes un correo sin revisar contaba como «el equipo no puso nada» y todo lo propuesto era un falso positivo.
- El panel limita el rango de fechas a 366 días (carga en memoria todos los correos del periodo).

### Panel y permisos

- **La web no tiene credenciales de Graph.** Leer y crear categorías maestras pasa por el worker con pg-boss (`list-master-categories`, `create-master-category`; la web encola y sondea hasta 15 s para leer y 30 s para crear, el worker ejecuta con su certificado, comprueba que la categoría no exista y la crea). Se quitan `GRAPH_*`, `MAILBOX` y el montaje del certificado de la web (config, `provision.ts`, `.env.example`, README y guías) y la dependencia `@azure/identity` de la web. Sin worker o sin credenciales, `/categorias` muestra el motivo en lugar de fallar.
- **Auditoría de categorías.** `CategoryAudit` lo escribe la web con el usuario de la sesión, tras recibir `created` del worker. El worker no recibe ni confía en un email que viaje en el trabajo; el coste es que, si la web cae justo entre la creación y el registro, la categoría existe sin registro (el panel lo avisa si falla la escritura).
- **Acceso atado a `oid` y `tid`, no solo al email.** `AllowedUser.oid` (nulo, único) se rellena en el primer acceso válido (email dado de alta) y desde entonces debe coincidir. El `tid` del token debe ser el de `MS_TENANT_ID`: se comprueba al iniciar sesión, que es el único momento en que se procesa un token de Microsoft (un tenant distinto vuelve a `/login?error=email_not_found`). El `oid` sale de la cuenta que better-auth guarda como `accountId` (el `oid` verificado del id_token); no se pudo llevar `oid`/`tid` al usuario de la sesión con `additionalFields`, que en modo sin estado los descarta. Para cambiar a alguien de cuenta de Microsoft hay que darle de baja y de alta. Mientras no inicie sesión, el hueco está sin vincular (confianza en el primer uso): conviene vigilar la columna «Cuenta de Microsoft» de Configuración.
- **Comprobación de acceso en cada página.** Con el renderizado parcial de Next.js el layout no protege las páginas: `requireUser()` está en cada página del grupo `(panel)` y en cada acción, antes de leer datos; solo `/api/health` y `/api/auth` son route handlers. Una prueba lo comprueba sobre el código y se verificó con peticiones RSC reales (`RSC: 1`).
- **Cabeceras:** `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options` y `Referrer-Policy` (contra el clickjacking de las acciones con confirmación).
- **Carreras de configuración:** quitar usuarios y cambiar el modelo se hacen en una transacción con un bloqueo asesor de PostgreSQL, de modo que dos administradores no pueden dejar la lista vacía ni dos modelos activos.

### Servicio

- **Datos iniciales en cada arranque del worker.** Tras las migraciones aplica, de forma idempotente y sin sobrescribir, las 14 reglas fuertes, el administrador inicial (`ADMIN_EMAIL`, sin valor por defecto) y el modelo por defecto. El administrador solo se da de alta si no hay ningún usuario (si no, un administrador quitado a propósito reaparecería en cada arranque) y `ADMIN_EMAIL` tiene valor; si falta en ese caso, el worker lo registra y arranca sin crear ningún administrador; el modelo, solo si `LlmSetting` está vacía. `pnpm db:seed` usa la misma función. No se añadió el aviso «sin reglas activas» a `/health`: con la semilla automática deja de ser un caso normal.
- **`/livez` para el HEALTHCHECK.** Responde 200 cuando el proceso ha arrancado (migraciones, datos iniciales y colas listos; `start-period` de 120 s) y el bucle de sincronización avanza (no lleva más de 15 minutos, o 10 intervalos, sin empezar o terminar una ronda); no mide a Graph. `/health` mantiene la frescura (503 si la sincronización es antigua) para Uptime Kuma. Si Graph o Entra caen no hay reinicios en bucle.
- **Despliegue.** El flujo despliega el worker, espera a que termine bien y esté sano (esto implica migrado, porque `/livez` no responde 200 antes) y solo entonces despliega la web; comprueba ambos al final. La consulta de contenedores de Dokploy no se probó contra un Dokploy real.
- **Histórico:** los informes de candidatas de reglas y de la prueba de extracción van a `data/history/` (ignorado), no a `plans/reports/`: incluyen direcciones y nombres de ficheros de terceros. `.dockerignore` excluye `data`, `secrets`, `.claude` y `.agentkit`; `.agentkit/` está en `.gitignore`.
- **Candidatas de reglas (decisión del usuario).** Nunca se propone una regla de dominio entero para dominios de correo público (gmail.com, googlemail.com, outlook.com, outlook.es, hotmail.com, hotmail.es, live.com, msn.com, yahoo.com, yahoo.es, icloud.com, me.com, proton.me, protonmail.com, gmx.com, gmx.es, y las operadoras telefonica.net y movistar.es) ni de los dominios del grupo (`INTERNAL_EMAIL_DOMAINS`, los mismos que usa el worker). Para los públicos sí puede proponerse la dirección concreta si cumple el umbral y el mínimo de apariciones; para los internos, ni dirección (los compañeros reenvían de todo). `--apply` repite el filtro por si el fichero de candidatas es anterior. Esos correos se siguen clasificando por CIF y razón social.
- **`restore-check.sh`:** una migración fallida que se resolvió y se volvió a aplicar ya no hace fallar la comprobación para siempre; `minio/mc` va fijada por digest.
