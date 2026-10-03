# Ajustes compartidos (2026-10-02)

1. `decisionSourceSchema` admite `none` (ruleId y model deben ser null). `classify` lo usa cuando no hay propuestas, LLM ni regla excluyente; ya no existe `NO_MATCH_RULE_ID`. `Decision.source` no es enum en Prisma (vive en el JSON), así que no hay migración ni pg_dump. Desviación: no se fuerza `needsReview=true` en el esquema, porque rompía el caso "el equipo ya etiquetó todo" (needsReview=false). En los demás casos `none` sale con needsReview=true.
2. `SOCIEDADES` en packages/shared/src/sociedades.ts; seed, seed.ts, prompt, fixtures, tests y evaluate.ts la importan de `@clasificador/shared`. Borrados classify/sociedades.ts y el test de igualdad. packages/db ya dependía de shared.
3. Quitadas `@microsoft/microsoft-graph-client` y `-types` (sin imports).
4. Clave de caché `sha256:p<maxPages>` (`attachmentCacheKey`); test nuevo de límite distinto.
5. tsconfig del worker incluye `scripts/**/*.ts`; typecheck limpio sin correcciones.
6. docs/DECISIONS.md: líneas de `none` y de la clave de caché.

Verificación: lint, typecheck, test (141 worker) y build en verde. Evaluador antes/después idéntico salvo `fuente=rule` -> `fuente=none` en s05, s06 y s08 (métricas iguales). Sin `sin-coincidencias` en .ts.
