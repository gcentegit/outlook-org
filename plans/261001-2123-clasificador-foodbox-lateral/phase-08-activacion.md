---
title: "Phase 8: Evaluación y activación live"
status: todo
effort: 1d (+ 2 semanas de observación)
---

# Phase 8: Evaluación y activación live

## Overview

Dos semanas de modo sombra comparando con lo que hace el equipo. Después se
activa el `PATCH` por categoría, empezando por la que mejor acierte.

## Key Insights

- `PATCH /messages/{id}` con `categories` **reemplaza** la lista entera. Hay que
  leer las categorías actuales justo antes y añadir las nuevas sin quitar ninguna.
- Si el equipo ya puso la categoría, no se toca. Las correcciones manuales prevalecen.
- Si el equipo quita una categoría que puso el servicio, no se vuelve a poner.

## Requirements

- Umbral acordado: precisión ≥ 95 % por categoría tras dos semanas en sombra.
- Los interruptores sombra/live son los del panel (fase 7).

- Informe del modo sombra: precisión y cobertura por categoría, lista de discrepancias.

## Related Code Files

Crear: `src/graph/apply-categories.ts`, `scripts/shadow-report.ts`.

## Implementation Steps

1. Informe de sombra a las dos semanas; revisar las discrepancias con el usuario.
2. Ajustar reglas y umbral.
3. Implementar el `PATCH` con fusión de categorías y control de concurrencia.
4. Activar la primera categoría; observar una semana; activar la segunda.

## Todo

- [ ] Informe de modo sombra
- [ ] Ajuste de reglas
- [ ] `PATCH` con fusión
- [ ] Activación progresiva

## Success Criteria

Precisión ≥ 95 % por categoría en sombra y aprobación del usuario antes de
activar; ninguna categoría puesta por personas se pierde.

## Risk Assessment

Mala clasificación visible para todo el equipo: el interruptor de vuelta a
sombra y el registro de decisiones permiten revertir y auditar.
