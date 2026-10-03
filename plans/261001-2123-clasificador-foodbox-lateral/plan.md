---
title: "Clasificador del buzón de Proveedores: FOOD BOX, LATERAL y ARCOBETA"
description: "Servicio y panel que detectan los correos del buzón compartido de Proveedores que corresponden a FOOD BOX, LATERAL o ARCOBETA, les aplican esa categoría con Microsoft Graph y miden el acierto."
status: in-progress
priority: P1
effort: 13d
tags: [feature, backend, frontend, api, infra]
blockedBy: []
blocks: []
created: 2026-10-01
---

# Clasificador del buzón de Proveedores: FOOD BOX, LATERAL y ARCOBETA

## Overview

Primer alcance del clasificador descrito en
el brief interno (`docs/privado/clasificador-proveedores.md`, fuera del repositorio). Solo se
automatizan tres categorías, **FOOD BOX**, **LATERAL** y **ARCOBETA**, en el
buzón compartido `<MAILBOX>`. Un correo puede llevar varias, una
o ninguna. La sociedad facturada decide la categoría: FOODBOX → FOOD BOX,
ARCO BETA → ARCOBETA, y las sociedades con "Lateral" en su nombre → LATERAL
([docs/sociedades-categorias.md](../../docs/sociedades-categorias.md)). Las
reglas (CIF y razón social de la sociedad facturada en el PDF, palabras clave del
asunto y el cuerpo) deciden primero. Un LLM, elegible desde el panel, resuelve
los casos que las reglas no deciden. Un panel web muestra el volumen, la
cobertura y el acierto.

## Contrato

- **Resultado:** cada correo que llega a la Bandeja de entrada, interno o
  externo, queda propuesto (modo sombra) o etiquetado (modo live) con FOOD BOX,
  LATERAL y/o ARCOBETA. Cada decisión queda registrada y es auditable. Un panel muestra
  las métricas y permite elegir el proveedor y el modelo de LLM.
- **Restricciones:** solo CPU; Dokploy en Oracle arm64 (4 CPU, ~23 GiB);
  app con certificado y RBAC for Applications limitado al buzón; Prisma como en
  CPA; RGPD (no usar proveedores que entrenen con los datos); nunca quitar
  categorías puestas por personas.
- **Fuera de alcance:** el resto de categorías (responsables, estados,
  ALQUILERES, PRESUPUESTO, TESORERIA, FRANQUICIA, Mini…), la edición de reglas
  desde el panel y los webhooks.
- **Aceptación:** precisión ≥ 95 % por categoría sobre el histórico de 6 meses y
  tras dos semanas en modo sombra; ninguna categoría puesta por personas se
  pierde; el panel muestra las métricas y el cambio de modelo surte efecto sin
  redesplegar.

## Decisiones tomadas

- Correos dudosos: se dejan sin categoría y se registran.
- Hilos: una respuesta hereda FOOD BOX/LATERAL/ARCOBETA de un correo anterior de la misma conversación (con las categorías finales del equipo); si no hay, se analiza. Una regla fuerte (CIF o razón social) del propio correo gana a la herencia (decisión del 2026-10-02).
- Los correos se quedan en la Bandeja de entrada al llegar: solo se sigue esa carpeta.
- Texto extraído de adjuntos: se conserva 90 días. Las decisiones se conservan siempre.
- Repositorio de GitHub público (imágenes en GHCR públicas; runner arm64 gratuito).
- La prueba mensual de restauración de copias se programa en el mismo servidor de Dokploy.
- Nada se sube a Dokploy hasta que el usuario lo autorice: desarrollo y pruebas en local.
- En Dokploy, cada pieza es un servicio independiente (web, worker, docling y PostgreSQL nativo), sin Compose, igual que el proyecto `cpa.arcofood`. Compose solo para desarrollo local.
- Categorías: el panel permite ver la lista maestra del buzón y crear categorías nuevas (nombre y color) con confirmación, a través del worker (la web no tiene el certificado de Graph). No renombra ni borra.
- Panel en `https://clasificador.arcofood.com`, con SSO de Microsoft y una lista de usuarios autorizados (al principio solo `<ADMIN_EMAIL>`); el acceso se ata al `oid` y al `tid` de Microsoft, no solo al email.
- Métrica de acierto: solo cuentan los correos que el equipo ha revisado; los demás se muestran aparte como pendientes de revisar.
- Candidatas de reglas: nunca de dominio entero para correo público ni para dominios del grupo (decisión del 2026-10-02).

## Pendiente del usuario

- [ ] Generar el certificado (`infra/scripts/generate-cert.sh`) y seguir `docs/guia-entra-id-rbac.md` (fase 1). Aplazado por el usuario el 2026-10-02; bloquea las pruebas contra el buzón real (fases 3, 4 y 6), no el desarrollo en local.
- [ ] Crear la categoría ARCOBETA (desde el panel o en Outlook) antes de la fase 6.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Acceso a Microsoft 365 y cuentas](./phase-01-acceso-microsoft-365.md) | In progress (guía lista; certificado aplazado) |
| 2 | [Base del proyecto e infraestructura](./phase-02-base-proyecto.md) | Done |
| 3 | [Extracción de correo y adjuntos](./phase-03-extraccion.md) | In progress (código listo; falta prueba real) |
| 4 | [Análisis del histórico y reglas iniciales](./phase-04-historico-reglas.md) | In progress (código listo; falta ejecución real) |
| 5 | [Clasificador: reglas + LLM configurable](./phase-05-clasificador.md) | In progress (código listo; falta evaluación real) |
| 6 | [Servicio en modo sombra y despliegue](./phase-06-servicio-sombra.md) | In progress (código e infra listos; despliegue pendiente de autorización y credenciales) |
| 7 | [Panel de métricas y configuración](./phase-07-panel.md) | In progress |
| 8 | [Evaluación y activación live](./phase-08-activacion.md) | Pending |

## Dependencies

- Fase 1 bloquea todo lo que lee el buzón (3, 4, 6) y el login del panel (7).
- Fase 2 es independiente de la 1.
- Fase 7 depende de las tablas de decisiones (5 y 6).
- Datos fiscales: solo la hoja "Resumen" de `docs/privado/datos-fiscales.xlsx` (fuera del repositorio; resumen público en [docs/sociedades-categorias.md](../../docs/sociedades-categorias.md)) (7 sociedades con CIF); sin códigos de pedido. Palabras clave a partir del histórico.
- La categoría ARCOBETA debe existir en la lista maestra del buzón antes de la fase 6. Se puede crear desde el panel (fase 7) o a mano en Outlook; el clasificador nunca crea categorías por su cuenta.

## Success Criteria

- [ ] La app solo puede leer el buzón de Proveedores (comprobado con `Test-ServicePrincipalAuthorization`).
- [ ] Informe de evaluación del histórico con precisión y cobertura por categoría.
- [ ] Servicio desplegado en Dokploy, en modo sombra, con heartbeat en Uptime Kuma.
- [ ] Panel accesible por SSO con métricas y selector de modelo.
- [ ] Informe de dos semanas de modo sombra aprobado antes de pasar a live.

<!-- slug: clasificador-foodbox-lateral -->
