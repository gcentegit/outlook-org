---
title: "Phase 12: Activación real (1.0.0)"
status: todo
effort: 1d (+ 1 semana de observación por categoría)
---

# Phase 12: Activación real (1.0.0)

## Overview

Tras las dos semanas de modo sombra (fase 11) se activa el `PATCH` por categoría, empezando por la que
mejor acierte. **Publicar esta fase es la versión 1.0.0**: la primera que escribe categorías en el
buzón ([versiones y releases](../../docs/operacion/versiones-y-releases.md)).

## Key Insights

- `PATCH /messages/{id}` con `categories` **reemplaza** la lista entera. Hay que
  leer las categorías actuales justo antes y añadir las nuevas sin quitar ninguna.
- Si el equipo ya puso la categoría, no se toca. Las correcciones manuales prevalecen.
- Si el equipo quita una categoría que puso el servicio, no se vuelve a poner.
- Es un cambio en lo que el servicio hace en el buzón: por eso es el cambio incompatible que sube a
  la versión mayor.

## Requirements

- Depende de la fase 11 con el informe de sombra aprobado.
- Umbral acordado: precisión ≥ 95 % por categoría medida contra la muestra revisada a mano **y**
  la cobertura mínima por categoría fijada con los datos de la fase 9.
- Los interruptores sombra/live son los del panel (fase 7).
- Copia de seguridad previa a cualquier migración.

## Related Code Files

Crear: `src/graph/apply-categories.ts`. Cambiar el worker para que acepte `MODE=live` por categoría.

## Implementation Steps

1. Revisar con el usuario las discrepancias del informe de sombra; ajustar reglas y umbral si hace
   falta.
2. Implementar el `PATCH` con fusión de categorías y control de concurrencia, y levantar el bloqueo
   de `MODE=live`.
3. Activar la primera categoría; observar una semana; activar la segunda y la tercera.
4. Publicar la versión 1.0.0 con su Release y sus notas.

## Todo

- [ ] Discrepancias del informe de sombra revisadas y reglas ajustadas
- [x] `PATCH` con fusión de categorías y control de concurrencia (`If-Match`), registro de lo escrito en `AppliedCategory` para no volver a poner lo que quite el equipo, y solo las categorías en live: preparado el 2026-10-12 y desplegado en la 0.7.0 el 2026-10-13, bloqueado mientras `MODE=live` no arranque
- [ ] Comprobar en el buzón real, con un correo de prueba, que Graph devuelve el etag con `$select=categories` y qué responde un `PATCH` con un etag viejo (412 o 409). Script preparado el 2026-10-16: `apps/worker/scripts/write-check.ts` (escribe en el correo de prueba y lo deja como estaba; necesita autorización)
- [ ] Decidir si se piden ids inmutables (`Prefer: IdType="ImmutableId"`): un correo que sale de la Bandeja de entrada y vuelve cambia de id y pierde su registro de categorías escritas
- [x] Anotación de lo escrito (2026-10-16): si el `PATCH` acaba de forma incierta (red, token, 5xx, 429, conflictos agotados), se relee el correo y solo queda anotado lo que tiene; lo demás se reintenta en el reproceso. Sin migración
- [ ] Revisar que una corrección vigente se actualice si el equipo vuelve a poner una categoría que el servicio escribió y luego quitó (`corrections.ts`)
- [ ] Quitar el bloqueo de `MODE=live` (`assertSupportedMode`) con la autorización del usuario, copia de seguridad antes de desplegar (la versión trae la migración de `AppliedCategory`) y una prueba con un correo de prueba del buzón
- [ ] Activación progresiva por categoría
- [ ] Publicación de la versión 1.0.0

## Success Criteria

Precisión ≥ 95 % por categoría y cobertura mínima cumplida, con aprobación del usuario antes de
activar; ninguna categoría puesta por personas se pierde.

## Risk Assessment

Mala clasificación visible para todo el equipo: el interruptor de vuelta a
sombra y el registro de decisiones permiten revertir y auditar.
