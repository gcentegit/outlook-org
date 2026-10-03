# Fase 4: código del análisis del histórico y reglas iniciales

Fecha: 2026-10-02. Estado: el código está terminado y probado con un buzón simulado. Falta ejecutarlo contra el buzón real (certificado aplazado).

## Qué se ha hecho

Código nuevo en `apps/worker/src/history/` (todo con pruebas) y dos scripts finos:

| Fichero | Función |
| --- | --- |
| `src/history/graph-import.ts` | Lista carpetas y subcarpetas y las importa con `$filter=receivedDateTime ge`, páginas de 100, solo metadatos y categorías. Guarda el último `nextLink` por carpeta. |
| `src/history/sampling.ts` | Muestra estratificada (FOOD BOX, LATERAL, ARCOBETA, varias, ninguna), reproducible (semilla fija), y separación por fecha. |
| `src/history/extract-sample.ts` | Llama a `extractEmail` (docling) para la muestra y escribe el JSONL en el formato de `evaluate.ts`. Reanudable. |
| `src/history/candidates.ts`, `keywords.ts` | Candidatas de reglas (remitente, dominio, n-gramas del asunto), tabla Markdown y carga `createMany` inactivas. |
| `src/history/discrepancies.ts` | Reglas fuertes (CIF y razón social) frente a las etiquetas del equipo. |
| `src/history/run.ts` | Orquestación: importar, separar, muestrear, extraer, partir en desarrollo y prueba, discrepancias. |
| `src/history/config.ts`, `types.ts`, `store.ts` | Configuración con Zod (variables extra, sin tocar `config.ts`), tipos y ficheros JSONL. |
| `src/history/fake-mailbox.ts` | Buzón simulado que responde como Graph; se usa con el `GraphClient` real. |
| `scripts/import-history.ts`, `scripts/rule-candidates.ts` | Puntos de entrada. |

Edición mínima en `.gitignore`: `data/history/` (correos de terceros, nunca se sube).

### Decisiones

- **Datos en ficheros**, sin cambiar `schema.prisma`: `data/history/` en la raíz del repo (configurable con `HISTORY_DATA_DIR`): `messages.jsonl`, `progress/<carpeta>.json`, `import-state.json`, `split.json`, `sample.json`, `eval-cases.jsonl`, `eval-dev.jsonl`, `eval-test.jsonl`, `discrepancias.md`, `rule-candidates.json`.
- **Corte de fecha fijo.** La primera ejecución guarda el corte (hoy menos N meses); reanudar al día siguiente no lo cambia. `--restart` borra todo y empieza de nuevo.
- **Separación 70/30 por fecha sobre todo el histórico importado**: el corte se calcula con todos los correos. Las candidatas usan el 70 % antiguo completo (decenas de miles de correos); la muestra de evaluación se parte con el mismo corte. Todo lo que cae en la fecha de corte o después es prueba.
- **`email.categories` va vacío en el JSONL de evaluación** y las etiquetas del equipo van en `expected`. Motivo: `classify` no pregunta al LLM por las categorías que el correo ya trae puestas, así que dejarlas inflaría el resultado. `evaluate.ts` ignora las claves que sobran (`stratum`).
- **Pureza**: los correos sin ninguna categoría cuentan en el denominador (una señal que aparece en muchos correos sin etiquetar no es fiable); un correo con varias categorías cuenta como acierto de cada una. Pureza y mínimo salen de `RULE_MIN_PURITY` (0,98) y `RULE_MIN_OCCURRENCES` (5), o de `--min-purity` y `--min-occurrences`.
- **Dominios genéricos** (correo público e internos: gmail, hotmail, outlook, arcofood.com, foodbox.es…, ampliable con `RULE_GENERIC_DOMAINS`): no tienen trato de favor, solo se proponen si cumplen el umbral, y salen marcados "dominio genérico: revisar con cuidado". Es mi interpretación de "excluye… si no cumplen el umbral"; si se quiere que nunca se propongan, es una línea.
- **Redundancias**: no se propone el remitente si su dominio ya cumple para la misma categoría, ni un n-grama con las mismas apariciones que uno de sus extremos más corto. Los n-gramas no empiezan ni acaban en stopword, para que sigan siendo una secuencia contigua del texto (así los busca `evaluateRules`). Valores en minúsculas sin acentos.
- **Estrato vacío** (ARCOBETA = 0): no aporta correos y su cuota se reparte entre los demás; el script avisa.
- **Discrepancias**: se escriben en `data/history/discrepancias.md` (no en `plans/`), porque llevan asuntos y remitentes de terceros.
- `strongRules()` duplica `defaultRules()` de `scripts/evaluate.ts` (no es mío y no es importable sin ejecutar su `main`). Conviene que alguien lo mueva a `classify` más adelante.

## Cómo se ejecutará con el buzón real

Requisitos: certificado y app de Entra listos; en `.env` `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PATH`, `MAILBOX`; docling en `DOCLING_URL`. Desde `apps/worker`:

1. Importación y muestra (puede tardar horas con 20.000-80.000 correos; si se corta, se lanza igual y continúa):
   `pnpm exec tsx --env-file-if-exists=../../.env scripts/import-history.ts`
   Opciones: `--months 6`, `--sample-size 1500`, `--skip-import`, `--skip-extract`, `--resample`, `--restart`. Con `HISTORY_SKIP_FOLDERS=elementos enviados,borradores` se excluyen carpetas que no son entrada (por defecto se recorren todas, como se pidió).
2. Mirar el resumen final: correos importados, estratos (ARCOBETA saldrá 0 salvo que ya haya etiquetados), extracción (fallidos = correos movidos o borrados durante el proceso; relanzar los reintenta) y número de discrepancias.
3. Revisar con el usuario `data/history/discrepancias.md` antes de contarlas como error.
4. Evaluar con reglas solo de CIF y razón social: `scripts/evaluate.ts data/history/eval-dev.jsonl` y `eval-test.jsonl` (la prueba solo se mira al final).
5. Candidatas: `scripts/rule-candidates.ts` genera `plans/reports/rule-candidates-AAMMDD-HHMM.md` (tabla para revisar con el usuario) y `data/history/rule-candidates.json`. Borrar del JSON las rechazadas (o regenerar con otro umbral) y cargar con `scripts/rule-candidates.ts --apply` (necesita `DATABASE_URL`): entran **inactivas** y no pisan las existentes. El usuario las activa.
6. Reglas CIF y razón social: la semilla de las 7 sociedades ya está en la BD local (14 reglas activas); no es parte de este código.

## Resultados sintéticos

Buzón simulado de 200 correos en 3 carpetas (Bandeja, Archivo, Archivo/347), páginas de 25, 5 ficheros de `facturas-prueba` en 9 correos (docling local, 127.0.0.1:5101). Script en `scratchpad/historico-sintetico/e2e.mts`; datos en `scratchpad/historico-sintetico/data/`.

- Importados 200 (107 + 53 + 40). Corte 2026-08-18: 140 desarrollo, 60 prueba. Estratos: FOOD BOX 33, LATERAL 48, ARCOBETA 0, varias 8, ninguna 111. Extracción 200/200, sin fallos, 1 min (docling solo convierte los 5 PDF distintos; el resto sale de la caché en memoria por hash).
- Discrepancias: 4 (3 facturas de ARCO BETA y el caso "Lateral Arturo Soria", sin etiqueta del equipo), todas las sembradas a propósito.
- `evaluate.ts` sobre `eval-dev.jsonl` y `eval-test.jsonl`, solo reglas: lee ambos sin errores. Cobertura baja (la mayoría de los correos sintéticos no lleva CIF) y los falsos positivos son exactamente las discrepancias. Es solo una comprobación del flujo, no una medida de calidad.
- Candidatas: 11 (6 FOOD BOX, 5 LATERAL, 0 ARCOBETA). Ejemplo de efecto del histórico incompleto: "lateral" no se propone porque en el correo "Lateral Arturo Soria" sin etiqueta baja la pureza al 96 %.
- `--apply` contra la BD local de pruebas: copia previa en `scratchpad/backup-antes-rule-candidates.sql`; 11 nuevas inactivas, segunda ejecución 0 nuevas / 11 existentes, y después borradas (la BD vuelve a 14 reglas activas, como estaba). La tabla de candidatas sintéticas está en `scratchpad/historico-sintetico/rule-candidates-sintetico.md` (no se dejó en `plans/reports/`).

## Verificación

- `npx eslint .` limpio; `tsc -p apps/worker` limpio.
- `vitest` en `apps/worker`: 165 de 166 pasan. Fallo ajeno: `src/health.test.ts` (el cuerpo de `/health` incluye ahora `version` y la prueba espera el formato anterior), del agente que trabaja en `health.ts`. Las 25 pruebas de `src/history` pasan.
- No he ejecutado `pnpm test` en la raíz entero (incluye `apps/web`, de otro agente).

## Pendientes

- Probar `import-history.ts` contra el buzón real; hasta entonces no hay medida de tiempo ni de límites de Graph reales (el reintento con `Retry-After` es el del cliente de la fase 3, ya probado).
- Revisar con el usuario las discrepancias y las candidatas; decidir cómo evaluar ARCOBETA (muestra manual o modo sombra).
- Marcar los puntos de la fase 4 en el plan cuando haya datos reales: solo está hecho el código.
- Posible desajuste a vigilar: los ids de mensaje de Graph cambian si el equipo mueve el correo entre la importación y la extracción; esos casos se registran como fallidos y se recuperan relanzando (vuelven a leerse desde la carpeta nueva solo con `--restart`, así que conviene extraer pronto tras importar).

Status: DONE_WITH_CONCERNS
Summary: Código, pruebas (25 nuevas) y ejecución sintética extremo a extremo con docling listos; falta la ejecución real con el buzón.
Concerns/Blockers: `src/health.test.ts` falla por trabajo en curso del otro agente (no es mío); ejecución real pendiente del certificado.
