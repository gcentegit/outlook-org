---
title: "Phase 4: Análisis del histórico y reglas iniciales"
status: done
effort: 1.5d
---

# Phase 4: Análisis del histórico y reglas iniciales

## Estado

**Hecha en código**, probada con un buzón simulado. Se construyeron la importación reanudable del
histórico, la muestra estratificada con extracción de adjuntos, la separación en desarrollo y prueba,
la lista de discrepancias, las reglas iniciales (14 reglas fuertes de las siete sociedades) y el
generador de reglas candidatas ([ADR 0011](../../docs/adr/0011-candidatas-de-reglas-del-historico.md)).

**Validación con datos reales: movida a las fases 9 y 10.** La ejecución real sigue bloqueada por el
certificado (fase 1). Además ha cambiado el enfoque: el histórico **no es la verdad de referencia**,
porque el equipo solo a veces pone FOOD BOX y LATERAL (y ARCOBETA no existió hasta el 2026-10-09). Sirve para sacar reglas
candidatas y discrepancias; la verdad es una muestra de unos 200 correos revisada a mano (fase 9).

## Overview

Leer en solo lectura los últimos 6 meses del buzón (≈ 100-500 correos al día,
del orden de 20.000-80.000 correos, cifra a confirmar en la fase 9) y construir con ellos las reglas
iniciales y un material de apoyo para la evaluación.

## Key Insights

- Las categorías puestas a mano por el equipo son una señal **incompleta**, no la etiqueta de verdad
  (decisión del usuario): se revisan las discrepancias antes de contarlas como error.
- Correos sin ninguna de las tres categorías también cuentan: son los negativos, pero pueden ser
  falsos negativos del equipo.
- ARCOBETA es una categoría nueva: no hay histórico etiquetado.
- El histórico puede estar incompleto: en la captura, un correo de "Lateral Arturo Soria" lleva "Pte ok" y "Elena" pero no LATERAL.
- Los correos clasificados pueden haberse movido a subcarpetas (Archivo, 347…):
  recorrer todas las carpetas, no solo la Bandeja de entrada.

## Requirements

- Datos del usuario en [docs/referencia/sociedades-categorias.md](../../docs/referencia/sociedades-categorias.md): 7 sociedades con CIF y razón social (solo la hoja "Resumen" del Excel; se ignoran locales y códigos de pedido). Las palabras clave se sacan del histórico.
- Script idempotente y reanudable (guarda progreso).
- Respetar los límites de Graph (reintentos con `Retry-After`).
- Los resultados con datos de terceros van a `data/history/` (ignorado por git).

## Related Code Files

Crear: `scripts/import-history.ts`, `scripts/rule-candidates.ts`, `src/rules/seed.ts`.

## Implementation Steps

1. Importar metadatos y categorías de los últimos 6 meses de todas las carpetas.
2. Extraer el texto de los adjuntos solo de una muestra estratificada (positivos de cada categoría, varias a la vez, ninguna), unos 1.500 correos, para no saturar docling.
3. Separar en conjunto de desarrollo (70 %) y de prueba (30 %) por fecha.
4. Cargar las reglas desde la hoja "Resumen" de `docs/referencia/sociedades-categorias.md` con un script de semilla: CIF y razón social de las 7 sociedades.
5. Generar reglas candidatas: palabras clave del asunto y el cuerpo, remitentes y dominios cuyo histórico es ≥ 98 % de una categoría, con un mínimo de apariciones.
6. Revisar las candidatas con el usuario antes de activarlas.

## Todo

- [x] Recibir CIF, razones sociales y locales
- [x] Código de importación del histórico, de muestra con adjuntos y de reglas candidatas (probado con buzón simulado)
- [x] Reglas iniciales cargadas por la semilla

## Movido a otras fases

- Ejecutar la importación real del histórico: fase 10 (el recuento previo del buzón, en la fase 9).
- Muestra con adjuntos extraídos sobre datos reales: fase 10.
- Revisar con el usuario las reglas candidatas y activar las que valgan: fase 10.
- Conjunto de evaluación: pasa a ser la muestra de unos 200 correos revisada a mano, que se construye
  en la fase 9.

## Success Criteria

Reglas iniciales en la tabla `rules`, aprobadas por el usuario (conseguido para las 14 reglas por
CIF y razón social). Las candidatas del histórico se aprobarán en la fase 10.

## Risk Assessment

Etiquetado histórico inconsistente (el equipo no siempre etiqueta igual): las
discrepancias se revisan con el usuario y no se toman como fallo del sistema sin mirarlas.
