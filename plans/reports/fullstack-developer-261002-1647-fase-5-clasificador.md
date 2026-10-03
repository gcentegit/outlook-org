# Fase 5: clasificador (reglas + LLM configurable)

Fecha: 2026-10-02. Estado: hecho. `pnpm lint`, `pnpm typecheck` y `pnpm test` pasan (worker: 141 tests, 70 de ellos del clasificador).

## Diseño

Código en `apps/worker/src/classify/`:

| Fichero | Contenido |
| --- | --- |
| `index.ts` | `classify(email, ctx) → { decision, usage, llmCalled }` y el combinador |
| `rules.ts` | motor de reglas (`evaluateRules`), `RuleRepository` inyectable |
| `thread.ts` | `ThreadRepository` inyectable y herencia por `conversationId` |
| `llm.ts` | `createLlmClassifier`: lee `LlmSetting` en cada llamada, `generateText` + `Output.object`, validación Zod, nunca lanza |
| `providers.ts` | fábrica anthropic / openrouter / openai-compatible / google; claves solo de entorno; coste estimado |
| `prompt.ts` | prompt con las sociedades y CIF por categoría; truncado; primera página de cada adjunto |
| `repositories.ts` | implementaciones Prisma de reglas, hilo y `LlmSetting` (probadas contra la BD local: 14 reglas, modelo activo, consulta de hilo) |
| `evaluation.ts` | métricas y formato del informe (en `src` para que se tipe y pruebe) |
| `sociedades.ts` | las 7 sociedades (prompt y reglas por defecto del evaluador); un test la compara con `packages/db/prisma/seed-data.ts` |

Contrato: `classify(email, { availableCategories, mode, rules, threads, llm?, confidenceThreshold? })`. `decision` valida `decisionSchema`; `usage` lleva `inputTokens`, `outputTokens` y `costUsd` (coste: el que informa OpenRouter, o tarifa conocida de Haiku 4.5, o `null`).

Decisión por categoría (se evalúan las tres por separado):

1. Hilo: otro correo de la misma conversación con la categoría (etiqueta del equipo en `Message.seenCategories` o una `Decision` previa) → sí, confianza 0,95.
2. Regla fuerte (`Rule.weight = fuerte`): CIF o razón social → sí, confianza 1. CIF en asunto, cuerpo y Markdown de adjuntos, con y sin `ES`, con guiones, puntos o espacios. Razón social sin acentos ni mayúsculas, tolerante a `S.L.`/`SL`/`S.A.`/`SA`/`SLU`, comas y espacios; si el valor de la regla lleva forma societaria, el texto también debe llevarla (así `foodbox.es` en una firma no cuenta).
3. Si hay alguna regla fuerte en el correo y no es de esta categoría → no (hay una sociedad identificada de otra categoría, no se mira más).
4. Regla media (palabra clave en asunto y cuerpo, remitente, dominio y subdominios) → sí, confianza 0,9.
5. Nada → duda. Cualquier sí por debajo del umbral pasa a duda.
6. Si alguna categoría disponible, no puesta por el equipo, queda en duda y hay LLM, se llama una vez con solo esas categorías. El LLM responde `{category, applies, confidence, reason}` por categoría; por debajo del umbral → duda. Esquema inválido, error, timeout (30 s) o cuota → duda, con el motivo en `reason` y los tokens que se hayan consumido.

Salida:

- `needsReview = true` si queda alguna categoría en duda (disponible y no puesta por el equipo).
- `categories` solo incluye las que existen en `availableCategories` (comparación sin distinguir mayúsculas, se devuelve el nombre canónico). Una categoría decidida pero inexistente se anota en `reason` y no se devuelve.
- Las categorías que ya trae el correo del equipo no se piden al LLM, no fuerzan revisión y no se quitan nunca (el clasificador solo propone).
- `source`: la de mayor prioridad entre las categorías propuestas (thread > rule > llm). `model` se informa siempre que se llamó al LLM, aunque `source` sea `rule`. `confidence` es el mínimo de las categorías evaluadas (una duda sin respuesta de LLM vale 0).
- Errores de BD (reglas o hilo) se propagan: el trabajo se reintenta en lugar de decidir con datos incompletos. Los del LLM nunca lanzan.
- Sin ninguna señal ni LLM, `source = 'rule'` con `ruleId = 'sin-coincidencias'` (el esquema obliga a un `ruleId` con esa fuente; ver propuestas).

API del AI SDK 7 verificada: `generateText` con `output: Output.object({ schema })`, `result.output` (getter que lanza), `NoObjectGeneratedError`, `result.usage.inputTokens/outputTokens`, `MockLanguageModelV4` de `ai/test`. Context7 no estaba disponible y el acceso a `node_modules` está bloqueado por un hook, así que lo contrasté con la documentación de ai-sdk.dev y con una prueba ejecutada. El esquema enviado al modelo no lleva `min`/`max` (algunos proveedores los rechazan); los límites se validan después con un segundo esquema Zod.

Config: añadidas a `apps/worker/src/config.ts` y `.env.example` `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` y `CLASSIFY_CONFIDENCE_THRESHOLD` (0,8). Ediciones puntuales, sin tocar las del otro agente.

## evaluate.ts

```
cd apps/worker
pnpm exec tsx --env-file-if-exists=../../.env scripts/evaluate.ts <casos.jsonl> \
  [--llm proveedor:modelo]... [--rules reglas.json | --db] [--threshold 0.8] [--max-chars 12000] [--details]
```

Siempre ejecuta la pasada sin LLM y una más por cada `--llm` (se pueden repetir para comparar modelos; el modelo puede llevar `:`, p. ej. `openrouter:meta-llama/llama-3.3-70b-instruct:free`). Imprime por categoría precisión, cobertura y matriz (TP/FP/FN/TN), % de correos que pasan por el LLM, % en revisión, tokens y coste. El hilo se simula con los casos anteriores de la misma conversación. Reglas por defecto: CIF y razón social de las siete sociedades; `--db` usa las activas de la tabla `Rule` (probado). El conjunto real saldrá de la fase 4; el sintético solo valida el evaluador.

JSONL sintético (14 casos): `/tmp/claude-1001/-home-ubuntu-proyectos-outlook-org/b3728341-f9ce-4e9d-84ca-88e1f631a864/scratchpad/eval-sintetico.jsonl`, generado por `gen-eval.mjs` en el mismo directorio. Cubre CIF claros (con `ES`, con puntos, con espacios, en minúsculas), razón social con variantes, dos sociedades a la vez, CIF del proveedor sin señal, sin señales, firma con "foodbox.es", reenvío interno y respuesta en hilo.

## Resultado sobre el JSONL sintético (sin LLM, no hay claves)

14 casos, 0 % por el LLM, 4 en revisión (los 3 sin señal y la respuesta de hilo, cuyas otras dos categorías quedan en duda), coste 0.

| Categoría | Precisión | Cobertura | TP | FP | FN | TN |
| --- | --- | --- | --- | --- | --- | --- |
| FOOD BOX | 100 % | 100 % | 3 | 0 | 0 | 11 |
| LATERAL | 100 % | 100 % | 7 | 0 | 0 | 7 |
| ARCOBETA | 100 % | 100 % | 2 | 0 | 0 | 12 |

Es un conjunto hecho a medida: no demuestra la precisión real. Con `--llm` y sin clave, el proveedor queda "no disponible" y no se llama (resultado idéntico a solo reglas). Lo mismo con `--db`.

## Verificación

- `pnpm lint`, `pnpm typecheck`, `pnpm test`: OK. `scripts/evaluate.ts` queda fuera del `tsconfig` del worker (solo incluye `src`); lo tipé aparte con un tsconfig temporal y compila limpio.
- Tests (con `MockLanguageModelV4`): reglas (CIF con/sin `ES`, separadores, límites, razón social, multietiqueta, CIF del proveedor, dirección común, firma "foodbox.es", remitente, dominio, palabras clave, reenvío interno), hilo, combinador (fuerte/media/hilo/LLM, umbral, categoría inexistente, categorías del equipo, errores de BD), LLM (respuesta válida, no JSON, categoría inventada, confianza fuera de rango, error/cuota, timeout, sin modelo activo, sin clave), prompt/truncado, proveedores, coste, evaluador y repositorios Prisma (doble).
- Sin llamadas reales a LLM, Graph ni Dokploy. BD local usada solo en lectura para el humo de repositorios y `--db`.

## Propuestas de cambio en `packages/shared` (no aplicadas)

1. `decisionSourceSchema`: añadir `'none'` (o relajar `ruleId`): hoy una decisión sin ninguna señal ni LLM necesita un `ruleId` inventado (`'sin-coincidencias'`). El panel debe tratarlo como "sin regla".
2. Mover `SOCIEDADES` a `@clasificador/shared`: existe en `packages/db/prisma/seed-data.ts` y en `classify/sociedades.ts` (un test las mantiene iguales).

## Pendientes y decisiones para la fase 6/7/8

- Fase 6 debe construir `createLlmClassifier({ settings: createPrismaLlmSettingRepository(db), keys: config, maxChars })` y pasar `confidenceThreshold: config.CLASSIFY_CONFIDENCE_THRESHOLD`; guardar `usage` en `Decision.inputTokens/outputTokens/costUsd` y `decision.model`.
- El máximo de caracteres al LLM es opción de `createLlmClassifier` (por defecto 12.000, sin contar etiquetas del prompt); no creé variable de entorno por la restricción de config. Si se quiere desde entorno, añadir `CLASSIFY_LLM_MAX_CHARS`.
- El panel (fase 7) debe usar los ids de proveedor `anthropic`, `openrouter`, `openai-compatible`, `google` (`LLM_PROVIDERS` en `providers.ts`) y avisar de RGPD según proveedor.
- "Primera página" de un adjunto: se corta en el primer `\f` o `<!-- page break -->`; si docling no los emite, se envía todo el Markdown (ya limitado a 2 páginas de PDF por la extracción, `ATTACHMENT_MAX_PAGES`).
- Tarifa de coste conocida solo para Haiku 4.5 (1 / 5 USD por millón); OpenRouter informa su propio coste; el resto, `null`.
- Una regla media que da un sí deja las otras categorías en duda y por tanto llama al LLM; si el coste importa, ajustar con los datos de la fase 4.
- Con el hilo resolviendo una categoría, las otras dos siguen yendo al LLM (es multietiqueta por categoría, como pide el contrato).
- Objetivo de precisión ≥ 95 % y comparativa de dos modelos: pendientes de las claves y del conjunto real (fase 4).

Status: DONE_WITH_CONCERNS
Summary: Clasificador completo (hilo, reglas, LLM configurable con AI SDK 7, evaluador) con lint, typecheck y tests en verde; el evaluador sobre el JSONL sintético da 100 % sin LLM.
Concerns/Blockers: no hay evaluación real ni con LLM (sin claves ni histórico); proponemos dos cambios en packages/shared (fuente `none` y mover SOCIEDADES).
