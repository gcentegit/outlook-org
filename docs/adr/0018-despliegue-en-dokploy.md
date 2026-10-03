# 0018. Despliegue en Dokploy: servicios independientes y descritos en el repositorio

- **Estado:** aceptada (todavía no se ha desplegado nada)

## Contexto

El servicio se aloja en el Dokploy de un servidor Oracle arm64 de 4 CPU y unos 23 GiB que comparte
con otros proyectos. Otro proyecto del mismo servidor ya sigue un patrón parecido; aquí se
corrigen debilidades conocidas desde el principio. El alta de servicios está en
[infra/dokploy/README.md](../../infra/dokploy/README.md) y la crea
[`provision.ts`](../../infra/dokploy/provision.ts).

## Decisión

- **Nada se sube a Dokploy hasta que el usuario lo autorice.** Desarrollo y pruebas, en local.
- **Sin Compose en Dokploy:** web, worker, docling y PostgreSQL nativo son servicios
  independientes. `infra/docker/compose.dev.yml` es solo para desarrollo local.
- **Infraestructura descrita en el repositorio:** `provision.ts` es idempotente (a través de la API
  de Dokploy) y crea o corrige proyecto, servicios, límites, comprobaciones de salud, dominio,
  variables y copia de seguridad. Por defecto solo simula (`--dry-run`); `--apply` escribe. No
  borra nada.
- **`provision.ts` no despliega web ni worker:** solo PostgreSQL y docling, la primera vez. Nunca
  cambia la imagen de una aplicación existente (es cosa del flujo de publicación). Docling se fija
  a `v1.36.0` (la versión probada en local), no a `latest`.
- **Comprobación de salud en todos los servicios** ([0017](0017-imagenes-y-comprobaciones-de-salud.md))
  y **reserva y límite de memoria en todos** (web 256 MiB / 512 MiB, worker 256 MiB / 1 GiB,
  docling 1,5 GiB / 4 GiB, PostgreSQL 256 MiB / 1 GiB); se ajustan con métricas reales tras la
  primera semana. Las métricas (monitorización de Dokploy o Beszel) se activan antes del primer
  despliegue.
- **Una sola vía de despliegue:** `autoDeploy` apagado; solo despliega el flujo de publicación
  ([0019](0019-publicacion-y-vuelta-atras.md)).
- **Unidades de Dokploy:** la memoria va en bytes sin sufijos y las comprobaciones de salud de Swarm
  en nanosegundos, tal como las pasa Dokploy a Docker. Los `appName` los asigna Dokploy (con
  sufijo), así que el script los lee tras crear cada servicio y los escribe en `DATABASE_URL` y
  `DOCLING_URL`.

## Advertencias de despliegue

- **Actualización `stop-first` (la de por defecto), nunca `start-first`.** Con `start-first` la
  instancia nueva esperaría el bloqueo de instancia única y nunca llegaría a estar sana; la
  anterior no se pararía ([0005](0005-sincronizacion-delta-e-instancia-unica.md)).
- **Sin credenciales de Graph el worker ya no se reinicia en bucle:** el `HEALTHCHECK` usa `/livez`,
  que no mide la sincronización. Aun así no sincroniza hasta que se configuren `GRAPH_*` y el
  certificado montado.
- La consulta de contenedores de Dokploy que usa el flujo de publicación no se ha probado contra un
  Dokploy real; la primera vez, simular antes de aplicar.

## Consecuencias

- La configuración real no vive solo en la interfaz de Dokploy: se puede volver a aplicar.
- Un cambio de configuración de un servicio ya desplegado surte efecto en su siguiente despliegue.
