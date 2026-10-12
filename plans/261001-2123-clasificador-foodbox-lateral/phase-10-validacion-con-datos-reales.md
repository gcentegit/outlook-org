---
title: "Phase 10: Validación con datos reales"
status: in-progress
effort: 4d
---

# Phase 10: Validación con datos reales

## Overview

Comprobar con el buzón real todo lo que hasta ahora solo se ha probado con datos simulados (fases 3 a
7) y cerrar los riesgos de operación que obligan a tocar código. Es la primera fase en la que se puede
añadir funcionalidad nueva, porque ya hay datos que la justifiquen.

## Key Insights

- Hasta ahora nada se ha probado contra el buzón real: formato de los adjuntos en Graph, calidad del
  OCR con facturas reales, cuántos correos resuelven las reglas solas y qué papel tiene el LLM.
- El acierto se mide contra la muestra revisada a mano de la fase 9, no contra el histórico.
- Las tareas de riesgo de operación se priorizan con lo medido: por ejemplo, el soporte de adjuntos
  `.eml` y `.msg` depende de cuántos haya.

## Requirements

- Depende de las fases 1 y 9.
- Precisión ≥ 95 % por categoría contra la muestra, y la cobertura mínima fijada en la fase 9
  (con y sin LLM).

## Implementation Steps

1. Prueba de extracción con 20 facturas reales (mezcla de digitales y escaneadas de las tres
   categorías): CIF del cliente en ≥ 19 de 20 y tiempo medio por documento en arm64.
2. Importación del histórico completo y generación de reglas candidatas; revisarlas con el usuario y
   activar las que valgan.
3. Evaluación contra la muestra revisada a mano, **con y sin LLM**, y comparación de al menos dos
   modelos (precisión, cobertura, coste, latencia).
4. Validar el cliente de Graph con el buzón real y el login con Microsoft real (app de login de la
   guía de Entra ID).
5. Ajustar reglas y umbral con las discrepancias.
6. Tareas de riesgo de operación (abajo), en el orden que marquen los datos.

## Todo

Validación:

- [x] Prueba de extracción con facturas reales e informe: 69 de 70 con el CIF del grupo ([informe](../reports/validacion-261012-1415-extraccion-facturas-reales.md))
- [ ] Importación real del histórico y reglas candidatas revisadas con el usuario
- [ ] Evaluación contra la muestra, con y sin LLM, y comparativa de al menos dos modelos
- [x] Validación del cliente de Graph contra el buzón real (importación de la fase 9 y sincronización del worker en Dokploy)
- [x] Validación del login con Microsoft real y de la lista de usuarios
- [ ] Medir el acierto contra la carpeta donde se archiva cada correo: hoy el panel mide contra las etiquetas y el worker solo sigue la Bandeja de entrada ([ADR 0008](../../docs/adr/0008-correcciones-y-metrica-de-acierto.md))
- [ ] Riesgo: si el worker está parado más tiempo del que tarda el equipo en mover un correo a su carpeta, ese correo no se procesa
- [ ] Ajuste de reglas y del umbral de confianza (el 0,8 acordado solo cambia con datos y con el usuario)

Riesgos de operación que tocan código:

- [ ] Aviso de caducidad del certificado y del secreto de login: días restantes en `/health` y aviso con 30 días
- [ ] Tope de gasto diario del LLM: al superarlo, los correos quedan como dudosos y se avisa
- [ ] Implementar el borrado automático de remitentes, asuntos y decisiones con más de 12 meses (plazo decidido el 2026-10-03), con copia de seguridad previa en la primera ejecución
- [ ] Adjuntos `.eml` y `.msg`: soportarlos o descartarlos de forma informada, según lo medido en la fase 9
- [ ] Pruebas de navegador del panel en el repositorio, y pruebas de integración (PostgreSQL y docling) en CI
- [ ] Reducir la imagen del worker (hoy unos 2 GB): compilar el worker y separar las migraciones
- [x] Páginas «Correos» (cada correo con su decisión, estado y motivo) y «Reglas» (solo lectura, con los correos que decidió cada una) en el panel (decisión del 2026-10-12)
- [ ] Registro de caídas en el panel (decisión del 2026-10-12): guardar cuándo empieza y termina cada parada de la sincronización y mostrar el historial junto al estado del servicio; los avisos siguen en Uptime Kuma

Velocidad de la extracción (decisión del 2026-10-09). En la fase 9, docling en CPU tardó unos 20 s
por correo y pasó por OCR 62 de 68 adjuntos, casi siempre por logos y sellos. Cada cambio se mide
contra la muestra: tiempo por correo y que no se pierda ningún CIF ni razón social.

- [x] Leer primero la capa de texto del PDF y usar OCR solo en los PDF sin texto (escaneados o fotos): hecho con docling sin OCR, sin dependencia nueva; de unos 20 s a 4,5 s por correo sin perder ninguna categoría ([informe](../reports/validacion-261012-1530-velocidad-extraccion.md))
- [x] Desactivar la estructura de tablas (`do_table_structure=false`): para el CIF y la razón social basta el texto
- [x] Medir las opciones de docling que reducen trabajo: `pypdfium2` no gana tiempo y pierde un CIF; `images_scale` y `ocr_lang` solo afectan al OCR, que ya casi no se usa
- [x] Medir si basta la primera página: gana 0,3 s por adjunto y pierde un CIF, así que se mantienen 2 páginas
- [x] Imágenes pequeñas como adjunto normal (logos de firma): descartado por ahora, solo 1 de 185 adjuntos en la muestra
- [ ] Decidir con el usuario cómo sabe el equipo que un correo se leyó y quedó sin clasificar, con el volumen de dudosos medido aquí

## Success Criteria

- Precisión ≥ 95 % por categoría contra la muestra revisada a mano y cobertura mínima por categoría
  cumplida (cifra fijada en la fase 9), con el modelo por defecto.
- CIF del cliente en ≥ 19 de 20 facturas reales.
- Informe comparativo de al menos dos modelos.
- Cada tarea de riesgo de operación hecha o descartada de forma explícita por el usuario.

## Risk Assessment

- Si las reglas y el LLM no alcanzan el criterio, se ajusta antes de desplegar; no se baja el umbral
  del 95 % sin decisión del usuario.
- Cada tarea que toque código sigue las reglas del repositorio: pruebas, revisión y, si cambia un
  esquema, copia de seguridad previa.

## Security Considerations

Se envían correos reales al proveedor de LLM durante las pruebas: usar solo proveedores que no
entrenen con los datos ([ADR 0003](../../docs/adr/0003-llm-configurable-y-privacidad.md)) y claves
dedicadas.
