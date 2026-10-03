---
title: "Phase 8: Repositorio, versionado y documentación"
status: in-progress
effort: 1d
---

# Phase 8: Repositorio, versionado y documentación

## Overview

Dejar el repositorio listo para mantenerse mientras se espera al buzón real: documentación por temas,
registros de decisión, reglas para agentes y personas, y versionado con SemVer. **No depende del
buzón ni cambia el código de la aplicación.** Se reparte en dos pull requests: el de documentación y
plan (este) y el de versionado y flujo de GitHub.

## Key Insights

- Se construyó antes de validar con datos reales; hasta tenerlos, solo se toca estructura, versionado
  y documentación (no se añade funcionalidad nueva).
- Versionado con release-please y SemVer: serie `0.x` mientras el servicio solo funcione en sombra; la
  **`1.0.0`** será la primera versión que escriba categorías en el buzón (fase 12). El proceso lo
  describe [versiones y releases](../../docs/operacion/versiones-y-releases.md).
- El repositorio sigue siendo público: ninguna dirección real ni detalles internos de otros proyectos
  ([ADR 0022](../../docs/adr/0022-repositorio-publico-y-direcciones-reales.md)).

## Requirements

- `docs/` organizado por tema con un índice, sin duplicar lo que ya dice el código.
- Reglas del proyecto para agentes y personas en `CLAUDE.md`, con `AGENTS.md` remitiendo a él.
- Flujo de versiones y releases documentado y automatizado, sin tocar el comportamiento del servicio.

## Related Code Files

Documentación: `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`, `plans/`. Versionado:
`.github/`, `package.json`, `CHANGELOG.md`.

## Todo

Pull request de documentación y plan (esta rama):

- [x] Informe con detalles de otro proyecto fuera de `main` y de su historial (ignorado en git; `main` se rehízo con un primer commit limpio)
- [ ] Borrar la rama antigua `feat/clasificador-foodbox-lateral` del remoto, que aún contiene ese informe (pendiente de que el usuario lo autorice)
- [x] Informes versionados revisados con el criterio de repositorio público: quitados los nombres de servicios y rutas de otro proyecto
- [x] `docs/README.md`, `docs/arquitectura.md` y `docs/adr/` (el antiguo `DECISIONS.md` queda dividido por tema y desaparece)
- [x] Guía de Entra ID y tabla de sociedades movidas a `docs/guias/` y `docs/referencia/`
- [x] `docs/operacion/`: despliegue, copias y restauración, credenciales y caducidades
- [x] `README.md` actualizado, con el aviso de derechos reservados
- [x] `CLAUDE.md` y `AGENTS.md`
- [x] Plan revisado: fases 2 a 7 cerradas en código y fases 8 a 12

Pull request de versionado y flujo de GitHub (otro agente; sin marcar hasta que se fusione):

- [x] `main` protegida: solo pull request con la CI en verde
- [x] Commits convencionales validados en los pull requests
- [x] release-please con una única versión para todo el producto (serie `0.x`)
- [x] `CHANGELOG.md` y Release de GitHub con las notas de cada versión
- [x] Etiqueta de imagen `X.Y.Z` sin reconstruir, y versión (`X.Y.Z` y sha) visible en `/health` y en el panel
- [x] `docs/operacion/versiones-y-releases.md`
- [x] Dependabot, plantilla de pull request y alertas de secretos con bloqueo en la subida

## Success Criteria

Una persona o un agente nuevo encuentra, desde `README.md` y `CLAUDE.md`, dónde está cada cosa y qué
reglas no se pueden romper; cada versión publicada tiene etiqueta, Release y notas; ningún enlace
relativo de la documentación está roto.

## Risk Assessment

- La documentación vuelve a quedar obsoleta: el código es la fuente de lo que hace el sistema y los
  documentos solo enlazan a él.
- Un cambio incompatible mal etiquetado sube una versión equivocada: se define qué es incompatible
  en [versiones y releases](../../docs/operacion/versiones-y-releases.md).
