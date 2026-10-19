# Validación: tiempos de extracción en producción con la lectura híbrida

Tiempos reales de lectura de adjuntos en producción desde la
[extracción híbrida](validacion-261014-2235-extraccion-hibrida.md) (versión 0.12.0 en adelante),
comparados con el método anterior, en el que todo pasaba por docling. Salen de los registros del
worker (`extracción: … (método) en N ms`) y de docling-serve en Dokploy. Aquí solo van cifras
agregadas.

## Fuentes y límites

- Dokploy solo conserva los registros desde el último reinicio de cada contenedor: los del worker
  cubren del 2026-10-17 al 2026-10-19 y los de docling, desde la tarde del 2026-10-17. Los de antes
  de la 0.12.0 (2026-10-12 a 2026-10-15) ya no existen, así que el «antes» en producción no se
  puede medir: se toma de las mediciones del
  [2026-10-12](validacion-261012-1530-velocidad-extraccion.md) y del
  [2026-10-14](validacion-261014-2235-extraccion-hibrida.md), hechas con adjuntos reales en otra
  máquina arm64.
- Ninguna extracción falló en el periodo.

## Producción, 2026-10-17 a 2026-10-19: 49 adjuntos

| Tipo | Adjuntos | Cómo se lee | Tiempo en el worker | Conversión real en docling |
|---|---:|---|---|---|
| PDF con texto | 41 | pdf.js, sin docling | mediana 22 ms, media 63 ms (máx. 1,3 s) | — |
| XLSX | 2 | docling sin OCR | 2,0 s | 0,15–0,18 s |
| Imágenes | 4 | docling con OCR | 4,0 s | 2,7–3,7 s |
| PDF escaneados | 2 | docling con OCR | 10,0 s | 8,5–9,7 s |
| **Total** | **49** | | **43 s; media 0,87 s** | |

## Antes y después

| | Antes (todo por docling) | Después, en producción |
|---|---|---|
| PDF con texto | unos 2,6 s | 22 ms (mediana) |
| XLSX | 2,0 s | 2,0 s |
| PDF escaneados | 18–22 s | 10 s |
| Estos 49 adjuntos | unos 2,3 min (estimado) | 43 s |

- El «antes» de estos 49 adjuntos es una estimación: los 41 PDF con texto a 2,6 s cada uno y los
  otros 8 con el tiempo que han tardado ahora.
- Los PDF escaneados no cambian de método. Bajan porque las mediciones anteriores se hicieron en
  otra máquina y con más carga; en producción docling solo atiende lo que necesita OCR.
- A docling le llegaron 8 de los 49 adjuntos; antes le llegaban todos.

## Espera mínima de docling-serve

Los tiempos de docling que mide el worker salen redondos (2,0 s, 4,0 s, 10,0 s) y superan la
conversión real. El endpoint síncrono `/v1/convert/file` encola el trabajo y comprueba si ha
terminado cada `DOCLING_SERVE_SYNC_POLL_INTERVAL` segundos (por defecto 2, número entero; código de
docling-serve v1.36.0, `_wait_task_complete` en `docling_serve/app.py`), así que cada petición
espera un múltiplo de ese intervalo. La API asíncrona no lo evita: con el orquestador local, el
parámetro `wait` de `/v1/status/poll` no se usa.

Prueba local con la misma imagen (`docling-serve-cpu:v1.36.0`), seis peticiones por valor tras
calentar:

| `DOCLING_SERVE_SYNC_POLL_INTERVAL` | XLSX (conversión 0,01 s) | PDF sin OCR (conversión ~2 s) | CPU de una conversión PDF |
|---|---|---|---|
| 2 (por defecto) | 2,0 s | 2,0–4,0 s | — |
| 1 | 1,0 s | 2,0–3,0 s | 5,1 s |
| 0 | 0,02 s | 4,0–7,9 s | 9,3 s |

- Con 1, cada adjunto que pasa por docling espera de media medio segundo menos; un XLSX, un segundo
  menos.
- Con 0 la comprobación no descansa: compite por la CPU con la conversión, que se vuelve más lenta,
  y casi duplica el consumo. No conviene.
- Con unos 4 adjuntos al día por docling, el ahorro con 1 es de pocos segundos al día. No es
  urgente; queda como tarea en la [fase 11](../261001-2123-clasificador-foodbox-lateral/phase-11-despliegue-en-sombra-y-observacion.md).
  Aplicarlo es añadir la variable a docling en `infra/dokploy/provision.ts` y
  `infra/docker/compose.dev.yml` y redesplegar docling, con autorización.
