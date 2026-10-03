# Reglas del proyecto

Clasificador del buzón de Proveedores: propone las categorías FOOD BOX, LATERAL y ARCOBETA a partir
del CIF y la razón social de las facturas, de la conversación y, en los casos dudosos, de un LLM.
Hoy solo funciona en **modo sombra**, sin validar con datos reales y sin desplegar. Qué es y cómo
arrancarlo: [README.md](README.md). Cómo funciona: [docs/arquitectura.md](docs/arquitectura.md).
Índice de docs: [docs/README.md](docs/README.md).

El repositorio es **público**. Lo que escribas aquí lo puede leer cualquiera.

## Estructura

- `apps/worker`: servicio (sincronización con Graph, extracción, clasificador, colas).
- `apps/web`: panel Next.js. No tiene credenciales del buzón.
- `packages/db`: esquema Prisma, migraciones y semilla. `packages/shared`: tipos y utilidades comunes.
- `infra/`: compose local, alta en Dokploy (`infra/dokploy`) y scripts.
- `docs/`: documentación vigente. `plans/`: plan, informes y diario (registros de estado).

## Comandos

Node 22 y pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check          # y pnpm format para corregir
pnpm services:up           # PostgreSQL, docling, worker y web en local
pnpm services:down
```

Pruebas de integración (con PostgreSQL y docling locales): el comando está en la cabecera de
`apps/worker/src/shadow-service.integration.test.ts`. Migraciones: `pnpm db:migrate:dev`
(nueva) y `pnpm db:migrate:deploy` (aplicar).

Puertos locales: PostgreSQL **5442**, docling **5101**, web **3110** (`WEB_HOST_PORT`). El 3000,
3001 y 5432 son de otros proyectos de la máquina: no los toques.

## Reglas innegociables

1. **El worker no escribe en los correos del buzón fuera del modo real.** `MODE=live` no está soportado
   y el worker se niega a arrancar con él. La única escritura en el buzón en sombra es crear una
   categoría maestra pedida y confirmada desde el panel.
2. **Nunca se quitan las categorías que ponen las personas** ni se crean categorías por cuenta propia.
3. **Las direcciones reales solo van por variables de entorno** (`MAILBOX`, `ADMIN_EMAIL`). En
   documentos, `<MAILBOX>` y `<ADMIN_EMAIL>`; en código y pruebas, `ejemplo.com`.
4. **Nada de datos de terceros en git:** `data/`, `secrets/` y `docs/privado/` están ignorados.
   Tampoco detalles internos de otros proyectos del servidor: se puede decir «otro proyecto del mismo
   servidor» o «CPA», sin nombres de sus servicios, bases de datos, dominios ni debilidades.
5. **Nada se despliega sin autorización del usuario**, tampoco el alta de servicios en Dokploy.
6. **Cambios a `main` solo por pull request** con la CI en verde. Commits convencionales
   (`feat:`, `fix:`, `docs:`...) sin referencias a IA.
7. **Copia de seguridad antes de cualquier migración**
   ([copias y restauración](docs/operacion/copias-y-restauracion.md)).
8. **Para los procesos que arranques** (servidores de desarrollo, contenedores): lleva la cuenta y
   páralos al terminar. Si un puerto está ocupado, identifica quién lo usa y no lo pises si no es tuyo.
9. **Sin secretos en git ni en el chat:** claves de LLM, certificado, secretos de cliente y `.env`.
10. **Sin funcionalidad nueva hasta validar con datos reales.** Los riesgos de operación van al plan
    como tareas, no se implementan antes.

## Dónde va cada cosa

- **Plan y fases:** `plans/261001-2123-clasificador-foodbox-lateral/` (gestionado con `ak plan`;
  después de editar, `ak plan validate <carpeta>`).
- **Informes de trabajo:** `plans/reports/`. Son registros de estado. Revísalos antes de subirlos: sin
  direcciones reales ni datos de terceros.
- **Resultados con datos de terceros** (histórico, muestras, candidatas): `data/history/`, no en git.
- **Decisiones:** `docs/adr/`, una por fichero, con el siguiente número libre. Formato: Estado,
  Contexto, Decisión, Consecuencias.
- **Cómo se opera:** `docs/operacion/`. **Cómo se configura Microsoft 365:** `docs/guias/`.

## Cuándo escribir un ADR

Cuando una decisión cueste cambiarla, descarte alternativas razonables, fije una regla de negocio o
requiera una advertencia que el código no puede expresar. Se edita el ADR existente si la decisión
cambia (describe el estado actual, no la historia). Lo que el código ya dice no va en un ADR: se
enlaza al fichero.

## Documentación

El código es dueño del qué y el cómo; los documentos solo explican el porqué y dónde mirar. No copies
inventarios, conteos ni valores por defecto en prosa. Si cambias comportamiento, configuración,
comandos o una decisión, actualiza el documento que lo posee y comprueba que no se rompen enlaces.
