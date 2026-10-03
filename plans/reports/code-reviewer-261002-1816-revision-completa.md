# Revisión completa del clasificador del buzón de Proveedores

Fecha: 2026-10-02 · Rama: `feat/clasificador-foodbox-lateral` (sin commits; se revisa el árbol completo) · Revisor: code-reviewer

## Resumen

El código es ordenado, está bien tipado y las piezas delicadas tienen un diseño razonable: SQL siempre parametrizado, Graph solo en el servidor, secretos fuera de git y de los logs, worker que se niega a arrancar en `live`, bloqueo de instancia única, `deltaLink` que solo se guarda al terminar la ronda y CI/CD con versiones fijas. `pnpm lint` termina sin avisos, `pnpm typecheck` pasa y `pnpm test` pasa (335 pruebas; las 3 de integración se saltan sin `RUN_INTEGRATION=1`).

Aun así, hay cuatro problemas de gravedad alta que conviene resolver antes del primer despliegue:

1. Las páginas del panel solo comprueban el acceso en el layout; con el renderizado parcial de Next.js eso no protege las páginas.
2. En producción nadie ejecuta la semilla. Sin ella el panel queda inaccesible y el worker graba decisiones vacías que no se vuelven a calcular nunca.
3. La herencia del hilo hace caso omiso de las correcciones del equipo.
4. El certificado con `Mail.ReadWrite` sobre el buzón se monta también en la web, que es el contenedor expuesto a Internet.

No hay hallazgos críticos verificados.

## Hallazgos (ordenados por gravedad)

### ALTA

**A1. El acceso a las páginas del panel solo se comprueba en el layout**
- Ficheros: `apps/web/src/app/(panel)/layout.tsx:14`. `page.tsx` (resumen), `discrepancias/page.tsx`, `categorias/page.tsx` y `modelos/page.tsx` no llaman a `requireUser()`; solo lo hace `configuracion/page.tsx:16`.
- Qué falla: en el App Router, los layouts no se vuelven a renderizar al navegar entre páginas que los comparten (renderizado parcial). La documentación de Next.js lo advierte expresamente: no se debe confiar en comprobaciones hechas en el layout (https://nextjs.org/docs/app/guides/authentication, apartado «Layouts and auth checks»).
- Escenario: se quita a un usuario de `AllowedUser` mientras tiene el panel abierto. Al navegar con los enlaces, la petición RSC solo renderiza el segmento de la página, así que sigue viendo métricas, remitentes y asuntos de facturas y la lista maestra del buzón. Esto contradice la decisión de que «quitar a alguien le corta el acceso en su siguiente petición». Además, una petición RSC fabricada a mano (cabeceras `RSC: 1` y `Next-Router-State-Tree` con el segmento `(panel)` ya presente) podría obtener la página sin pasar por el layout aunque no haya sesión. Este último punto está **a confirmar** con una petición real; no la he hecho para no tocar el panel que otro agente está probando en el puerto 3110.
- Las acciones del servidor sí están protegidas: todas llaman a `requireUser()`.
- Arreglo: llamar a `await requireUser()` al principio de cada `page.tsx` del grupo `(panel)`, o dentro de las funciones de datos (`getMetrics`, `getDiscrepancies`, `listMasterCategories`, `getActiveLlm`…). Como `getAccess` usa `cache` de React, la comprobación no se repite dentro de un mismo render. Conviene añadir una prueba que verifique que cada página llama a `requireUser`.

**A2. En producción nadie ejecuta la semilla, y el worker graba decisiones vacías para siempre**
- Ficheros: `packages/db/prisma/seed.ts` (reglas de CIF y razón social, `AllowedUser` inicial y `LlmSetting` por defecto); `apps/worker/src/index.ts:97-99` (solo `migrateDeploy`); `infra/dokploy/README.md` y `provision.ts` (no mencionan la semilla); `apps/worker/src/jobs/process-message.ts:40` (idempotencia por `hasDecision`).
- Escenario: primer despliegue en Dokploy siguiendo el README de infra. `AllowedUser` está vacío, así que nadie entra en el panel y tampoco se puede dar de alta a nadie desde él. `Rule` está vacía, así que no hay reglas de CIF. `LlmSetting` también, así que el LLM devuelve `unavailable`. Cada correo que llega se guarda con `source: none` y `categories: []`. Por la idempotencia, esas decisiones nunca se recalculan, aunque después se ejecute la semilla: dos semanas de modo sombra quedarían inservibles para medir.
- Arreglo: una de dos. (a) Que el worker aplique en el arranque la parte idempotente de la semilla, es decir, las 14 reglas fuertes y el `LlmSetting` por defecto si no hay ninguno activo, y que el administrador inicial venga de una variable `PANEL_ADMIN_EMAIL`. (b) Documentar y automatizar un paso `seed` en `provision.ts` o en el README de Dokploy. Además, que `/health` avise («sin reglas activas» o «sin modelo activo») para que el problema se vea en Uptime Kuma.

**A3. La herencia del hilo hace caso omiso de las correcciones del equipo y propaga los errores**
- Ficheros: `apps/worker/src/classify/repositories.ts:32` y `:48-53`; `apps/worker/src/classify/index.ts` (el hilo tiene prioridad sobre la regla fuerte, con confianza 0,95).
- Qué falla: `findThreadCategories` devuelve como `origin: 'decision'` las categorías de **todas** las decisiones anteriores de la conversación, aunque el equipo las haya corregido después: la corrección deja `seenCategories` sin esa categoría, pero la decisión antigua sigue ahí.
- Escenario: el clasificador propone FOOD BOX para el primer correo de un hilo; el equipo lo corrige y lo deja en LATERAL. La respuesta del proveedor hereda FOOD BOX (por la decisión antigua) y LATERAL (por el equipo), ambas con 0,95, y esa herencia pasa por delante del CIF del PDF de la respuesta. En sombra estropea las métricas; en live aplicaría categorías erróneas a todo el hilo.
- Arreglo: para cada correo del hilo, usar como verdad la última `Correction.final` si existe; si no, `seenCategories` cuando haya etiquetas del equipo; y solo en último caso la decisión más reciente, no todas. Hace falta una prueba con decisión corregida. Hay una cuestión de producto que confirmar con el usuario: si un CIF fuerte en el adjunto del correo nuevo debe ganar a la herencia. Hoy no gana, y en hilos de «facturas del mes» con sociedades distintas eso da etiquetas de más.

**A4. El certificado con `Mail.ReadWrite` del buzón se monta en la web expuesta a Internet**
- Ficheros: `infra/dokploy/provision.ts:199-204` (`GRAPH_CERT_PATH` en web y worker) y `:742` (`reconcileCertMount` también para la web); `docs/guia-entra-id-rbac.md:88-94` (roles `Application Mail.ReadWrite` y `MailboxSettings.ReadWrite` sobre el buzón); `apps/web/src/server/graph-categories.ts`.
- Qué falla: la web solo necesita leer y crear categorías maestras, pero recibe la clave privada de una app que puede leer, modificar, mover y borrar todos los correos del buzón de Proveedores.
- Escenario: una RCE o una lectura arbitraria de ficheros en el contenedor Next.js, que es la superficie expuesta, permitiría sacar `/run/secrets/graph-cert.pem` y manipular las facturas del buzón.
- Arreglo: que la web no tenga el certificado y cree y lea las categorías mediante pg-boss, igual que ya hace con «Probar» (por ejemplo, colas `list-master-categories` y `create-master-category` que atiende el worker). Otra opción es una segunda app de Entra solo con `MailboxSettings.ReadWrite` para la web. Mientras dure el modo sombra, valorar también asignar `Application Mail.Read` en lugar de `Mail.ReadWrite` y ampliarlo al pasar a live.

### MEDIA

**M1. Los fallos transitorios se graban como decisión definitiva (docling caído, LLM caído o sin clave)**
- Ficheros: `apps/worker/src/extract/attachment-text.ts:103-105` (un fallo de docling deja el adjunto como `skipped` sin propagar el error); `classify/index.ts` (LLM `failed`/`unavailable` → duda); `jobs/process-message.ts:40` (no se vuelve a evaluar nunca).
- Escenario: docling se reinicia por OOM (límite de 4 GiB) o tarda más que su tiempo máximo. Las facturas que llegan en ese rato se clasifican sin el texto del PDF y se quedan en duda o mal etiquetadas para siempre; pg-boss no reintenta porque el trabajo «termina bien». Con el LLM pasa lo mismo: «fallo del LLM → duda» es lo pedido, pero no existe ninguna vía para volver a evaluarlas.
- Arreglo: distinguir entre fallo de transporte (conexión rechazada, 5xx, tiempo agotado) y fallo de conversión del fichero. Con el primero, lanzar el error para que pg-boss reintente; con el segundo, degradar como ahora. Para el LLM, guardar un motivo estructurado (`llm_failed`) y ofrecer un script o una cola que vuelva a evaluar en sombra las decisiones con ese motivo.

**M2. `Message` solo se crea al guardar la decisión: el contador de pendientes siempre vale 0, los trabajos fallidos no se ven y se pierden cambios del equipo**
- Ficheros: `apps/worker/src/jobs/decision-store.ts:20` y la transacción; `apps/worker/src/sync/delta.ts:156`; `apps/web/src/server/metrics.ts:428`.
- Primer problema: `getServiceStatus` cuenta `Message` sin decisiones, pero esa fila nunca existe, así que «pendientes» siempre es 0. Un correo cuyo trabajo agota los 5 reintentos (unos 15 minutos con retroceso desde 30 s) no aparece en ningún sitio del panel.
- Segundo problema, una carrera: llega un correo y empieza su trabajo, que con OCR puede durar minutos. Mientras tanto, el equipo le pone FOOD BOX. La delta lo ve como desconocido y lo vuelve a encolar; ese segundo trabajo termina con `already-decided`. Se guardan las categorías leídas al extraer, sin FOOD BOX, y no habrá otra delta hasta el siguiente cambio. Las métricas cuentan entonces un falso positivo o un falso negativo que no existe, justo en la medida que decide el paso a live.
- Arreglo: hacer un upsert de `Message` (id, recepción y `seenCategories`) en `handleItems` al encolar, y que la delta actualice `seenCategories` también para correos aún sin decisión. Así `pending` pasa a ser real, la carrera desaparece y los trabajos fallidos se ven. Revisar a la vez la limitación conocida que se describe en `DECISIONS.md`.

**M3. Tras un 410, las correcciones de los correos anteriores dejan de verse para siempre**
- Fichero: `apps/worker/src/sync/delta.ts:116-118` y `inboxDeltaUrl`.
- Qué falla: el `$filter=receivedDateTime ge <since>` queda fijado dentro del nuevo `deltaLink`, y `since` es la fecha del último correo registrado. Los cambios de categorías en correos recibidos antes de esa fecha ya no aparecerán en ninguna delta.
- Escenario: el token caduca (410) durante una parada larga. Las correcciones que el equipo haga después sobre los correos de las semanas anteriores no se registran, y la precisión de esas semanas queda inflada.
- Arreglo: al resincronizar, usar como `since` la fecha más antigua que se quiera seguir vigilando (por ejemplo, el inicio de la ventana de sombra o el `createdAt` del primer `SyncState`), no el último correo. Los correos ya conocidos solo pasan por `evaluateCategoryChange`, así que esto no reprocesa nada.

**M4. El HEALTHCHECK del worker mide la frescura de la sincronización: Swarm lo reinicia en bucle si Graph o Entra fallan**
- Ficheros: `apps/worker/Dockerfile` (HEALTHCHECK contra `/health`); `infra/dokploy/provision.ts` (`healthCheckSwarm` del worker); `apps/worker/src/health.ts` (503 si `lastSyncAt` tiene más de `SYNC_STALE_SECONDS`).
- Escenario: Graph devuelve 503 o Entra no da token durante más de 5 minutos. El contenedor pasa a «unhealthy», Swarm lo reinicia y se cortan trabajos de docling a medio hacer. Mientras dure la caída se repite el ciclo de arranque, migración y bloqueo. Le pasa lo mismo a una instancia que espera el bloqueo. `DECISIONS.md` solo advierte del caso «sin credenciales».
- Arreglo: separar la comprobación de vida (`/livez`: el proceso responde y la base de datos está accesible) para el HEALTHCHECK de Docker y Swarm, y dejar `/health` (con la frescura) para Uptime Kuma y el panel.

**M5. `release.yml` despliega la web sin esperar a que el worker migre, y solo comprueba la web**
- Fichero: `.github/workflows/release.yml:168-169` y el paso «Esperar a que la web sirva la versión desplegada».
- Escenario: `application.deploy` es asíncrono. La web nueva arranca y consulta columnas o tablas que el worker todavía no ha migrado; el código ya tolera `CategorySetting` y `latencyMs`, pero no tolerará futuras migraciones. Además, si el worker nuevo falla al migrar o entra en bucle, el workflow sale en verde porque solo mira `/api/health` de la web.
- Arreglo: después de desplegar el worker, esperar a que su despliegue en Dokploy termine bien (`deployment.all` o el estado de la aplicación) antes de desplegar la web. Otra opción es que la web exponga en `/api/health` la última migración aplicada y compararla. Y fallar el workflow si el worker no queda sano.

**M6. Datos personales de terceros en ficheros versionados (`plans/reports/`)**
- Ficheros: `apps/worker/scripts/rule-candidates.ts:107-117` y `src/history/candidates.ts:110` (candidatas de tipo `remitente`: direcciones de correo de contactos de proveedores, escritas en `plans/reports/rule-candidates-*.md`); `apps/worker/scripts/extraction-test.ts:126` (nombres de los ficheros de factura reales).
- Qué falla: `plans/` no está en `.gitignore` y, al hacer el primer commit, esos informes subirían al repositorio. Contradice la regla de que los datos del buzón viven solo en `data/history/`.
- Arreglo: escribir esos informes en `HISTORY_DATA_DIR` (ya ignorado) o enmascarar la parte local de los remitentes en el Markdown, y añadir a `.gitignore` un patrón para `plans/reports/rule-candidates-*.md`.

**M7. Los pies de firma internos pueden activar reglas fuertes (a confirmar con el histórico)**
- Fichero: `apps/worker/src/classify/rules.ts:106` (CIF y razón social se buscan en asunto, cuerpo y adjuntos) y la lógica `billedCompanyFound` de `classify/index.ts`.
- Escenario: un empleado de FOOD BOX reenvía una factura de LATERAL IBERIA. Si su firma lleva el pie legal habitual («FOODBOX, S.A. – CIF A87240420…»), el cuerpo da FOOD BOX como señal fuerte y el adjunto da LATERAL: se proponen las dos categorías, y la de FOOD BOX es un falso positivo. La regla que el prompt sí aplica («en los reenvíos internos manda el documento») no está en las reglas. La prueba existente (`rules.test.ts:201`) usa un cuerpo sin firma.
- Arreglo: si algún adjunto tiene un CIF o una razón social del grupo, que solo cuente la evidencia fuerte de los adjuntos; o quitar las firmas y el texto citado antes de buscar. Conviene comprobar en `data/history` cuántos correos internos llevan pie legal.

**M8. La autorización se basa en el claim `email`, que es mutable (a confirmar)**
- Fichero: `apps/web/src/lib/auth.ts:49-52` (`email ?? preferred_username`) y `lib/access.ts`.
- Qué falla: Microsoft documenta que `email` no está verificado y no debe usarse para autorizar. En un tenant único el riesgo es menor, pero depende de cómo se den de alta los invitados (B2B) y de quién puede editar el atributo `mail`.
- Arreglo: guardar y comprobar el `oid` (y el `tid`) del usuario en `AllowedUser`, enlazándolo con el email en el primer acceso. Como mínimo, exigir que el `tid` del token coincida con `MS_TENANT_ID` y rechazar las cuentas invitadas (`#EXT#` en el UPN).

### BAJA

- **B1. `.dockerignore` no excluye `data/`, `.claude/` ni `.agentkit/`.** Ambos Dockerfiles hacen `COPY . .` en la etapa de compilación. Si se construye una imagen en local con `data/history/` presente, los correos de terceros quedan en la caché de compilación. Basta con añadir `data`, `.claude` y `.agentkit` al `.dockerignore`. Además, `.agentkit/` aparece como sin seguimiento en `git status`; habría que ignorarlo.
- **B2. El texto pegado en «Probar» sí se guarda.** El trabajo `test-classify` conserva el correo pegado en `pgboss.job` hasta una hora después de terminar (`apps/worker/src/jobs/queues.ts:47`, `deleteAfterSeconds: 3600`), y podría entrar en la copia diaria de las 03:00. `DECISIONS.md` dice que «el texto pegado no se guarda». O se baja ese valor a unos minutos, o se corrige el documento.
- **B3. Sin cabeceras de seguridad.** No hay `X-Frame-Options` ni `Content-Security-Policy: frame-ancestors 'none'`. Las acciones que se confirman con una casilla (pasar a live, crear una categoría) se podrían inducir con clickjacking. Se arregla con `headers()` en `next.config.ts`.
- **B4. Carreras menores en la configuración.** Si dos administradores se quitan el acceso el uno al otro a la vez, la lista puede quedar vacía (`server/allowed-users.ts`: comprobación de recuento y borrado sin transacción serializable). Dos cambios simultáneos de modelo pueden dejar dos `LlmSetting` activos; esto está mitigado porque el worker toma el más reciente.
- **B5. Se descartan los adjuntos de tipo correo.** `graph/messages.ts:71` solo acepta `fileAttachment`. Un reenvío que adjunta el correo original (`itemAttachment`, `.eml`/`.msg`) pierde el PDF que lleva dentro. Está a confirmar con el histórico cuántos casos hay.
- **B6. Detalles de las métricas.** La precisión por modelo cuenta como decisiones del modelo las que tuvieron un LLM fallido (con `model` informado y sin categorías). Con el filtro de categoría, `doubtful` sigue contando las dudas de todas las categorías, así que la cobertura mezcla universos. `loadMessages` carga sin límite todos los correos del rango con el JSON completo de cada decisión (`?desde=2000-01-01`) y la paginación de discrepancias se hace en memoria; la web tiene un límite de 512 MiB. Convendría limitar el rango (por ejemplo, a 366 días) y no seleccionar `decision` completo cuando no haga falta.
- **B7. `restore-check.sh`.** Una fila con `rolled_back_at` de una migración que se resolvió y se volvió a aplicar hace fallar la comprobación para siempre: habría que contar solo las migraciones sin fila terminada posterior. `minio/mc:latest` no está fijada a una versión. El script en sí no borra nada ajeno: solo su contenedor (de nombre único) y su `mktemp -d`, y rechaza un `DOCKER_HOST` remoto.
- **B8. `graph-categories.ts`.** No lleva `import 'server-only'`; hoy solo lo importa código de servidor, pero el marcador evitaría una importación accidental en el cliente. También duplica el cliente de Graph del worker; si se aplica A4, desaparece.

## Lo que está bien (verificado)

- **Bypass de desarrollo.** `isDevBypassActive` exige `AUTH_DEV_BYPASS=true` y `NODE_ENV=development`. El `server.js` del modo standalone fuerza `NODE_ENV=production`, y la imagen lo fija.
- **Acciones del servidor.** Todas llaman a `requireUser()` antes de hacer nada y validan los datos con Zod. Pasar a live exige una casilla de confirmación que también se valida en el servidor. Next 15 comprueba el `Origin` de las acciones, lo que cubre el CSRF.
- **SQL.** Solo se usan `$queryRaw`/`$executeRaw` como plantillas parametrizadas; no hay `Unsafe`.
- **Secretos.** `.env`, `secrets/`, `*.pem` y `data/history/` están en `.gitignore`, y `git check-ignore` lo confirma. `.env.example` no contiene secretos. `provision.ts` nunca imprime valores secretos. Las claves de LLM solo están en el entorno del worker. Los puertos de desarrollo escuchan solo en 127.0.0.1.
- **Worker sin escrituras en el buzón.** No hace ningún PATCH ni POST a Graph; con `MODE=live` se niega a arrancar; `CategorySetting` solo se registra como aviso.
- **pg-boss.** `singletonKey` más la comprobación de decisión existente, el conjunto `inFlight` y la transacción entre `Message` y `Decision` hacen idempotente el procesado dentro de una sola instancia. Un 404 cierra el trabajo.
- **Delta.** La primera ronda solo pide el último minuto; el `deltaLink` se guarda al final; un segundo 410 seguido se propaga; las rondas no se solapan; se respeta `Retry-After` con un tope.
- **Instancia única.** Bloqueo asesor en una conexión dedicada; si se pierde, el proceso sale.
- **Clasificador.** Solo cuentan los CIF de las siete sociedades, normalizados y aceptando el prefijo ES y separadores. Las categorías que no están en la lista maestra no se proponen. Las categorías puestas por el equipo no se mandan al LLM y nunca se quitan. Un fallo del LLM nunca lanza. La respuesta del LLM se filtra a las categorías pedidas.
- **Caché de adjuntos y retención.** La clave de la caché incluye el número de páginas; los resultados vacíos no se cachean; la limpieza de 90 días está programada con zona horaria de Madrid.
- **CI/CD.** `release.yml` fija las acciones por SHA, despliega la etiqueta exacta solo en tags `v*.*.*` o a mano, valida la etiqueta con una expresión regular y pasa los secretos por `env`, no interpolados en el script.
- **`provision.ts`.** Tiene un modo de simulación por defecto, conserva las variables que no gestiona, no cambia la imagen de una aplicación existente y deja PostgreSQL sin puerto publicado.

## Métricas

- Lint: 0 avisos. Typecheck: 5 paquetes correctos.
- Tests: 335 superadas y 3 saltadas (integración, requieren `RUN_INTEGRATION=1`). No he ejecutado la integración para no levantar servicios.
- Cobertura: no medida.

## Acciones recomendadas (por orden)

1. A1: `requireUser()` en cada página del panel.
2. A2: semilla automática e idempotente en el arranque del worker, o como paso de despliegue, más un aviso en `/health`.
3. A3: que la herencia del hilo use las correcciones y la última decisión.
4. A4: sacar el certificado del buzón del contenedor web.
5. M2 y M1: crear `Message` al encolar y reintentar los fallos transitorios de docling. Sin esto, las métricas de sombra no sirven como criterio de activación.
6. M4 y M5: separar la comprobación de vida de la de salud y endurecer la espera del despliegue.
7. M3, M6, M7 y M8, y después las de gravedad baja.

## Preguntas abiertas

- A3: ¿un CIF fuerte en el adjunto de una respuesta debe ganar a la herencia del hilo?
- A4: ¿se acepta mover la gestión de categorías al worker mediante pg-boss, o se prefiere una segunda app de Entra para la web?
- M8: ¿hay usuarios invitados (B2B) en el tenant que puedan entrar con la app de login?
