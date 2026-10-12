---
title: "Phase 9: Descubrimiento y verdad de referencia"
status: done
effort: 1d
---

# Phase 9: Descubrimiento y verdad de referencia

## Estado

**Hecha** (2026-10-10). Resultados y decisiones en el
[informe de descubrimiento](../reports/descubrimiento-261010-0900-fase-9-buzon-real.md). La
verdad de referencia pasa a ser la carpeta donde el equipo archiva cada correo, más una revisión
corta de los dudosos; la revisión a mano fue parcial.

## Overview

Lo primero que se ejecuta al tener el certificado (fase 1), **de solo lectura**: medir cómo es
realmente el buzón y construir la verdad contra la que se medirá el acierto. Hoy el equipo pone las
etiquetas FOOD BOX y LATERAL solo a veces y ARCOBETA no existió hasta el 2026-10-09, así que el histórico no vale
como verdad.

## Key Insights

- El acierto se mide contra una **muestra de unos 200 correos revisada a mano** con el usuario, no
  contra el histórico. El histórico sirve para sacar reglas candidatas y discrepancias.
- Los números que salgan de aquí fijan los umbrales: sobre todo la cobertura mínima por categoría,
  que el criterio de aceptación deja como decisión pendiente.
- Sin esta fase, un sistema que etiquetara el 5 % de los correos con un 100 % de precisión parecería
  cumplir el criterio.

## Requirements

- Solo lectura sobre el buzón: no se escribe ninguna categoría ni se crea nada.
- Medir, sobre una ventana de tiempo representativa:
  - correos al día;
  - porcentaje con adjuntos;
  - porcentaje con alguna de las tres categorías;
  - porcentaje con un CIF del grupo en el adjunto;
  - cuántos adjuntos son `.eml` o `.msg` (hoy no soportados).
- Una muestra de unos 200 correos, estratificada (cada categoría, varias a la vez, ninguna),
  revisada a mano con el usuario: la categoría correcta de cada uno.
- Los datos de terceros (la muestra, los recuentos por remitente) se guardan en `data/history/`,
  nunca en `plans/` ni en git.

## Related Code Files

Se parte de la importación existente (`apps/worker/scripts/import-history.ts` y
`apps/worker/src/history/`). Los recuentos se obtienen de sus resultados en `data/history/`; no se
añade funcionalidad a la aplicación.

## Implementation Steps

1. Con el certificado y la guía de la fase 1 aplicada, ejecutar la importación del histórico en solo
   lectura.
2. Calcular los recuentos de los requisitos y anotarlos.
3. Construir la muestra de ~200 correos y revisarla a mano con el usuario.
4. Con los datos, decidir con el usuario los umbrales: cobertura mínima por categoría y cómo se mide
   el modo sombra (revisión semanal de una muestra en el panel, ya que el equipo no etiqueta
   siempre).
5. Redactar el informe.

## Todo

- [x] Importación del histórico en solo lectura
- [x] Correos al día
- [x] Porcentaje con adjuntos
- [x] Porcentaje con alguna de las tres categorías
- [x] Porcentaje con un CIF del grupo en el adjunto
- [x] Recuento de adjuntos `.eml` y `.msg`
- [x] Muestra revisada con el usuario: la carpeta como verdad y 80 dudosos, revisados en parte (decisión del 2026-10-09)
- [x] Informe (datos de terceros en `data/history/`, resumen sin datos personales en `plans/reports/`)
- [x] Decisión de los umbrales: cobertura ≥ 90 % para FOOD BOX y LATERAL; ARCOBETA sin mínimo por ahora

## Success Criteria

Existe un informe con los recuentos y una muestra revisada a mano que sirve de verdad de referencia,
y el usuario ha decidido la cobertura mínima por categoría.

## Risk Assessment

- Si casi ningún correo lleva un CIF del grupo en el adjunto, las reglas por CIF cubrirán poco y el
  LLM pesará más de lo previsto (coste y privacidad): se vería aquí, antes de desplegar.
- Revisar 200 correos exige tiempo del usuario o del equipo: acordar quién y cuándo.

## Security Considerations

Lectura de datos de terceros: la muestra y los listados se quedan en `data/history/` (ignorado por
git); el informe versionado solo lleva cifras agregadas.
