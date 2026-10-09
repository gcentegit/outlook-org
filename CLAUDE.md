# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
pnpm --filter @clasificador/worker dev                     # worker con recarga; PostgreSQL arriba
AUTH_DEV_BYPASS=true pnpm --filter @clasificador/web dev   # panel en el 3110 sin login de Microsoft
```

Una sola prueba (igual en cualquier paquete del workspace), por fichero o por nombre:

```bash
pnpm --filter @clasificador/worker exec vitest run src/classify/rules.test.ts
pnpm --filter @clasificador/worker exec vitest run src/classify/rules.test.ts -t "CIF"
```

Los scripts de la raíz generan antes el cliente de Prisma. Si lanzas un paquete suelto en un clon
recién hecho, ejecuta primero `pnpm db:generate` (el cliente va a `packages/db/src/generated/`, fuera
de git).

Pruebas de integración (con PostgreSQL y docling locales): el comando está en la cabecera de
`apps/worker/src/shadow-service.integration.test.ts`. Migraciones: `pnpm db:migrate:dev`
(nueva) y `pnpm db:migrate:deploy` (aplicar).

Puertos locales: PostgreSQL **5442**, docling **5101**, web **3110** (`WEB_HOST_PORT`). El 3000,
3001 y 5432 son de otros proyectos de la máquina: no los toques.

## Cómo encajan las piezas

Lo que no se ve leyendo un solo fichero. El flujo completo de un correo está en
[docs/arquitectura.md](docs/arquitectura.md).

- **Sin paso de compilación entre paquetes.** `packages/shared` y `packages/db` se importan como
  fuente TypeScript: el worker corre con `tsx` y la web los transpila (`transpilePackages`). Un cambio
  en ellos afecta a las dos apps a la vez.
- **La web habla con el worker solo por la cola (pg-boss).** El nombre de cada cola y el esquema de su
  resultado están en `packages/shared`; el worker crea las colas y las atiende
  (`apps/worker/src/jobs/queues.ts`); la web solo encola y espera
  (`apps/web/src/server/job-runner.ts`). Una petición del panel al buzón pasa por esos tres sitios y
  nunca lleva credenciales a la web.
- **La lógica recibe sus dependencias.** Sincronización, clasificación y trabajos declaran interfaces
  (`SyncStore`, `DecisionStore`, repositorios) y las implementaciones con Prisma van aparte
  (`createPrisma*`). Las pruebas unitarias usan dobles y no necesitan base de datos; solo la de
  integración usa PostgreSQL, con Graph simulado inyectado como `fetch`.
- **Acceso al panel en cada página y cada acción.** Cada `page.tsx` de `(panel)` y cada función
  exportada de un `actions.ts` llama a `requireUser()` antes de leer datos.
  `apps/web/src/app/access-guards.test.ts` lo comprueba y lleva la lista de páginas y de route
  handlers: hay que actualizarla al añadir uno.
- **El worker migra y siembra al arrancar** (`apps/worker/src/index.ts`): una migración que esté en el
  código se aplica en cuanto un worker arranca contra esa base de datos. De ahí la regla 7.
- **Un único `.env` en la raíz** lo comparten compose, worker, web y Prisma. Cada app valida sus
  variables con Zod (`config.ts`); una variable nueva se documenta en `.env.example`.
- **Idioma:** identificadores en inglés; comentarios, mensajes al usuario, documentos y títulos de PR
  en español.

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
   (`feat:`, `fix:`, `docs:`...) sin referencias a IA. El PR se fusiona con «squash»: su **título** es
   el mensaje que queda en `main` y decide la versión
   ([versiones y releases](docs/operacion/versiones-y-releases.md)).
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
