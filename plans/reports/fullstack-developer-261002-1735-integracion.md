# Integración: esquema, worker, duplicados, botón Probar, provision, docs e imágenes

Fecha: 2026-10-02. Todo en local; nada contra Dokploy, Microsoft 365, GitHub ni LLM reales; sin commits.

## Resultado

| Comprobación | Resultado |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `prettier --check .` | OK |
| `pnpm test` | OK: web 89, worker 231 (+3 de integración omitidas), shared 13, db 2, infra/dokploy 24 |
| `pnpm build` | OK |
| `RUN_INTEGRATION=1 pnpm --filter @clasificador/worker test` (postgres 5442 + docling 5101) | OK: 234 tests, 3 de integración incluidos (uno nuevo) |
| Imágenes arm64 `clasificador-web:local` (443 MB) y `clasificador-worker:local` (2,09 GB) | Construidas; contenedores de prueba borrados, imágenes etiquetadas |

## 1. Esquema

- Copia de seguridad antes de migrar: `/tmp/claude-1001/-home-ubuntu-proyectos-outlook-org/b3728341-f9ce-4e9d-84ca-88e1f631a864/scratchpad/backup-antes-integracion.sql` (`pg_dump` de la BD local, 537 líneas).
- `DecisionMode` ya era un enum de Prisma: `CategorySetting` y `Decision.latencyMs` van exactamente como en el informe del panel.
- Migración `20261002155655_modo_por_categoria_y_latencia`, aplicada en local.
- Comprobado con el panel en dev: `/configuracion` muestra ya los interruptores habilitados (con un aviso nuevo de que live aún no aplica nada); con dos decisiones de prueba de 1500 y 500 ms, la tabla de modelos de `/` muestra 1 s de latencia media. `getCategoryModes`/`setCategoryMode` probados contra la tabla real (sombra → live → sombra). Datos de prueba borrados.

## 2. Worker

- `llm.ts`: mide `latencyMs` de la llamada (en `ok`, y en `failed` si hubo llamada; null si el proveedor no estaba disponible). `ClassifyResult.latencyMs` lo recoge y `decision-store.ts` lo guarda en `Decision.latencyMs`.
- `classify/category-settings.ts`: `readCategoryModes` (solo lectura, sin fila = sombra) y un aviso que se repite solo cuando cambia el conjunto de categorías en live. `/health` incluye `categoryModes` (un fallo al leerlo no cambia el estado). El worker sigue sin PATCH y se sigue negando a `MODE=live`; con una categoría en live registra el aviso y sigue en sombra.

## 3. Duplicados a `@clasificador/shared`

- `LLM_PROVIDER_IDS`, `isLlmProviderId` y `llmSelectionSchema` (`llm-providers.ts`); `canonicalCategory` (`categories.ts`, con su test, que salió de `thread.test.ts`).
- `defaultRules()` única en `apps/worker/src/classify/default-rules.ts`; la usan `history/discrepancies.ts` y `scripts/evaluate.ts`. Se quitó `strongRules()`.
- La web conserva solo lo propio (etiquetas, ejemplos, avisos de privacidad). Sin cambios de comportamiento.

## 4. Botón «Probar»

- Contrato en `packages/shared/src/test-classify.ts`: cola `test-classify`, esquema de petición y de resultado, correo sintético (CIF de una sociedad de la tabla), límites de asunto (300) y texto (20.000), tiempo máximo de 60 s.
- Worker (`jobs/test-classify.ts`, `queues.ts`): crea la cola (sin reintentos, caduca a los 120 s) y la atiende aunque no haya credenciales de Graph. Clasifica con ESE proveedor/modelo sin tocar `LlmSetting`, y el correo va directo al LLM sin reglas ni hilo (con reglas, un correo con CIF de la tabla nunca llegaría al modelo). Devuelve `ok` / `unavailable` / `failed`, decisión, tokens, coste y latencia.
- Panel: `server/test-classify.ts` (encola, sondea cada segundo hasta 60 s, cancela el trabajo si se agota el tiempo, valida el resultado y nunca lanza), `server/boss.ts` (cliente de pg-boss sin migrar ni supervisar), acción `testModelAction` (tras `requireUser`) y el botón en `/modelos` con asunto y texto opcionales y vista del resultado. Dependencia nueva `pg-boss` en la web.
- Verificado de extremo a extremo con el worker real en marcha y el código del panel (cliente pg-boss + `runTestClassify`): anthropic, openrouter y openai-compatible sin clave devuelven `unavailable` con el nombre de la variable que falta (1-2 s); un proveedor desconocido se rechaza; con el worker parado, a los 60,2 s "El worker no respondió en 60 s" y el trabajo se cancela. Tests: modelo simulado del AI SDK (ok, sin clave, respuesta ilegible, petición inválida), doble de cola (completado, sondeo, fallo, timeout con cancelación, error al encolar, resultado raro), `buildTestRequest` y un test de integración con pg-boss real.

## 5. `provision.ts`

`buildEnv` ya cubría casi todo. Faltaban `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_MAX_PAGES` y `DOCLING_TIMEOUT_SECONDS` del worker: añadidas como pasantes opcionales (con los valores por defecto del worker si no están). Nuevo test que recorre el código de la web y del worker, toma las variables de `.env.example` que aparecen y exige que `buildEnv` las escriba (excepciones explícitas: `APP_VERSION`, `AUTH_DEV_BYPASS`, `POSTGRES_*` y puertos de compose; las claves de LLM que la web solo nombra en textos de ayuda). `infra/dokploy/README.md` actualizado.

## 6. Documentación

`docs/guia-entra-id-rbac.md` (parte C y lista final: sin `User.Read`; redirect local `http://localhost:3110/api/auth/callback/microsoft`), `README.md` (estructura, `/health` real con 503 `stale`/`disabled`, cómo arrancar el servicio en sombra en local, cómo funciona Probar), `docs/DECISIONS.md` (sesión sin estado, `AllowedUser` en cada petición, `CategorySetting`, `latencyMs`, Probar vía pg-boss, advertencias de despliegue: worker no sin credenciales de Graph y actualización stop-first; además se corrigió el puerto 3100 → 3110). Plan: `phase-07-panel.md`, marcados el selector/Probar y los interruptores.

## 7. Docker

`docker build --platform linux/arm64` de ambos Dockerfiles OK. Contenedores en la red de compose contra la BD local:
- web: `healthy`, `/api/health` → 200 `{"status":"ok","version":"local"}`.
- worker (sin credenciales de Graph): `/health` → 503 `status: "disabled"` con el motivo y `categoryModes`; el HEALTHCHECK devuelve error, como debe. Migraciones sin pendientes.
Contenedores borrados; esquema `pgboss` de la BD de desarrollo eliminado al terminar (el worker lo recrea). La BD queda con 0 mensajes, 0 decisiones y 0 `CategorySetting`.

## Procesos

Arranqué el worker (`pnpm start`, puerto 8180, node PID 3660500) y el panel (`pnpm dev` con `AUTH_DEV_BYPASS`, 3110, next-server PID 3660525); ambos parados (3110 y 8180 libres). No toqué los contenedores postgres/docling ni procesos ajenos.

## Qué no se pudo comprobar

- **Transporte de la acción de servidor «Probar» desde un formulario real**: no hay navegador (sin `agent-browser`). Intenté llamar a la acción con curl/fetch replicando el protocolo de Next, pero el `FormData` llegaba vacío (mismo comportamiento con la acción existente de cambiar modelo), así que no lo di por válido; lo verifiqué en cambio con el mismo código del panel (cliente de cola, sondeo, validación y `buildTestRequest`) contra el worker real, y las páginas `/`, `/discrepancias`, `/modelos`, `/categorias`, `/configuracion` y `/api/health` dan 200 con el bypass y `/modelos` renderiza el botón y el correo de ejemplo. Conviene una pasada manual en el navegador.
- El flujo con un modelo real (tokens, coste, latencia reales) y las pruebas contra Graph/Entra siguen pendientes por falta de claves y credenciales.

## Notas

- La imagen del worker pesa 2,09 GB (dependencias de producción con el AI SDK, Prisma y tsx); no la he optimizado.
- Las imágenes se construyeron antes de quitar dos imports sin usar que señaló ESLint (sin cambio de comportamiento).
- Para el modo live real (fase 8) el panel ya guarda el interruptor y el worker lo lee; falta la aplicación de categorías en Outlook y quitar la negativa a `MODE=live`.

Status: DONE_WITH_CONCERNS
Summary: Esquema migrado (con copia previa), latencia guardada y modos expuestos en el worker, duplicados movidos a shared, botón Probar por pg-boss, `buildEnv` verificado con test, documentación al día e imágenes arm64 construidas y comprobadas; lint, typecheck, test, build e integración en verde.
Concerns/Blockers: La acción «Probar» no se ha podido ejercitar desde un formulario en un navegador real (se probó el mismo código contra el worker real); el worker sigue sin activar live y las pruebas con claves/Graph reales siguen pendientes.
