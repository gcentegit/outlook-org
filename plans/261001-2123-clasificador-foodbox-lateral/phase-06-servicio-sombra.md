---
title: "Phase 6: Servicio en modo sombra y despliegue"
status: in-progress
effort: 1.5d
---

# Phase 6: Servicio en modo sombra y despliegue

## Overview

Servicio continuo: detecta correos nuevos, los clasifica y registra la decisión
sin tocar el buzón. Desplegado en Dokploy (Oracle arm64) como servicios
independientes, sin Compose, siguiendo el patrón del proyecto `cpa.arcofood`.

## Key Insights

- La delta query de Graph es **por carpeta**
  (`/users/{buzón}/mailFolders/inbox/messages/delta`), admite `$select` y el
  filtro `changeType=created|updated|deleted`. Hay que guardar el `deltaLink`.
- Los cambios de categorías llegan como `updated`. Así se detectan las
  correcciones del equipo. Los cambios del propio servicio se distinguen
  comparándolos con la última decisión aplicada.
- Los correos se quedan en la Bandeja de entrada al llegar y el equipo los mueve
  después a mano, así que solo se sigue esa carpeta. Un correo movido se ve como
  `deleted`: la última corrección registrada antes del movimiento es la que cuenta.

## Despliegue en Dokploy

Proyecto `clasificador.arcofood`, entorno `production`:

| Servicio | Tipo en Dokploy | Origen | Dominio |
| --- | --- | --- | --- |
| `clasificador-web` | Application | Imagen GHCR `clasificador-web` | `clasificador.arcofood.com` |
| `clasificador-worker` | Application | Imagen GHCR `clasificador-worker` | Ninguno |
| `clasificador-docling` | Application | `ghcr.io/docling-project/docling-serve-cpu` | Ninguno |
| Base de datos | PostgreSQL nativo de Dokploy | — | Ninguno |

- No hace falta Redis: la cola (pg-boss) usa PostgreSQL.
- Los servicios se hablan por `dokploy-network` usando su `appName`, como el worker de CPA con ClamAV.
- `clasificador-docling`: límite y reserva de memoria (4 GiB / 1,5 GiB, como ClamAV), comprobación de salud y sin puertos publicados.
- Las imágenes propias se construyen para arm64 con GitHub Actions y se publican en GHCR (`ghcr.io/gcentegit/...`), como CPA.
- Variables y certificado como variables de entorno de cada aplicación. Copias de seguridad de PostgreSQL desde Dokploy.
- Ollama, si se usa, sería otra Application independiente.

### Mejoras respecto al despliegue de CPA

El detalle y la evidencia están en un informe interno que no se versiona en este repositorio.

1. **Versión exacta, no `:latest`.** El flujo de publicación fija en cada Application la imagen `:<sha corto>` (`application.saveDockerProvider`) y después despliega (`application.deploy`). Volver atrás es desplegar la etiqueta anterior. El panel y `/health` muestran la versión.
2. **Comprobación de salud en todos los servicios**: web, worker, docling (`/health`) y PostgreSQL (`pg_isready`).
3. **Reserva y límite de memoria en todos**: web 256 MiB / 512 MiB, worker 256 MiB / 1 GiB, docling 1,5 GiB / 4 GiB, PostgreSQL 256 MiB / 1 GiB. Se ajustan con las métricas reales tras la primera semana.
4. **Infraestructura descrita en el repositorio**: `infra/dokploy/provision.ts` crea o actualiza el proyecto, los servicios, límites, comprobaciones de salud, dominio y copia de seguridad a través de la API de Dokploy, y se puede ejecutar varias veces sin duplicar nada. `infra/dokploy/README.md` documenta exactamente eso; no hay ficheros Compose para Dokploy.
5. **Una sola vía de despliegue**: `autoDeploy` apagado; solo despliega el flujo de publicación.
6. **Copias de seguridad comprobadas**: copia diaria de Dokploy al MinIO existente (7 copias) y `infra/scripts/restore-check.sh`, que restaura la última copia en una base temporal y comprueba que tiene datos. Se ejecuta una vez al mes.
7. **Métricas visibles** antes del primer despliegue: monitorización de Dokploy activada o servicios vigilados en Beszel.

## Requirements

- Polling cada 60-120 s, una única instancia (bloqueo en PostgreSQL).
- Trabajo por correo en pg-boss con reintentos e idempotencia por `messageId`.
- `MODE=shadow`: no hace `PATCH`.
- Heartbeat a Uptime Kuma en cada ciclo correcto.

## Related Code Files

Crear: `src/sync/delta.ts`, `src/worker/process-message.ts`, `src/main.ts`,
`src/corrections.ts`, `apps/worker/src/health.ts`, `.github/workflows/release.yml` (imágenes arm64 a GHCR con etiqueta por commit y despliegue de esa etiqueta), `infra/dokploy/provision.ts`, `infra/dokploy/README.md`, `infra/scripts/restore-check.sh`.

## Implementation Steps

1. Bucle de delta: primera sincronización solo para obtener el `deltaLink` (sin reprocesar el histórico).
2. Encolar los `created`; procesar con extracción (fase 3) y clasificador (fase 5); guardar la decisión.
3. Registrar los `updated` cuyas categorías FOOD BOX/LATERAL/ARCOBETA difieren de la decisión como correcciones.
4. Recuperarse si el `deltaLink` caduca (error 410): nueva sincronización desde el correo registrado más antiguo, para seguir viendo las correcciones de los ya conocidos.
5. Pruebas en local. Alta de los servicios en Dokploy solo cuando el usuario lo autorice, con el certificado como secreto y heartbeat en Uptime Kuma.

## Todo

- [x] Sincronización delta con persistencia
- [x] Worker pg-boss
- [x] Registro de correcciones
- [x] Endpoint `/health` del worker (frescura de la sincronización, para Uptime Kuma) y `/livez` (vida del proceso, para el HEALTHCHECK de Docker y Swarm)
- [x] Correcciones de la revisión: `Message` desde la detección con estado, reintentos y reproceso de decisiones degradadas, datos iniciales al arrancar, flujo de publicación que espera al worker sano antes de la web
- [x] Script de alta de servicios en Dokploy (sin ejecutar hasta que el usuario lo autorice)
- [x] Flujo de publicación con etiqueta por commit
- [x] Script de prueba de restauración
- [ ] Despliegue en Dokploy y heartbeat (cuando el usuario lo autorice)

## Success Criteria

En producción, cada correo nuevo tiene su decisión registrada en menos de 5
minutos y el buzón no cambia.

## Risk Assessment

Throttling de Graph con picos de correo: respetar `Retry-After` y limitar la
concurrencia del worker.
