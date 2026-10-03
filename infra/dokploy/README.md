# Despliegue en Dokploy

Cuatro servicios independientes en el proyecto `clasificador.arcofood`, entorno `production`, sin Compose (como `cpa.arcofood`). `infra/docker/compose.dev.yml` es solo para desarrollo local.

Todo lo que se describe aquí lo crea y comprueba [`provision.ts`](provision.ts). La configuración real (límites, comprobaciones de salud, dominio, copias) no vive solo en la interfaz de Dokploy: está en este directorio y se puede volver a aplicar.

## Servicios

| Servicio | Tipo | Imagen | Puerto interno | Dominio | Memoria (reserva / límite) | Comprobación de salud |
| --- | --- | --- | --- | --- | --- | --- |
| `clasificador-web` | Application | `ghcr.io/<propietario>/clasificador-web:<sha corto>` | 3000 | `clasificador.arcofood.com` (Let's Encrypt) | 256 MiB / 512 MiB | `GET /api/health` |
| `clasificador-worker` | Application | `ghcr.io/<propietario>/clasificador-worker:<sha corto>` | 8080 (solo interno) | ninguno | 256 MiB / 1 GiB | `GET /livez` (arrancado y con el bucle avanzando) |
| `clasificador-docling` | Application | `ghcr.io/docling-project/docling-serve-cpu:v1.36.0` | 5001 (solo interno) | ninguno | 1,5 GiB / 4 GiB | `GET /health` (curl) |
| `clasificador-db` | PostgreSQL nativo | `postgres:16-alpine` | 5432 (sin puerto publicado) | ninguno | 256 MiB / 1 GiB | `pg_isready -U clasificador -d clasificador` |

- Todas: 1 réplica, `autoDeploy` apagado (la única vía de despliegue es el workflow de publicación) y `TZ=Europe/Madrid`.
- No hay Redis: la cola (pg-boss) usa el mismo PostgreSQL.
- Los servicios se hablan por `dokploy-network` con el `appName` que Dokploy asigna (puede llevar un sufijo aleatorio). `provision.ts` lo lee y lo escribe en `DATABASE_URL` y `DOCLING_URL`.
- Los límites de memoria son un punto de partida: se ajustan con las métricas reales tras la primera semana.
- Copia de seguridad diaria de `clasificador-db` a las 03:00 al destino MinIO existente (`S3 Minio Dokploy Proyectos`), prefijo `clasificador`, 7 copias.

## Variables de entorno

`provision.ts` solo escribe las claves que se indican; las demás que añadas a mano en Dokploy se respetan. `APP_VERSION` no se define: la fija la imagen (sha corto) y es lo que devuelven `/health` y `/api/health`.

### `clasificador-worker`

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | `postgresql://clasificador:<contraseña>@<appName de clasificador-db>:5432/clasificador` (secreto; solo si defines `CLASIFICADOR_DB_PASSWORD`) |
| `DOCLING_URL` | `http://<appName de clasificador-docling>:5001` |
| `MODE` | `shadow` (con `live` el worker se niega a arrancar: el PATCH de categorías no existe todavía) |
| `MAILBOX` | `<MAILBOX>`: el valor de `MAILBOX` del entorno del script (obligatoria, sin valor por defecto) |
| `GRAPH_CERT_PATH` | `/run/secrets/graph-cert.pem` (el certificado se monta como fichero, ver abajo) |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` | del entorno del script, si están definidas |
| `ADMIN_EMAIL` | `<ADMIN_EMAIL>`: administrador inicial del panel, del entorno del script (obligatoria, sin valor por defecto); ver «Datos iniciales» |
| `INTERNAL_EMAIL_DOMAINS` | dominios de correo del grupo, separados por comas, del entorno del script si está definida (sin valor por defecto: sin ella no hay remitentes internos) |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` | secretos del entorno del script, solo los que uses; el proveedor y el modelo activos se eligen en el panel |
| `UPTIME_KUMA_PUSH_URL` | URL de push del monitor de Uptime Kuma (heartbeat tras cada sincronización correcta) |
| `POLL_INTERVAL_SECONDS` | `90` (recomendado 60-120) |
| `WORKER_CONCURRENCY` | `2` |
| `CLASSIFY_CONFIDENCE_THRESHOLD` | `0.8` |
| `HEALTH_PORT`, `SYNC_STALE_SECONDS` | `8080`, `300` |
| `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_MAX_PAGES`, `DOCLING_TIMEOUT_SECONDS` | solo si están en el entorno del script; si no, valen los de `.env.example` |

Sin credenciales de Graph el worker arranca, atiende las colas del panel (probar modelos, categorías, reproceso; las categorías responden «sin credenciales» y el panel lo muestra), no sincroniza y `/health` responde 503 con `"status":"disabled"` y el motivo (por ejemplo, `sin credenciales de Graph (faltan: ...)`).

El `HEALTHCHECK` de Docker y Swarm usa `/livez`, no `/health`: responde 200 cuando el proceso ha arrancado del todo (migraciones y datos iniciales aplicados, colas listas) y su bucle de sincronización avanza, y 503 mientras arranca o si el bucle lleva 15 minutos sin avanzar. **No mide la frescura de la sincronización con Graph**: si Graph o Entra caen, el contenedor sigue sano y no hay reinicios en bucle. La frescura se expone en `/health` (campo `lastSyncAt`, 503 si es antigua) y la vigila Uptime Kuma. Por eso ya se puede desplegar el worker sin credenciales de Graph y verlo sano.

#### Datos iniciales (semilla)

Tras aplicar las migraciones, el worker aplica en cada arranque, de forma idempotente, los datos mínimos para funcionar: las 14 reglas fuertes (CIF y razón social de las siete sociedades), el administrador inicial (`ADMIN_EMAIL`) y el modelo de LLM por defecto. **Solo inserta lo que falta y nunca sobrescribe lo existente**: una regla desactivada sigue desactivada; el administrador solo se da de alta si no hay ningún usuario autorizado y `ADMIN_EMAIL` tiene valor (si falta en ese caso, el worker lo registra en el log, arranca igualmente y no crea ningún administrador; si alguien lo quita más adelante, no vuelve); el modelo por defecto solo se crea si la tabla `LlmSetting` está vacía. Así el primer despliegue deja el panel accesible y las reglas cargadas sin ejecutar nada a mano.

#### Correos marcados para reprocesar

Si docling o el modelo de lenguaje fallan, el trabajo se reintenta con retroceso (5 reintentos, unos 15 minutos). Si siguen fallando, la decisión se guarda marcada como degradada y el correo queda para reprocesar; un trabajo que agota los reintentos sin decisión queda como fallido, también marcado. El panel (Resumen) cuenta pendientes, fallidos y por reprocesar, y tiene el botón **Reprocesar los N marcados**. Desde el contenedor del worker: `node_modules/.bin/tsx scripts/reprocess.ts` (con `--dry-run` solo cuenta).

### `clasificador-web`

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | la misma que el worker |
| `BETTER_AUTH_URL` | `https://clasificador.arcofood.com` |
| `BETTER_AUTH_SECRET` | secreto del entorno del script (`openssl rand -base64 32`) |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | app de login del panel en Entra ID (`MS_CLIENT_SECRET` es secreto) |
| `SYNC_STALE_SECONDS` | `300` |

La web **no** lleva credenciales de Graph, ni el certificado, ni `MAILBOX`: es el contenedor expuesto a Internet y no debe poder tocar el buzón. Lee y crea las categorías del buzón pidiéndoselo al worker por la cola de trabajos (`list-master-categories`, `create-master-category`); si el worker no está en marcha o no tiene credenciales, la pantalla Categorías muestra el motivo.

El panel puede ir ganando variables; la lista autoritativa es `apps/web/src/lib/panel-env.ts`. Si añade alguna, añádela también a `buildEnv` en `provision.ts`; una prueba compara las variables de `.env.example` que leen la web y el worker con las que escribe `buildEnv` y falla si falta alguna.

### `clasificador-docling`

Solo `TZ`. No lleva más configuración ni puertos publicados.

### Certificado de Graph

Solo el worker monta el certificado (PEM con clave privada y certificado, generado con `infra/scripts/generate-cert.sh`) como un fichero de Dokploy en `/run/secrets/graph-cert.pem`. `provision.ts` lo crea desde el fichero que indiques con `GRAPH_CERT_PEM_FILE`; si no lo indicas, no toca el montaje y avisa. El contenido nunca se imprime. Si la web tiene montado el certificado de una versión anterior, el script avisa de que lo elimines (no borra nada).

## Cómo ejecutar `provision.ts`

Necesita Node 22.18 o superior (ejecuta TypeScript directamente). Desde la raíz del repositorio:

```bash
export DOKPLOY_URL=https://<panel de Dokploy>          # con o sin /api
export DOKPLOY_API_KEY=...                              # Dokploy > Settings > Profile > API/CLI
export GHCR_OWNER=<propietario de las imágenes en GHCR>

node infra/dokploy/provision.ts              # --dry-run (por defecto): solo muestra los cambios
node infra/dokploy/provision.ts --check      # igual, pero sale con código 2 si hay diferencias
node infra/dokploy/provision.ts --apply      # aplica los cambios
```

`--dry-run` lee el estado de Dokploy (solo lecturas) y muestra qué crearía o cambiaría. Sin `DOKPLOY_URL` ni `DOKPLOY_API_KEY` muestra lo que crearía en un Dokploy vacío. `--apply` exige las dos y `GHCR_OWNER`.

Variables **obligatorias** del entorno del script al construir el entorno del worker de producción (las direcciones reales nunca están en el repositorio; si falta alguna, el script se detiene con un error que la nombra):

| Variable | Para qué |
| --- | --- |
| `MAILBOX` | Buzón que se clasifica. |
| `ADMIN_EMAIL` | Administrador inicial del panel; el worker lo da de alta solo si no hay ningún usuario autorizado. |

Variables opcionales del entorno del script:

| Variable | Para qué |
| --- | --- |
| `CLASIFICADOR_DB_PASSWORD` | Contraseña de PostgreSQL (mínimo 16 caracteres, solo letras y números, para que la URL de conexión no necesite escapes). Obligatoria al crear la base de datos y para escribir `DATABASE_URL`. Ej.: `openssl rand -hex 24` |
| `BACKUP_DESTINATION_NAME` | Nombre del destino de copias en Dokploy (por defecto `S3 Minio Dokploy Proyectos`; debe existir) |
| `GRAPH_CERT_PEM_FILE` | Ruta al PEM del certificado de Graph (solo se monta en el worker) |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `INTERNAL_EMAIL_DOMAINS`, claves de LLM, `UPTIME_KUMA_PUSH_URL` | Se copian al worker solo si están definidas |
| `MS_*`, `BETTER_AUTH_SECRET` | Se copian a la web solo si están definidas |
| `WEB_IMAGE`, `WORKER_IMAGE` | Imagen inicial al crear cada aplicación (por defecto `ghcr.io/$GHCR_OWNER/clasificador-<app>:latest`); después la fija el workflow de publicación y el script no la toca |
| `GHCR_USERNAME`, `GHCR_TOKEN` | Credenciales de descarga de GHCR si las imágenes son privadas (token con `read:packages`) |

Qué hace y qué no:

- Es idempotente: una segunda ejecución no escribe nada. Solo corrige los campos que difieren (memoria, comprobación de salud, `autoDeploy`, réplicas, puerto de PostgreSQL no publicado, dominio, copia de seguridad, variables y certificado). No borra nada.
- Primera vez: arranca PostgreSQL y docling, que no dependen de ninguna versión. **No despliega web ni worker**: los despliega el workflow de publicación con la etiqueta exacta.
- Si cambia la configuración de un servicio ya desplegado, el script lo avisa: el cambio surte efecto en el siguiente despliegue (en web y worker, desplegando de nuevo la etiqueta actual).
- Avisa de dominios no previstos (la web tiene solo `clasificador.arcofood.com`; el resto, ninguno).

Antes del primer despliegue, activa las métricas: monitorización de Dokploy (Settings > Monitoring) o vigila los contenedores con Beszel, para poder ajustar los límites tras la primera semana.

## Publicación y despliegue

[`.github/workflows/release.yml`](../../.github/workflows/release.yml):

1. Cada push a `main` construye y publica `clasificador-web` y `clasificador-worker` para `linux/arm64` en GHCR con la etiqueta del commit (sha corto, 7 caracteres) y `latest` (solo como referencia; nunca se despliega).
2. Un tag `vX.Y.Z` construye lo mismo y, solo si existe el secreto `DOKPLOY_API_KEY`, despliega: busca las aplicaciones por nombre, fija la imagen exacta con `application.saveDockerProvider` y llama a `application.deploy` **primero para el worker**. Antes de tocar la web, [`infra/scripts/wait-dokploy-app.sh`](../scripts/wait-dokploy-app.sh) espera (hasta 10 minutos) a que el despliegue del worker termine bien (`deployment.all`: `done`; `error` o `cancelled` detienen el flujo) y a que su contenedor lleve la imagen nueva y esté `(healthy)`, es decir, con las migraciones ya aplicadas (el `HEALTHCHECK` `/livez` no responde 200 hasta entonces). Solo entonces se despliega la web, se espera hasta 5 minutos a que `https://clasificador.arcofood.com/api/health` devuelva esa versión y se vuelve a comprobar el worker. Si el worker falla, el flujo termina en rojo y la web no se despliega. Limitación: la consulta de contenedores (`docker.getContainersByAppNameMatch`) no se ha podido probar contra un Dokploy real; si Dokploy no la ofrece (HTTP 4xx) el script avisa y se queda con el estado del despliegue.

Secretos del repositorio: `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` y, con imágenes privadas, `GHCR_PULL_USERNAME` y `GHCR_PULL_TOKEN`. Variable opcional: `WEB_URL`.

## Cómo volver atrás

Despliega la etiqueta anterior; no hace falta reconstruir nada:

1. Elige el sha corto de la versión buena (en Dokploy, el historial de despliegues muestra el título `Release vX.Y.Z (<sha>)`; en GHCR, las etiquetas del paquete).
2. GitHub > Actions > "Release — imágenes arm64 y despliegue" > Run workflow, con `tag` = ese sha. Fija la imagen, despliega el worker, espera a que esté sano, despliega la web y espera a que devuelva esa versión.
3. Comprueba `GET /api/health` (web) y, desde el contenedor, `GET /livez` y `GET /health` (worker): todos devuelven la versión (`/health` responde 503 mientras no haya una sincronización reciente, aunque la versión sea la correcta).

Si hay que hacerlo sin GitHub: en la aplicación de Dokploy, Provider > Docker, cambia la etiqueta de la imagen y pulsa Deploy.

Las migraciones de Prisma solo avanzan: una versión anterior de la imagen con un esquema posterior debe ser compatible, o se restaura la copia de seguridad.

## Copias de seguridad

Dokploy hace la copia diaria; [`infra/scripts/restore-check.sh`](../scripts/restore-check.sh) comprueba una vez al mes que se puede restaurar:

```bash
MINIO_ENDPOINT=https://<minio> MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
MINIO_BUCKET=<bucket> BACKUP_PATH=<appName de clasificador-db>/clasificador \
KUMA_PUSH_URL=https://<kuma>/api/push/<token> \
bash infra/scripts/restore-check.sh
```

Baja la última copia, la restaura en un `postgres:16-alpine` temporal con nombre único, comprueba que `Message`, `Decision` y `Rule` tienen filas y que `_prisma_migrations` no tiene migraciones fallidas y contiene todas las del repositorio, y borra el contenedor. Con `--from-file <volcado>` prueba un `pg_dump` local. Si falla avisa a Uptime Kuma (`status=down`). Antes del primer mes con datos reales puedes bajar los mínimos (`MIN_ROWS_MESSAGE=0 MIN_ROWS_DECISION=0`).

## Pruebas

```bash
pnpm --filter @clasificador/dokploy-provision test
```

Cubren el cálculo de diferencias y la idempotencia de `provision.ts` contra un Dokploy simulado en memoria. No hay pruebas contra un Dokploy real: la primera vez, ejecuta `--dry-run` y revisa el resultado antes de `--apply`.
