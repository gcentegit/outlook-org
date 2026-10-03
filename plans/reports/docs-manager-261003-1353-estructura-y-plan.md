# Documentación por temas, ADR y plan revisado

Registro de estado del trabajo de la rama `docs/estructura-y-plan`. No es documentación vigente.

## Árbol final

```
README.md  CLAUDE.md  AGENTS.md
docs/
├── README.md                    índice
├── arquitectura.md              cómo funciona hoy (con diagrama Mermaid)
├── adr/                         README.md + 22 registros por tema (0001 a 0022)
├── guias/entra-id-rbac.md       (movido)
├── operacion/                   despliegue, copias-y-restauracion, credenciales-y-caducidades
└── referencia/sociedades-categorias.md   (movido)
plans/261001-2123-clasificador-foodbox-lateral/   plan.md + fases 1 a 12
plans/reports/                   sin cambios salvo los tres informes de abajo
```

`docs/operacion/versiones-y-releases.md` lo escribe el otro PR; aquí solo se enlaza (7 enlaces, comprobados aparte).

## Qué se movió o desapareció

- `docs/DECISIONS.md` se divide en los ADR por tema y se elimina. Cada sección y advertencia de despliegue tiene destino: alcance (0001), orden de decisión con el CIF por delante del hilo (0002), LLM (0003), sombra y activación (0004), delta e instancia única (0005), pg-boss (0006), fallos técnicos y reproceso (0007), correcciones y métrica (0008), modelo de datos (0009), retención y datos de terceros (0010), candidatas (0011), adjuntos y límite `.eml`/`.msg` (0012), acceso con certificado y RBAC (0013), panel (0014), web sin credenciales (0015), Prisma y monorepo (0016), imágenes y salud (0017), Dokploy con las advertencias `stop-first` y `/livez` (0018), publicación y vuelta atrás (0019), copias (0020), semilla (0021), repositorio público (0022).
- `docs/guia-entra-id-rbac.md` pasa a `docs/guias/entra-id-rbac.md`; `docs/sociedades-categorias.md` pasa a `docs/referencia/sociedades-categorias.md`.
- Plan: fases 2 a 7 en `done` (en código), con sección «Estado» y «Movido a otras fases»; la antigua fase 8 pasa a la 12 (`phase-12-activacion-real.md`, publicación = 1.0.0); fases 8 a 11 nuevas con `ak plan add-phase` (la antigua 8 se apartó antes para que la CLI numerara de la 8 a la 12). Fase 1 coherente (`todo` y «Pending»).

## Rutas corregidas fuera de docs/ y plans/ (solo la ruta)

Comentarios: `.env.example`, `infra/docker/compose.dev.yml`, `infra/scripts/generate-cert.sh`, `apps/worker/src/classify/default-rules.ts`, `packages/shared/src/sociedades.ts`, cabecera de `apps/worker/scripts/extraction-test.ts`.

**Dos rutas en código que se leen de verdad** (si no, se rompen las pruebas y el script): `packages/db/prisma/seed-data.test.ts` (ruta del fichero y nombre del test) y `apps/worker/scripts/extraction-test.ts` (`readFile`). Solo cambia la ruta.

## Informes versionados

Se quitaron detalles de otro proyecto: nombres de contenedores y una ruta de máquina de otro proyecto, y dos dominios de otro proyecto (tres informes de `plans/reports/`). Quedan sin tocar los demás. La revisión del 2026-10-03 menciona CPA y los nombres de sus scripts de versiones; no lo he tocado porque es el documento de origen de la tarea y no incluye servicios, dominios ni debilidades.

## Verificación

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (infra 30, shared 16, db 9, web 118, worker 305 más 5 omitidas de integración), `pnpm build` y `pnpm format:check`: en verde. `pnpm format` solo reajustó el README.
- Enlaces: script (`check-links.py`, resuelve rutas y anclas de todos los `.md`): 63 ficheros, 164 enlaces relativos, 0 rotos; 7 pendientes, todos hacia `docs/operacion/versiones-y-releases.md` (otro PR).
- `ak plan validate` sobre la carpeta del plan: válido (`ak plan status`: 6 de 12 fases hechas).
- `grep -i "gcentesimo|@foodbox.es|@arcofood.com"` sobre los ficheros versionados: la única coincidencia es el propio patrón citado en un informe antiguo (no hay direcciones).
- Ningún documento de `docs/` supera 190 líneas; `CLAUDE.md`, 85.
- Afirmaciones de `arquitectura.md` contrastadas con `classify/index.ts`, `classify/thread.ts`, `jobs/process-message.ts`, `sync/delta.ts`, `extract/`, `jobs/queues.ts`, `config.ts`, `decision-store.ts` y `schema.prisma`.

## Decisiones pendientes del usuario

- Cobertura mínima por categoría (se fija con los datos de la fase 9).
- Plazo de conservación de remitentes, asuntos y decisiones (propuesta: 24 meses).
- Certificado y configuración de Microsoft 365 (fase 1); crear la categoría ARCOBETA; responsable de los avisos de Uptime Kuma; cómo y cuándo se avisa al equipo de Proveedores; autorizar el despliegue.

## Para el controlador (fuera de mi alcance)

- `infra/dokploy/README.md` todavía nombra el proyecto de Dokploy de otro proyecto del servidor (línea 3). No lo he tocado por la restricción sobre `infra/`.
- `infra/dokploy/README.md` afirma que la prueba de restauración «se comprueba una vez al mes», pero no está programada; la documentación de operación lo dice y lo lleva al plan.
- El worker en sombra tiene una escritura en el buzón: crear una categoría maestra confirmada desde el panel. La regla de `CLAUDE.md` y `arquitectura.md` lo recogen con ese matiz.
