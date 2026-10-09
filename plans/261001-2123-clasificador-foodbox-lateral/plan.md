---
title: "Clasificador del buzón de Proveedores: FOOD BOX, LATERAL y ARCOBETA"
description: "Servicio y panel que detectan los correos del buzón compartido de Proveedores que corresponden a FOOD BOX, LATERAL o ARCOBETA, les aplican esa categoría con Microsoft Graph y miden el acierto."
status: in-progress
priority: P1
effort: 19d
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
([docs/referencia/sociedades-categorias.md](../../docs/referencia/sociedades-categorias.md)). Las
reglas (CIF y razón social de la sociedad facturada en el PDF, palabras clave del
asunto y el cuerpo) deciden primero. Un LLM, elegible desde el panel, resuelve
los casos que las reglas no deciden. Un panel web muestra el volumen, la
cobertura y el acierto.

**Estado:** las fases 2 a 7 están construidas en código y probadas con datos simulados; ninguna está
validada con el buzón real ni desplegada. Lo que falta es acceso al buzón (fase 1, pendiente del
usuario), descubrimiento, validación con datos reales, despliegue en sombra y activación.
Cómo funciona el sistema hoy: [docs/arquitectura.md](../../docs/arquitectura.md).

## Contrato

- **Resultado:** cada correo que llega a la Bandeja de entrada, interno o
  externo, queda propuesto (modo sombra) o etiquetado (modo live) con FOOD BOX,
  LATERAL y/o ARCOBETA. Cada decisión queda registrada y es auditable. Un panel muestra
  las métricas y permite elegir el proveedor y el modelo de LLM.
- **Restricciones:** solo CPU; Dokploy en Oracle arm64 (4 CPU, ~23 GiB);
  app con certificado y RBAC for Applications limitado al buzón; Prisma 7;
  RGPD (no usar proveedores que entrenen con los datos); nunca quitar
  categorías puestas por personas.
- **Fuera de alcance:** el resto de categorías (responsables, estados,
  ALQUILERES, PRESUPUESTO, TESORERIA, FRANQUICIA, Mini…), la edición de reglas
  desde el panel y los webhooks.
- **Aceptación:** precisión ≥ 95 % por categoría medida contra la **muestra de unos 200 correos
  revisada a mano** (fase 9), **y** una cobertura mínima por categoría (porcentaje de los correos de
  esa sociedad que se etiquetan) que se fijará con los datos de la fase 9, tanto en la validación
  como tras dos semanas en modo sombra; ninguna categoría puesta por personas se pierde; el panel
  muestra las métricas y el cambio de modelo surte efecto sin redesplegar.

## Decisiones tomadas

- Correos dudosos: se dejan sin categoría y se registran.
- Hilos: una respuesta hereda FOOD BOX/LATERAL/ARCOBETA de un correo anterior de la misma conversación (con las categorías finales del equipo); si no hay, se analiza. Una regla fuerte (CIF o razón social) del propio correo gana a la herencia (decisión del 2026-10-02).
- Los correos se quedan en la Bandeja de entrada al llegar: solo se sigue esa carpeta.
- Texto extraído de adjuntos: se conserva 90 días. Remitentes, asuntos y decisiones: 12 meses (decisión del 2026-10-03; el borrado automático se implementa en la fase 10; hasta entonces no se borran).
- Repositorio de GitHub público (imágenes en GHCR públicas; runner arm64 gratuito).
- La prueba mensual de restauración de copias se programa en el mismo servidor de Dokploy.
- Nada se sube a Dokploy hasta que el usuario lo autorice: desarrollo y pruebas en local.
- En Dokploy, cada pieza es un servicio independiente (web, worker, docling y PostgreSQL nativo), sin Compose, como en otro proyecto del mismo servidor. Compose solo para desarrollo local.
- Categorías: el panel permite ver la lista maestra del buzón y crear categorías nuevas (nombre y color) con confirmación, a través del worker (la web no tiene el certificado de Graph). No renombra ni borra.
- Panel en `https://clasificador.arcofood.com`, con SSO de Microsoft y una lista de usuarios autorizados (al principio solo `<ADMIN_EMAIL>`); el acceso se ata al `oid` y al `tid` de Microsoft, no solo al email.
- Métrica de acierto: solo cuentan los correos que el equipo ha revisado; los demás se muestran aparte como pendientes de revisar.
- Candidatas de reglas: nunca de dominio entero para correo público ni para dominios del grupo (decisión del 2026-10-02).
- **Verdad de referencia (decisión del 2026-10-03):** el equipo pone hoy las etiquetas FOOD BOX y LATERAL solo a veces y ARCOBETA no existe todavía. El acierto se mide contra una muestra de unos 200 correos revisada a mano; el histórico sirve para sacar reglas candidatas y discrepancias.
- **Versionado (decisión del 2026-10-03):** release-please y SemVer. Serie `0.x` mientras el servicio solo funcione en sombra; la `1.0.0` será la primera versión que escriba categorías en el buzón (fase 12).
- **Sin funcionalidad nueva hasta validar con datos reales:** los riesgos de operación (caducidades, gasto del LLM, retención, adjuntos `.eml`/`.msg`) son tareas de la fase 10, no se implementan antes.
- Umbrales acordados que no cambian sin decisión del usuario: confianza 0,8, precisión 95 %, retención de adjuntos 90 días, modo sombra obligatorio hasta la fase 12.

## Pendiente del usuario

- [ ] Generar el certificado (`infra/scripts/generate-cert.sh`; hecho el 2026-10-03) y seguir la [guía de Entra ID y RBAC](../../docs/guias/entra-id-rbac.md) (fase 1). Aplazado por el usuario el 2026-10-02; bloquea todo lo que lee el buzón real (fases 9 a 11) y el login del panel, no el desarrollo en local.
- [ ] Revisar a mano la muestra de ~200 correos (fase 9) y decidir con los datos la cobertura mínima por categoría.
- [ ] Anotar en el registro de actividades de tratamiento de la empresa el plazo de conservación decidido (12 meses para remitentes, asuntos y decisiones; 90 días para el texto de adjuntos).
- [x] Crear la categoría ARCOBETA (desde el panel o en Outlook) antes de la fase 11. Creada el 2026-10-09.
- [x] Designar quién atiende los avisos de Uptime Kuma: el administrador (decidido el 2026-10-09).
- [ ] Acordar cómo y cuándo se informa al equipo de Proveedores (fase 11).
- [ ] Autorizar el alta y el despliegue en Dokploy (fase 11).

## Phases

| # | Phase | Status | Effort | Depende de |
|---|-------|--------|--------|------------|
| 1 | [Acceso a Microsoft 365 y cuentas](./phase-01-acceso-microsoft-365.md) | Pending (user: certificate postponed) | 0.5d | Nada |
| 2 | [Base del proyecto e infraestructura](./phase-02-base-proyecto.md) | Done | 1.5d | Nada |
| 3 | [Extracción de correo y adjuntos](./phase-03-extraccion.md) | Done in code (real validation in phase 10) | 1.5d | 2 |
| 4 | [Análisis del histórico y reglas iniciales](./phase-04-historico-reglas.md) | Done in code (real validation in phases 9 and 10) | 1.5d | 2, 3 |
| 5 | [Clasificador: reglas + LLM configurable](./phase-05-clasificador.md) | Done in code (real validation in phase 10) | 2d | 3 |
| 6 | [Servicio en modo sombra y despliegue](./phase-06-servicio-sombra.md) | Done in code (deployment in phase 11) | 1.5d | 3, 5 |
| 7 | [Panel de métricas y configuración](./phase-07-panel.md) | Done in code (real validation in phases 10 and 11) | 2.5d | 5, 6 |
| 8 | [Repositorio, versionado y documentación](./phase-08-repositorio-versionado-y-documentacion.md) | Done | 1d | Nada |
| 9 | [Descubrimiento y verdad de referencia](./phase-09-descubrimiento-y-verdad-de-referencia.md) | Pending | 1d | 1 |
| 10 | [Validación con datos reales](./phase-10-validacion-con-datos-reales.md) | Pending | 4d | 1, 9 |
| 11 | [Despliegue en sombra y observación](./phase-11-despliegue-en-sombra-y-observacion.md) | Pending | 1d + 2 semanas | 10 |
| 12 | [Activación real (1.0.0)](./phase-12-activacion-real.md) | Pending | 1d + 1 semana por categoría | 11 |

Esfuerzo total estimado: 19 días de trabajo (11,5 ya construidos; unos 7,5 pendientes, más las
semanas de observación).

## Dependencies

- La fase 1 (usuario) bloquea todo lo que lee el buzón real: 9, 10 y 11, y el login real del panel.
- La fase 2 es independiente de la 1; las fases 3 a 7 se construyeron en local sin ella.
- La fase 8 (repositorio, versionado y documentación) no dependía del buzón y está hecha.
- La fase 9 va primero al tener el certificado y es de solo lectura; sus números fijan los umbrales.
- La fase 10 necesita la 9 (muestra revisada a mano) y es la primera que puede añadir funcionalidad.
- La fase 11 necesita la 10 y la autorización del usuario; la 12 necesita el informe de sombra aprobado.
- Datos fiscales: solo la hoja "Resumen" de `docs/privado/datos-fiscales.xlsx` (fuera del repositorio; resumen público en [docs/referencia/sociedades-categorias.md](../../docs/referencia/sociedades-categorias.md)) (7 sociedades con CIF); sin códigos de pedido. Palabras clave a partir del histórico.
- La categoría ARCOBETA debía existir en la lista maestra del buzón antes de la fase 11: el usuario la creó el 2026-10-09. El clasificador nunca crea categorías por su cuenta.

## Success Criteria

- [ ] La app solo puede leer el buzón de Proveedores (comprobado con `Test-ServicePrincipalAuthorization`).
- [ ] Informe de descubrimiento y muestra de ~200 correos revisada a mano, con la cobertura mínima por categoría decidida.
- [ ] Informe de evaluación contra la muestra con precisión y cobertura por categoría, con y sin LLM.
- [ ] Servicio desplegado en Dokploy, en modo sombra, con heartbeat en Uptime Kuma.
- [ ] Panel accesible por SSO con métricas y selector de modelo.
- [ ] Informe de dos semanas de modo sombra aprobado antes de pasar a live.
- [ ] Versión 1.0.0 publicada con la activación real.

<!-- slug: clasificador-foodbox-lateral -->
