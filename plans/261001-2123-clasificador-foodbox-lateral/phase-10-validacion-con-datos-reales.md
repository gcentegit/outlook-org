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
  - [x] Solo reglas contra la carpeta, 800 correos archivados desde el 2026-05-01: FOOD BOX 93,1 % de precisión y 84,5 % de cobertura; LATERAL 98,7 % y 74 % ([informe](../reports/evaluacion-261013-0031-acierto-contra-carpetas.md))
  - [ ] Revisión del usuario de los 29 correos con una sociedad distinta de su carpeta, y decidir si ARCOBETA cuenta como acierto en el árbol Lateral
  - [ ] Con reglas de remitente y con LLM, cuando el usuario lo decida
- [x] Validación del cliente de Graph contra el buzón real (importación de la fase 9 y sincronización del worker en Dokploy)
- [x] Validación del login con Microsoft real y de la lista de usuarios
- [x] Medir el acierto contra la carpeta donde se archiva cada correo ([ADR 0008](../../docs/adr/0008-correcciones-y-metrica-de-acierto.md)), preparado el 2026-10-13 a petición del usuario:
  - el worker comprueba cada hora, y con el botón «Comparar con las carpetas» del panel, en qué carpeta acabó cada correo, buscándolo por conversación y fecha de recepción porque el id de Graph cambia al moverlo; fuera de la Bandeja toma también sus categorías;
  - el panel usa como verdad el árbol Foodbox → FOOD BOX y el árbol Lateral → LATERAL, más las etiquetas del equipo; con solo la carpeta ARCOBETA no se compara;
  - «Correos» muestra en «Equipo» la carpeta de cada correo, y el resumen añade la evolución por semana;
  - probado en lectura contra el buzón real: 40 de 40 correos del histórico en su carpeta, unos 0,65 s por correo;
  - desplegado en la 0.8.0 el 2026-10-13, con copia previa. La 0.9.0 guarda también la ruta de la carpeta y «Correos» la muestra («Archivado en Foodbox / 2026», «En otra carpeta: Elementos eliminados»);
  - primera comparación (139 correos): 40 en Lateral, 34 en Foodbox, 24 en la Bandeja, 9 en cuatro subcarpetas de la Bandeja que no son Foodbox ni Lateral y 36 borrados del buzón, casi todos publicidad y avisos;
  - primeras cifras contra la carpeta, con 52 correos archivados y decididos (los otros 22 esperan al LLM): FOOD BOX 88,5 % de precisión y 100 % de cobertura; LATERAL 100 % y 89,7 %. Los 3 únicos fallos son un mismo hilo interno que nombra a FOODBOX y está archivado en Lateral;
  - provisional hasta hablar con el equipo: el árbol Lateral vale por «LATERAL o ARCOBETA».
  - [ ] Llevar a la reunión con el equipo de Proveedores: ARCOBETA en Lateral, si esas cuatro subcarpetas son de una sola sociedad, si la subcarpeta de pendientes dentro de Lateral debe contar y el hilo archivado en otra sociedad (guion en `data/history/reunion-equipo-proveedores.html`, fuera de git)
- [x] Publicadas el 2026-10-13 la 0.7.0 (evaluación contra carpetas, escritura de categorías preparada y bloqueada, dependencias), la 0.8.0 (comparación con las carpetas) la 0.9.0 (ruta de la carpeta) y la 0.9.1 (fallo del reproceso), cada una con copia previa de la base de datos
- [x] Fallo del reproceso corregido en la 0.9.1 (2026-10-13, con copia previa): al archivar un correo Graph le cambia el id, el reproceso daba 404 y el correo se quedaba pendiente y marcado para siempre. Ahora conserva su decisión, pasa a procesado y pierde la marca. Comprobado en producción con una copia restaurada: 0 pendientes, 78 corregidos y 11 marcados, todos en la Bandeja y a la espera del LLM. El botón indica cuántos esperan al LLM, y «Reprocesar» y «Comparar con las carpetas» usan el estilo principal del panel
- [x] Revisión del código del 2026-10-13 con cinco revisores: un 404 al procesar se reintenta antes de dar el correo por desaparecido; la comprobación de carpetas usa una sola lista ordenada (los archivados no se quedan atrás con muchos correos en la Bandeja) y un fallo de un correo no tira la ronda; con filtro de categoría los correos que no se pueden comparar cuentan como sin contrastar; una corrección vacía en el árbol Lateral no hace comparar LATERAL ni ARCOBETA; los casos de evaluación ya no llevan las categorías de Outlook y no se pueden escribir fuera de `data/` (ahora ignorada entera); botones de acción unificados. Sin fallos de acceso ni endpoints abiertos. Publicado en la 0.12.1 (2026-10-15), con despliegue automático
  - [ ] Decidir con el equipo si la carpeta debe sustituir a una corrección que la contradiga (hoy se suman) y si el acierto por modelo debe calcular lo comparable con cada decisión y no con la última
  - [x] Comprobado en pg-boss 12 que una ronda de carpetas que pasa de su caducidad (1 h) sí podía solaparse con la siguiente: el trabajo queda fallido y empieza otro, pero el código de la ronda vieja seguía en marcha. Ahora la ronda se detiene con la señal del trabajo y deja el resto para la siguiente (2026-10-15)
- [x] Correos recibidos desde el 2026-10-09, antes de arrancar la sombra, recuperados reiniciando la sincronización (74 correos, con copia previa)
- [x] Reglas del negocio del 2026-10-12 en la razón social ([sociedades y categorías](../../docs/referencia/sociedades-categorias.md)): «FOOD BOX» vale por FOODBOX y «ARCOBETA» por ARCO BETA, y la forma societaria (S.A., S.L.) no se exige (0.4.0). 9 correos más decididos al reprocesar, revisados por el usuario
- [x] Fallo de la 0.4.0 corregido en la 0.6.1: sin forma societaria, «FOODBOX» dentro de `…@foodbox.es` o `www.foodbox.es` contaba como razón social. Ahora las direcciones de correo y las webs no cuentan. 11 correos afectados, revisados por el usuario: uno pierde FOOD BOX (factura a ARCOBETA), otro queda en duda y otro gana LATERAL y ARCOBETA por una decisión anterior a la 0.4.0
- [x] Criterio del equipo del 2026-10-14: cada sociedad nombrada en los conceptos de una factura lleva su categoría, aunque la factura vaya a otra. Caso real: una factura de energía a ARCO BETA con conceptos de «Grupo Lateral» y «Food Box» salió FOOD BOX y ARCOBETA, sin LATERAL, porque «Grupo Lateral» no era ninguna razón social. Variante «GRUPO LATERAL» → LATERAL publicada en la 0.9.2 (2026-10-14, con copia previa). Sin reproceso, por decisión del usuario: de los tres correos que lo nombran, el de la factura ya estaba archivado y los otros dos, borrados
- [x] Reprocesar también los correos archivados (decisión del 2026-10-14). Al moverlos, Graph les cambia el id y hoy el reproceso los da por desaparecidos y conserva la decisión anterior, así que una corrección de reglas no llega a los correos que el equipo ya archivó. Ahora se buscan por conversación y fecha de recepción, como hace la comparación con las carpetas, se leen con el id actual y la decisión se guarda con el id conocido. Vale también para un correo nuevo que el equipo archive antes de que se procese. Publicado en la 0.10.0 (2026-10-14, con copia previa), la primera que se despliega sola al fusionar la release
- [x] KPI «Eliminados por el equipo» en el resumen (decisión del 2026-10-14). En la copia de ese día eran 79 de 310 correos: 60 sin categoría propuesta (76 %, frente al 23 % del resto) y solo 2 con categoría del equipo. Casi todos son publicidad y avisos. Por decisión del usuario, no cuentan en el acierto, la cobertura ni las discrepancias ([ADR 0008](../../docs/adr/0008-correcciones-y-metrica-de-acierto.md)). Publicado en la 0.11.0 (2026-10-14, con copia previa comprobada: 318 correos y 515 decisiones), con despliegue automático en verde
- [x] «Reprocesar» vuelve a decidir también los correos ya decididos que estén marcados (0.6.2). Para aplicar una corrección de reglas a correos ya decididos: copia de seguridad, marcar `needsReprocess` en los afectados con SQL y pulsar «Reprocesar»
- [x] Panel: aviso de reproceso agrupado por causa (0.3.0), «Ver motivo» solo con lo que se cumple (0.5.0) y anchos fijos en «Correos» (0.6.0)
- [ ] Reglas nuevas para los 32 correos pendientes (remitentes y dominios propuestos el 2026-10-12) y LLM: aplazados por el usuario hasta hablarlo con el equipo de Proveedores, por la privacidad de correos y facturas. Alternativa sin sacar datos: un modelo local por `OPENAI_COMPATIBLE_BASE_URL`
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
- [x] Probar PaddleOCR en lugar de docling: no es más rápido (27 s frente a 22 s por adjunto con OCR, mismo acierto) y en arm64 solo funciona sin oneDNN; se descarta ([informe](../reports/validacion-261013-0110-paddleocr-y-extraccion-hibrida.md))
- [x] Migrar a la extracción híbrida (decisión del 2026-10-13): el worker lee la capa de texto de los PDF con pdf.js y docling queda para PDF sin texto, imágenes, DOCX y XLSX. De 4,5 s a 0,31 s por adjunto en la muestra (un PDF con texto, de unos 2,5 s a 0,03 s); ningún correo pierde categoría y uno archivado en `Foodbox` gana FOOD BOX ([informe](../reports/validacion-261014-2235-extraccion-hibrida.md), [ADR 0012](../../docs/adr/0012-adjuntos-y-extraccion.md)). Los correos ya decididos no se reprocesan salvo que el usuario lo pida, con copia de seguridad previa. Publicado en la 0.12.0 (2026-10-15)
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
