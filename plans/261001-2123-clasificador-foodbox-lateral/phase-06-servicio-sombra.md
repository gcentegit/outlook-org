---
title: "Phase 6: Servicio en modo sombra y despliegue"
status: done
effort: 1.5d
---

# Phase 6: Servicio en modo sombra y despliegue

## Estado

**Hecha en código e infraestructura descrita**, probada en local (integración con docling real y
base de datos local). Se construyeron la sincronización delta con persistencia, el worker pg-boss, el
registro de correcciones, `/livez` y `/health`, el heartbeat, el flujo de publicación
(`.github/workflows/release.yml`), el script de alta de servicios (`infra/dokploy/provision.ts`) y el
script de prueba de restauración (`infra/scripts/restore-check.sh`). Decisiones:
[ADR 0005](../../docs/adr/0005-sincronizacion-delta-e-instancia-unica.md),
[0006](../../docs/adr/0006-cola-de-trabajos-con-pg-boss.md),
[0007](../../docs/adr/0007-fallos-tecnicos-y-reproceso.md),
[0018](../../docs/adr/0018-despliegue-en-dokploy.md) y
[0019](../../docs/adr/0019-publicacion-y-vuelta-atras.md).

**Validación con datos reales y despliegue: movidos a las fases 10 y 11.** Nada se ha sincronizado
con el buzón real y nada está desplegado en Dokploy.

## Overview

Servicio continuo: detecta correos nuevos, los clasifica y registra la decisión
sin tocar el buzón. Se desplegará en Dokploy (Oracle arm64) como servicios
independientes, sin Compose, siguiendo el patrón de otro proyecto del mismo servidor.

## Key Insights

- La delta query de Graph es **por carpeta**
  (`/users/{buzón}/mailFolders/inbox/messages/delta`) y admite `$select`. Hay que guardar el `deltaLink`.
  Graph no distingue creados de actualizados en la carga útil (el filtro `changeType` no se usa): se decide por la base de datos.
- Los cambios de categorías llegan como cambios de un correo conocido. Así se detectan las
  correcciones del equipo. Los cambios del propio servicio se distinguirán comparándolos con la
  última decisión aplicada (solo relevante en modo real).
- Los correos se quedan en la Bandeja de entrada al llegar y el equipo los mueve
  después a mano, así que solo se sigue esa carpeta. Un correo movido se ve como
  `@removed`: la última corrección registrada antes del movimiento es la que cuenta.

## Despliegue en Dokploy

Proyecto `clasificador.arcofood`, entorno `production`. La tabla de servicios, variables y límites
está en [infra/dokploy/README.md](../../infra/dokploy/README.md); aquí solo el resumen:

| Servicio | Tipo en Dokploy | Origen | Dominio |
| --- | --- | --- | --- |
| `clasificador-web` | Application | Imagen GHCR `clasificador-web` | `clasificador.arcofood.com` |
| `clasificador-worker` | Application | Imagen GHCR `clasificador-worker` | Ninguno |
| `clasificador-docling` | Application | `ghcr.io/docling-project/docling-serve-cpu` | Ninguno |
| Base de datos | PostgreSQL nativo de Dokploy | — | Ninguno |

- No hace falta Redis: la cola (pg-boss) usa PostgreSQL.
- Los servicios se hablan por `dokploy-network` usando su `appName`.
- `clasificador-docling`: límite y reserva de memoria (4 GiB / 1,5 GiB), comprobación de salud y sin puertos publicados.
- Las imágenes propias se construyen para arm64 con GitHub Actions y se publican en GHCR.
- Variables y certificado como variables de entorno de cada aplicación. Copias de seguridad de PostgreSQL desde Dokploy.
- Ollama, si se usa, sería otra Application independiente.

### Mejoras de despliegue incorporadas

El resumen de las decisiones está en [ADR 0018](../../docs/adr/0018-despliegue-en-dokploy.md): versión
exacta de imagen, comprobación de salud y límites de memoria en todos los servicios, infraestructura
descrita y repetible en el repositorio, una sola vía de despliegue, copias de seguridad comprobadas y
métricas visibles antes del primer despliegue.

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
2. Encolar los correos nuevos; procesar con extracción (fase 3) y clasificador (fase 5); guardar la decisión.
3. Registrar los cambios cuyas categorías FOOD BOX/LATERAL/ARCOBETA difieren de la decisión como correcciones.
4. Recuperarse si el `deltaLink` caduca (error 410): nueva sincronización desde el correo registrado más antiguo, para seguir viendo las correcciones de los ya conocidos.
5. Pruebas en local. Alta de los servicios en Dokploy solo cuando el usuario lo autorice (fase 11), con el certificado como secreto y heartbeat en Uptime Kuma.

## Todo

- [x] Sincronización delta con persistencia
- [x] Worker pg-boss
- [x] Registro de correcciones
- [x] Endpoint `/health` del worker (frescura de la sincronización, para Uptime Kuma) y `/livez` (vida del proceso, para el HEALTHCHECK de Docker y Swarm)
- [x] Correcciones de la revisión: `Message` desde la detección con estado, reintentos y reproceso de decisiones degradadas, datos iniciales al arrancar, flujo de publicación que espera al worker sano antes de la web
- [x] Script de alta de servicios en Dokploy (sin ejecutar hasta que el usuario lo autorice)
- [x] Flujo de publicación con etiqueta por commit
- [x] Script de prueba de restauración

## Movido a otras fases

- Validar la sincronización y el cliente de Graph con el buzón real: fase 10.
- Alta en Dokploy (primero en simulación), despliegue y heartbeat en Uptime Kuma: fase 11.
- Programar la prueba mensual de restauración (hoy no está en ningún cron ni workflow): fase 11.

## Success Criteria

Se comprobarán en la fase 11: en producción, cada correo nuevo tiene su decisión registrada en
menos de 5 minutos y el buzón no cambia.

## Risk Assessment

Throttling de Graph con picos de correo: respetar `Retry-After` y limitar la
concurrencia del worker.
