# Validación: extracción del CIF en facturas reales

Primera prueba de la fase 10. Sale de la muestra de la fase 9 (150 correos con adjuntos, 50 por
árbol de carpetas), ya extraída con docling. Los datos de cada correo están en `data/history/`,
fuera de git; aquí solo van cifras agregadas.

## Método

- Correos de la muestra archivados en los árboles `Foodbox` o `Lateral` con al menos un PDF
  adjunto: 70 (36 y 34).
- Acierto: el CIF de una sociedad del grupo aparece en el texto extraído de los adjuntos.
- Tiempo: el medido en la fase 9 en arm64 (CPU, sin GPU), unos 20 s por correo.

## Resultado

| | Correos | CIF del grupo en el adjunto |
|---|---:|---:|
| Árbol Foodbox | 36 | 35 |
| Árbol Lateral | 34 | 34 |
| **Total** | **70** | **69 (98,6 %)** |

- Tres correos del árbol Lateral son facturas a ARCOBETA: el CIF leído es correcto, pero no coincide
  con la carpeta, porque ARCOBETA no existía al archivarlos. Siguen el criterio del
  [ADR 0008](../../docs/adr/0008-correcciones-y-metrica-de-acierto.md): revisión a mano.
- El único fallo es un PDF firmado que pasó por OCR (unos 3.800 caracteres) sin que saliera el CIF;
  el cuerpo del correo sí lo tenía.
- 98 de los 115 adjuntos convertidos pasaron por OCR, casi siempre por logos y sellos. Es lo que
  atacan las tareas de velocidad de la fase 10.

## Conclusión

Se cumple el criterio de 19 de 20 facturas con el CIF del cliente. El tiempo por correo es alto para
CPU; las tareas de velocidad de la fase 10 deben bajarlo sin perder ningún CIF de esta muestra.
