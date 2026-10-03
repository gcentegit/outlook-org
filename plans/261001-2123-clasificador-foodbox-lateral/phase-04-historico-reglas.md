---
title: "Phase 4: Análisis del histórico y reglas iniciales"
status: in-progress
effort: 1.5d
---

# Phase 4: Análisis del histórico y reglas iniciales

## Overview

Leer en solo lectura los últimos 6 meses del buzón (≈ 100-500 correos al día,
del orden de 20.000-80.000 correos) y construir con ellos el conjunto de
evaluación y las reglas iniciales.

## Key Insights

- Las categorías puestas a mano por el equipo son la etiqueta de verdad.
- Correos sin ninguna de las tres categorías también cuentan: son los negativos.
- ARCOBETA es una categoría nueva: no hay histórico etiquetado. Se evalúa sobre una muestra etiquetada a mano con el usuario o solo en modo sombra.
- El histórico puede estar incompleto: en la captura, un correo de "Lateral Arturo Soria" lleva "Pte ok" y "Elena" pero no LATERAL. Las discrepancias se revisan antes de contarlas como error.
- Los correos clasificados pueden haberse movido a subcarpetas (Archivo, 347…):
  recorrer todas las carpetas, no solo la Bandeja de entrada.

## Requirements

- Datos del usuario en [docs/sociedades-categorias.md](../../docs/sociedades-categorias.md): 7 sociedades con CIF y razón social (solo la hoja "Resumen" del Excel; se ignoran locales y códigos de pedido). Las palabras clave se sacan del histórico.
- Script idempotente y reanudable (guarda progreso).
- Respetar los límites de Graph (reintentos con `Retry-After`).

## Related Code Files

Crear: `scripts/import-history.ts`, `scripts/rule-candidates.ts`, `src/rules/seed.ts`.

## Implementation Steps

1. Importar metadatos y categorías de los últimos 6 meses de todas las carpetas.
2. Extraer el texto de los adjuntos solo de una muestra estratificada (positivos de cada categoría, varias a la vez, ninguna), unos 1.500 correos, para no saturar docling.
3. Separar en conjunto de desarrollo (70 %) y de prueba (30 %) por fecha.
4. Cargar las reglas desde la hoja "Resumen" de `docs/sociedades-categorias.md` con un script de semilla: CIF y razón social de las 7 sociedades.
5. Generar reglas candidatas: palabras clave del asunto y el cuerpo, remitentes y dominios cuyo histórico es ≥ 98 % de una categoría, con un mínimo de apariciones.
6. Revisar las candidatas con el usuario antes de activarlas.

## Todo

- [x] Recibir CIF, razones sociales y locales
- [ ] Importación del histórico (código listo y probado con buzón simulado; ejecución real bloqueada por el certificado)
- [ ] Muestra con adjuntos extraídos (código listo)
- [ ] Reglas candidatas revisadas con el usuario

## Success Criteria

Conjunto de evaluación etiquetado y reglas iniciales en la tabla `rules`,
aprobadas por el usuario.

## Risk Assessment

Etiquetado histórico inconsistente (el equipo no siempre etiqueta igual): las
discrepancias se revisan con el usuario y no se toman como fallo del sistema sin mirarlas.
