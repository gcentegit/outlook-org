# Revisión del proyecto, del plan y del versionado

**Fecha:** 2026-10-03
**Alcance:** decisiones de arquitectura, plan y fases, estructura de carpetas y documentación, y control de versiones con SemVer en GitHub.
**Método:** lectura del repositorio (`dd6b91e`), del plan, de `docs/DECISIONS.md`, de los flujos de GitHub y de la configuración del repositorio en GitHub. No se ha cambiado código.

## Veredicto

Las decisiones técnicas son, en su mayoría, correctas y están bien justificadas. Los puntos débiles no están en el código sino en tres sitios:

1. **Se ha construido antes de validar con datos reales.** Las fases 2 a 7 están programadas (unas 10.700 líneas de código y 7.000 de pruebas), pero ninguna se ha probado contra el buzón real. El plan ponía el acceso al buzón (fase 1) y el histórico (fase 4) por delante precisamente para evitarlo.
2. **El criterio de aceptación descansa en una hipótesis sin comprobar:** que el equipo etiqueta hoy los correos por sociedad.
3. **El versionado SemVer es solo nominal** y el repositorio no tiene todavía la estructura de ramas, releases y documentación que pide un proyecto mantenido.

## Hallazgos por prioridad

### Prioridad 1: resolver antes de seguir

**1. Un informe con detalles internos de otro proyecto está publicado.**
`plans/reports/dokploy-261002-1549-mejoras-despliegue-cpa.md` describe debilidades y topología del despliegue de CPA, cuyo repositorio es privado, y este repositorio es público. Fue un error incluirlo en el primer commit. Hay que sacarlo del repositorio y de su historial (el repositorio tiene un único commit, así que basta rehacerlo y forzar la subida) y guardarlo en `docs/privado/` o en el repositorio de CPA. El resto de informes solo mencionan nombres de servicios; conviene revisarlos con el mismo criterio.

**2. La «verdad» contra la que se mide el acierto puede no existir.**
El criterio de aceptación es «precisión ≥ 95 % por categoría frente a lo que etiqueta el equipo». La captura de Outlook sugiere que hoy el equipo no etiqueta por sociedad de forma sistemática: un correo de «Lateral Arturo Soria» lleva «Pte ok» y «Elena» pero no LATERAL, una factura lleva solo ACTIVO, y la categoría ARCOBETA ni siquiera existe. Si el equipo no pone estas tres etiquetas, el modo sombra no tendrá con qué compararse y el 95 % no se podrá medir.
Propuesta:
- Añadir una **fase de descubrimiento**, de solo lectura, que es lo primero que se ejecuta al tener el certificado: cuántos correos al día, qué porcentaje lleva adjuntos, qué porcentaje lleva alguna de las tres categorías, y en qué porcentaje aparece un CIF del grupo en el adjunto.
- Definir la verdad de referencia como una **muestra de unos 200 correos revisada a mano** por el usuario o el equipo, no como el histórico tal cual.
- Decidir con el equipo cómo se medirá el modo sombra: o el equipo etiqueta por sociedad durante esas dos semanas, o se revisa una muestra semanal en el panel.

**3. Congelar funcionalidad nueva hasta tener datos reales.**
Lo construido no se pierde, pero cada cosa nueva que se añada ahora se apoya en supuestos sin comprobar (formato de los adjuntos en Graph, calidad del OCR con facturas reales, cuántos correos resuelven las reglas solas). Es posible que las reglas por CIF resuelvan casi todo y el LLM apenas haga falta; también es posible lo contrario. Hasta saberlo, solo conviene tocar estructura, versionado y documentación.

**4. El criterio de aceptación no exige cobertura.**
Un sistema que etiqueta el 5 % de los correos con un 100 % de precisión cumple el criterio actual. Falta un mínimo de cobertura por categoría (qué porcentaje de los correos que son de esa sociedad se etiquetan), a fijar con los datos del descubrimiento.

### Prioridad 2: versionado y GitHub

**5. SemVer es solo nominal.** Estado actual:
- No hay rama `main`: la rama por defecto de GitHub es la de trabajo, sin protección.
- No hay etiquetas, ni Releases de GitHub, ni `CHANGELOG.md`.
- Las seis `package.json` dicen `0.1.0` y nada las actualiza.
- `release.yml` se dispara con una etiqueta `vX.Y.Z`, pero despliega la imagen por el sha del commit y `/health` muestra el sha, no la versión. Además, al crear la etiqueta se reconstruyen las imágenes del mismo commit.
- Nada valida el formato de los commits.

La propuesta completa está en «Versionado con SemVer».

**6. Repositorio público: decisión a reconsiderar.** Se eligió público para no necesitar token en Dokploy y por los runners arm64 gratuitos. El coste es que quedan a la vista la lógica interna de un proceso financiero, la estructura societaria y los planes. CPA es privado. Un repositorio privado necesita un token de solo lectura de paquetes en Dokploy (ya previsto en `release.yml` y `provision.ts`) y consume minutos de Actions del plan gratuito; el coste real de los runners arm64 en privado está por confirmar. Es una decisión del usuario; aquí solo se deja el contraste.

**7. Falta lo básico de un repositorio público:** aviso de licencia o de «todos los derechos reservados», Dependabot, alertas de secretos con bloqueo en la subida, y plantilla de pull request.

### Prioridad 3: estructura y documentación

**8. `docs/DECISIONS.md` está organizado por cronología, no por tema.** Son 166 líneas densas con una sección «Correcciones de la revisión de código» que mezcla clasificador, panel y servicio. Para saber cómo funciona hoy la herencia del hilo hay que leer tres sitios. Propuesta: registros de decisión independientes (`docs/adr/NNNN-titulo.md`, como en CPA) y un documento de arquitectura que describa el estado actual.

**9. Faltan documentos de entrada y de operación:** índice de `docs/`, visión de arquitectura, guía de operación (despliegue, vuelta atrás, copias, caducidades) y proceso de versiones. No hay `CLAUDE.md`/`AGENTS.md` con las reglas del proyecto para los agentes, pese a que el proyecto se construye con ellos.

**10. El plan no refleja bien el estado.** Seis fases están «en curso» con una nota entre paréntesis; el campo `status` de la fase 1 dice `todo` y la tabla dice «en curso»; el esfuerzo (13 días) está desfasado. Lo que queda en todas ellas es lo mismo: validación con datos reales. Propuesta: cerrar las fases de construcción y reunir lo pendiente en fases de validación claras.

**11. Los informes de agentes se publican tal cual.** Hay 16 en `plans/reports/` con nombres de proceso. Son registros de trabajo, no documentación. Propuesta: mantenerlos, pero revisar su contenido antes de cada subida mientras el repositorio sea público.

### Prioridad 4: riesgos de operación no cubiertos por el plan

**12. Caducidades sin aviso.** El certificado dura 730 días y el secreto de la app de login tiene caducidad. Si caducan, el servicio deja de funcionar sin previo aviso. Propuesta: exponer los días que faltan en `/health` y avisar con 30 días.

**13. Sin tope de gasto del LLM.** Un bucle o un cambio de modelo a uno caro no tiene límite. Propuesta: tope diario configurable; al superarlo, los correos quedan como dudosos y se avisa.

**14. Retención indefinida de datos personales.** El texto de adjuntos caduca a los 90 días, pero remitentes, asuntos y decisiones se guardan siempre. Propuesta: fijar un plazo (por ejemplo, 24 meses) y anotarlo en el registro de actividades de tratamiento de la empresa.

**15. Correos adjuntos (`.eml`, `.msg`) no soportados y sin medir.** Si el equipo reenvía facturas adjuntando el correo original, se pierde el PDF. El descubrimiento debe contar cuántos casos hay.

**16. Gestión del cambio con el equipo.** El plan no dice cuándo ni cómo se informa al equipo de Proveedores, cómo corrigen una etiqueta automática ni quién atiende los avisos de Uptime Kuma.

**17. Pruebas que no corren en CI.** Las pruebas de integración (PostgreSQL y docling) solo se ejecutan a mano y las de navegador no están en el repositorio.

**18. Imagen del worker de 2 GB.** Lleva `tsx` y el CLI de Prisma en producción. Funciona, pero alarga cada despliegue. Mejora de baja prioridad: compilar el worker y separar las migraciones.

## Decisiones que se consideran acertadas

- Microsoft Graph con certificado y RBAC de Exchange limitado al buzón; la web sin credenciales del buzón.
- Sondeo con delta en lugar de webhooks; cola sobre PostgreSQL sin Redis; una sola instancia con bloqueo.
- Reglas deterministas primero y LLM solo para lo dudoso; ante la duda, no etiquetar; nunca quitar etiquetas de personas.
- Modo sombra obligatorio, con el modo real bloqueado en el código hasta la última fase.
- Servicios independientes en Dokploy, versión exacta de imagen, comprobaciones de salud, límites de memoria y prueba de restauración.
- Direcciones reales solo por variables de entorno; documentos internos fuera de git.

## Versionado con SemVer: propuesta

**Reglas**
- Una única versión para todo el producto, en el `package.json` raíz. Los paquetes internos son privados y no se versionan por separado.
- Commits con formato Conventional Commits, validado en los pull requests.
- `fix` y `perf` suben PATCH; `feat` sube MINOR; un cambio incompatible sube MAJOR.
- Qué es «incompatible» en esta aplicación: una migración que exige pasos manuales o no admite volver atrás, una variable de entorno nueva obligatoria, o un cambio en lo que el servicio hace en el buzón.
- Serie `0.x` mientras el servicio solo funcione en sombra. La **`1.0.0`** será la primera versión que escribe categorías en el buzón.

**Flujo**
1. `main` protegida: solo se entra por pull request con la CI en verde, con fusión «squash» y título convencional.
2. Cada fusión en `main` construye las imágenes una sola vez (etiqueta por sha).
3. Una herramienta mantiene un pull request de versión que actualiza la versión y `CHANGELOG.md`.
4. Al fusionarlo se crean la etiqueta `vX.Y.Z` y la Release de GitHub con las notas del changelog; la imagen ya construida recibe la etiqueta `X.Y.Z` (sin reconstruir) y se despliega.
5. `/health` y el panel muestran `X.Y.Z` y el sha.
6. Volver atrás es desplegar la versión anterior desde el flujo manual.

**Herramienta: dos opciones**

| | release-please | Changesets (como CPA) |
| --- | --- | --- |
| Origen de las notas | Los mensajes de commit | Un fichero de cambios escrito a mano por cada cambio |
| Trabajo por cambio | Ninguno más allá del commit convencional | Escribir el changeset |
| Calidad de las notas | Técnica, tal como estén los commits | Lenguaje de producto, cuidada |
| Piezas propias que mantener | Ninguna | Los scripts de CPA (`bump-app-version`, `build-release-notes`, `release-integrada`) |
| Coherencia con CPA | Distinto proceso | Mismo proceso y mismas seis reglas |

Recomendación: **release-please** para este proyecto. Es una herramienta interna con un único administrador, y release-please cumple por sí solo las reglas del proceso de CPA que importan aquí (el changelog es la única fuente de las notas, una etiqueta siempre lleva Release, el título es la versión) sin scripts propios. Changesets es la opción si pesa más tener el mismo proceso en todos los proyectos.

## Estructura propuesta

```
outlook-org/
├── README.md  CHANGELOG.md  CLAUDE.md  LICENSE (o aviso de derechos)
├── .github/           workflows (ci, release), dependabot, plantilla de PR
├── apps/web  apps/worker
├── packages/db  packages/shared
├── infra/docker  infra/dokploy  infra/scripts
├── docs/
│   ├── README.md                índice
│   ├── arquitectura.md          cómo funciona hoy
│   ├── adr/                     una decisión por fichero
│   ├── guias/                   entra-id-rbac
│   ├── operacion/               despliegue, versiones, copias, caducidades
│   ├── referencia/              sociedades-categorias
│   └── privado/                 fuera de git
└── plans/                       plan y fases, informes, diario
```

El código (`apps/`, `packages/`, `infra/`) ya está bien organizado y no necesita cambios de estructura.

## Plan revisado: fases propuestas

| # | Fase | Estado |
| --- | --- | --- |
| 1 | Acceso a Microsoft 365 y cuentas | Pendiente del usuario |
| 2 | Base del proyecto | Hecha |
| 3 a 7 | Extracción, histórico, clasificador, servicio, panel (construcción) | Hechas en código |
| 8 (nueva) | Repositorio, versionado y documentación | Siguiente; no depende del buzón |
| 9 (nueva) | Descubrimiento y verdad de referencia con el buzón real | Tras la fase 1 |
| 10 (nueva) | Validación con datos reales: extracción, histórico, evaluación con LLM, ajuste de reglas | Tras la 9 |
| 11 | Despliegue en sombra y dos semanas de observación | Tras la 10 |
| 12 | Activación real (`1.0.0`) | Tras la 11 |

## Preguntas abiertas

- ¿El equipo etiqueta hoy por sociedad (FOOD BOX, LATERAL) de forma habitual, o solo a veces?
- ¿Se mantiene el repositorio público o se pasa a privado?
- ¿release-please o Changesets?
- ¿Qué plazo de conservación se quiere para remitentes, asuntos y decisiones?
