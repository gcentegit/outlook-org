# Fase 7: panel web (apps/web), informe de implementación

Fecha: 2026-10-02. Todo en local; sin despliegue, sin commits, sin Microsoft 365 real ni llamadas a LLM.

## Resultado

El panel está construido y verificado en local. Hay una dependencia con el orquestador: dos columnas/tablas propuestas (más abajo) para activar los interruptores sombra/live y la latencia. Sin ellas el panel funciona y lo explica en pantalla.

Verificación:

| Comprobación | Resultado |
|---|---|
| `pnpm --filter @clasificador/web typecheck` / `pnpm typecheck` (raíz) | OK |
| `pnpm test` (raíz) | OK: web 78 tests en 12 ficheros; worker, db, shared e infra también en verde |
| `pnpm --filter @clasificador/web build` | OK (rutas dinámicas, nada se prerenderiza salvo `_not-found`) |
| `pnpm lint` (raíz) | Falla solo por 2 errores `prefer-const` en `apps/worker/src/sync/poller.test.ts` (carpeta del otro agente). `eslint apps/web` está limpio y `prettier --check` también |
| Dev en 3110 con `AUTH_DEV_BYPASS=true` | `/`, `/discrepancias`, `/modelos`, `/categorias`, `/configuracion`, `/api/health` responden 200; `/login` redirige (307) a `/` |
| Dev en 3110 sin bypass | todas las páginas del panel dan 307 a `/login`; `/login` 200 con el aviso de variables `MS_*`; `/api/health` 200 |
| `next start` (producción) con `AUTH_DEV_BYPASS=true` | el bypass se ignora: 307 a `/login` en `/` y `/configuracion`; no aparece el aviso "Modo desarrollo" |

Salida de curl (extracto):

```
# dev con bypass
/ -> 200   /discrepancias -> 200   /modelos -> 200   /categorias -> 200   /configuracion -> 200   /api/health -> 200   /login -> 307
# dev sin bypass
/ -> 307 http://localhost:3110/login   (igual en /discrepancias, /modelos, /categorias, /configuracion)
/login -> 200   /api/health -> 200   /api/auth/ok -> 200
# producción con AUTH_DEV_BYPASS=true
/ -> 307 http://localhost:3110/login   /configuracion -> 307 http://localhost:3110/login
```

Con credenciales `MS_*` falsas, `POST /api/auth/sign-in/social` devuelve la URL de autorización de Entra ID del tenant configurado con `scope=openid profile email` y `redirect_uri=.../api/auth/callback/microsoft`.

Los procesos dev y `next start` que arranqué (PID 3610019/3610041, 3614265/3614314, 3616304/3616323, 3625194/3625242) están parados; el puerto 3110 queda libre. No toqué los contenedores postgres/docling ni procesos ajenos. La BD de desarrollo quedó como estaba (los datos de prueba `ui-test-*` y un usuario temporal se borraron; `LlmSetting` activo restaurado a anthropic/claude-haiku-4-5-20251001 con `updatedBy` NULL).

## Qué se hizo

1. **Autenticación** (`src/lib/auth.ts`, `access.ts`, `session.ts`, `panel-env.ts`, `app/login`, `app/api/auth/[...all]`).
   - better-auth 1.7.7 con el proveedor Microsoft, tenant único (`MS_TENANT_ID`), callback `/api/auth/callback/microsoft`.
   - **Scopes: `openid`, `profile`, `email`. No hace falta `User.Read`.** better-auth añade por defecto `User.Read` y `offline_access` (comprobado en su código fuente); se desactivan con `disableDefaultScope` y `disableProfilePhoto`, y el email sale del id_token (si Entra no emite el claim `email` se usa `preferred_username`). Esto cierra la duda abierta en la parte C de `docs/guia-entra-id-rbac.md`: la app de login solo necesita los tres permisos delegados básicos.
   - **Modo sin estado, sin tablas nuevas**: la sesión viaja en una cookie cifrada (JWE, 8 h). No hace falta añadir user/session/account/verification a `schema.prisma`.
   - La autoridad real es `AllowedUser`, consultada en cada petición (`requireUser()` en el layout y en todas las acciones del servidor). Una cuenta del tenant que no esté en la lista ve "Sin acceso" en `/login`; quitar a alguien le corta el acceso en su siguiente petición.
   - Sin sesión, todo el panel redirige a `/login`. Sin `MS_CLIENT_ID`/`MS_CLIENT_SECRET`/`MS_TENANT_ID` la app arranca y `/login` muestra un aviso con las variables que faltan (botón deshabilitado).
   - `AUTH_DEV_BYPASS=true` solo vale con `NODE_ENV=development` (`isDevBypassActive`); entra como el primer `AllowedUser` y muestra un aviso permanente. Tests: `panel-env.test.ts` (producción/test/sin NODE_ENV lo ignoran) y la comprobación manual con `next start` de arriba.
   - `auth.test.ts` recorre el flujo OAuth completo contra un Entra ID simulado (claves y token locales): scopes, sesión legible, UPN como alternativa al claim email, y usuario fuera de la lista = `forbidden`.
   - Nota técnica: en el flujo de código, better-auth no valida la firma del id_token (llega directo del endpoint de token del tenant por TLS). La restricción de tenant la impone la app de Entra (un solo tenant) y el propio endpoint del tenant.
2. **Métricas** (`src/server/metrics.ts` + `metrics.test.ts`, `dates.ts`, `filter-params.ts`). Filtro por fechas (hora de Madrid, con cambio de hora) y categoría, guardado en la URL. Definiciones documentadas en el módulo:
   - Decisión vigente = la más reciente de cada correo. Categorías del equipo = última `Correction.final`, o si no hay, `seenCategories`; solo las tres categorías automatizadas, sin distinguir mayúsculas.
   - Leídos, clasificados, sin clasificar (decisión sin categoría), pendientes (sin decisión) y cobertura = clasificados / (clasificados + dudosos).
   - Precisión y cobertura por categoría (aciertos, falsos positivos, falsos negativos); origen hilo/regla/LLM/ninguno desde `decision.source`; por modelo: decisiones, acierto (categorías idénticas a las del equipo), coste (suma de `costUsd`) y latencia.
   - Estado del servicio: `SyncState.lastSyncAt` (al día / parado / sin sincronizar, umbral `SYNC_STALE_SECONDS`), cola (correos sin decisión) y última decisión. Los errores del worker no se guardan en BD, así que la pantalla lo dice y remite a sus logs.
   - Comprobado contra la BD real con 4 correos de prueba: los números coinciden con el cálculo manual.
3. **Discrepancias**: lista paginada (25 por página) de correos donde el equipo difiere de la decisión vigente, con propuesto, equipo, origen, modelo y motivo; respeta el filtro de fechas y categoría.
4. **Modelos**: selector de proveedor (los 4 ids del worker) + modelo (texto libre con sugerencias). `setActiveLlm` desactiva las demás y activa la elegida en una transacción (probado contra la BD real: siempre una sola activa). Aviso de privacidad: OpenRouter ("activa no-entrenar y ZDR en tu cuenta", más aviso extra para modelos `:free`), Gemini (nivel gratuito), compatible OpenAI (Ollama local vs servicio externo) e informativo para Anthropic. Las claves de API no se muestran ni se editan.
   - **Botón "Probar" deshabilitado con "Disponible en la fase 6"**: el clasificador vive en `apps/worker` (app de `tsx`, sin exports de paquete) y probarlo desde Next obligaría a copiar las dependencias del AI SDK y las claves de LLM al panel. Lo razonable es que el worker exponga la prueba (o que el clasificador pase a un paquete compartido) en la fase 6.
5. **Categorías del buzón** (`src/server/graph-categories.ts`, `app/(panel)/categorias`). Lista maestra de `<MAILBOX>` vía Graph con `ClientCertificateCredential` (mismas variables `GRAPH_*` y `MAILBOX` que el worker), solo en servidor. Aviso si falta FOOD BOX/LATERAL/ARCOBETA. Formulario nombre + color `preset0`-`preset24` con confirmación en dos pasos (cliente) y comprobación `confirmado=si` en la acción; rechaza duplicados; tras crear registra en `CategoryAudit` (quién y cuándo) y muestra el registro. Sin renombrar ni borrar. Sin credenciales Graph: "Sin conexión con el buzón (falta configurar la fase 1)" y el formulario queda deshabilitado. Probado con fetch simulado (no hay credenciales reales).
6. **Interruptores sombra/live por categoría** (`src/server/category-modes.ts`, sección en `/configuracion`). No existe tabla: el modelo propuesto está más abajo. El código usa SQL directo sobre `"CategorySetting"` y, mientras la tabla no exista, `getCategoryModes` devuelve `available: false` y la UI explica que todo está en sombra y deshabilita los botones. Pasar a live exige marcar una casilla de confirmación (también validada en el servidor). Verificado el SQL (lectura, upsert, caso sin tabla) en una BD temporal con la tabla creada (ya eliminada). Cuando la tabla exista no hay que tocar el panel; se puede cambiar a cliente Prisma si se prefiere.
7. **Usuarios autorizados**: alta (email normalizado, sin duplicados) y baja; no deja quitarse a uno mismo ni dejar la lista vacía. Probado contra la BD real.
8. `/api/health` se mantiene sin cambios y sin sesión (lo usa el HEALTHCHECK).
9. **UI**: Tailwind 4 + componentes propios tipo shadcn (`components/ui.tsx`), paleta con contraste AA en claro y oscuro (clase `dark`, preferencia guardada y respeto de `prefers-color-scheme`), enlace "Saltar al contenido", foco visible, tablas con `caption`/`scope`, avisos con `role` y `aria-live`, `prefers-reduced-motion`, responsive (cabecera y filtros envuelven, tablas con scroll horizontal). No se importó nada de CPA salvo el enfoque (Tailwind 4 + tokens por variables CSS); la lógica de CPA no se trajo.

## Ficheros

Creado/modificado dentro de `apps/web/`: `package.json` (dependencias: better-auth, @azure/identity, @clasificador/db, @clasificador/shared, pg, @prisma/client, server-only, lucide-react; dev: tailwindcss, @tailwindcss/postcss; script `dev` en el puerto 3110), `next.config.ts` (carga el `.env` de la raíz si existe y transpila `@clasificador/db`), `postcss.config.mjs`, `vitest.config.ts` (alias de `server-only`), `Dockerfile` (añade `pnpm --filter @clasificador/db generate` antes de compilar; no probado con `docker build` completo), y todo `src/` (app, componentes, `lib/`, `server/`). Se borró `src/app/page.tsx` (sustituido por `app/(panel)/page.tsx`).
Fuera de `apps/web/`: `pnpm-lock.yaml` (por `pnpm add`) y `.env.example` (bloque nuevo "Panel web" al final, con MS_*, BETTER_AUTH_SECRET/URL, AUTH_DEV_BYPASS y nota sobre GRAPH_*).
No toqué `packages/shared`, `packages/db` ni `apps/worker`.

## Bloques Prisma propuestos (para el orquestador)

Sin ellos el panel funciona; solo quedan inactivos los interruptores y la latencia.

```prisma
/// Modo sombra/live por categoría. Sin fila, la categoría está en sombra.
model CategorySetting {
  category  String       @id
  mode      DecisionMode @default(shadow)
  updatedAt DateTime     @updatedAt
  updatedBy String?
}
```

Y en `Decision` (para la latencia por modelo; el worker debe rellenarla al llamar al LLM):

```prisma
  /// Milisegundos de la llamada al LLM (null si no hubo llamada).
  latencyMs Int?
```

El panel espera exactamente esos nombres de tabla y columna: `"CategorySetting"("category","mode","updatedAt","updatedBy")` y `"Decision"."latencyMs"`. Si el tipo del `updatedAt` de la migración no lleva valor por defecto, el panel lo rellena con `NOW()` en cada escritura.

`better-auth` no necesita ningún bloque Prisma (modo sin estado).

## Si falta algo de shared/db/worker

- `LLM_PROVIDER_IDS` está duplicado en `apps/web/src/lib/llm-providers.ts` respecto a `apps/worker/src/classify/providers.ts`. Convendría moverlo a `@clasificador/shared` y que ambos lo importen (no lo hice por la restricción de carpetas).
- `canonicalCategory` (worker `thread.ts`) está reimplementado en `metrics.ts` por el mismo motivo.
- El worker debe leer `CategorySetting` y rellenar `Decision.latencyMs` (fase 6).
- `SOCIEDADES`/fuente `none`: el panel ya lee `source: 'none'` de `decisionSourceSchema`; no usa `SOCIEDADES`.

## Decisiones y supuestos a revisar

- **Acierto frente al equipo**: un correo sin revisar por el equipo cuenta como "sin categoría del equipo". En sombra, las categorías del equipo = `seenCategories` (solo personas); en live incluyen las del servicio y el acierto sale más optimista (para eso están las `Correction`). La pantalla lo explica. Si preferís medir solo sobre correos ya revisados, se cambia en `evaluateMessages`.
- **Rendimiento**: las métricas cargan en memoria los correos del rango (campos mínimos) y calculan en TypeScript. Es adecuado para miles de correos por periodo; si el histórico de 6 meses con rango completo se hiciera lento, habrá que pasar a agregaciones SQL.
- La sesión sin estado no se puede invalidar en servidor antes de su caducidad (8 h), pero `AllowedUser` se comprueba en cada petición, que es lo que importa aquí.
- El tema oscuro/claro no usa `next-themes`: un script mínimo en el layout y un botón.
- No se pudo hacer prueba de navegador: `agent-browser` no está instalado y no instalé herramientas. La verificación de interacción de formularios se hizo contra la BD real mediante las funciones de servidor y los tests; los formularios (`useActionState`) y el diálogo de confirmación no se han ejercitado en un navegador real.

## Pendientes

- Probar el login con las credenciales reales (fase 1: app de login de Entra con redirección `https://clasificador.arcofood.com/api/auth/callback/microsoft`; en local `http://localhost:3110/api/auth/callback/microsoft`) y definir `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) y `BETTER_AUTH_URL`.
- Probar la lectura/creación de categorías con el certificado real (permiso `MailboxSettings.ReadWrite` de la app del buzón, ya previsto en la guía).
- Probar el formulario en un navegador real y revisar visualmente el tema oscuro.
- `docker build` de la imagen web (el cambio del Dockerfile no está probado de extremo a extremo).
- Documentación: actualizar `docs/guia-entra-id-rbac.md` (parte C: confirmado que `User.Read` no hace falta) y la sección del panel en `README.md`/`docs/DECISIONS.md` (sesión sin estado, `AllowedUser` como autoridad) cuando el orquestador integre los cambios; no toqué esos ficheros por estar fuera de mi propiedad.
- Despliegue en `clasificador.arcofood.com` (DNS, Dokploy, HTTPS): no se hizo, como se pidió.

Status: DONE_WITH_CONCERNS
Summary: Panel completo en apps/web (login Microsoft con lista AllowedUser, métricas, discrepancias, modelos, categorías de Graph, usuarios y UI de interruptores), con typecheck, tests y build en verde y comprobación con curl del acceso y del bypass.
Concerns/Blockers: Faltan dos cambios de esquema para activar interruptores sombra/live (`CategorySetting`) y latencia (`Decision.latencyMs`); el botón "Probar" queda para la fase 6; `pnpm lint` raíz falla solo por 2 errores `prefer-const` en `apps/worker/src/sync/poller.test.ts` (ajeno); login Microsoft, Graph y formularios en navegador real sin probar por falta de credenciales y de herramienta de navegador.
