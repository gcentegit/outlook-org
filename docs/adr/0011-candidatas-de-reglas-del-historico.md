# 0011. Reglas candidatas a partir del histórico

- **Estado:** aceptada

## Contexto

Las palabras clave, remitentes y dominios que identifican una categoría se sacan del histórico del
buzón (scripts en `apps/worker/scripts/` y `apps/worker/src/history/`). El histórico es
inconsistente porque el equipo no etiqueta siempre ([0008](0008-correcciones-y-metrica-de-acierto.md)).

## Decisión

- Se proponen candidatas cuyo histórico cumple una pureza mínima (0,98) y un mínimo de apariciones
  (valores configurables). Los correos sin ninguna de las tres categorías cuentan en el
  denominador.
- **Nunca se propone una regla de dominio entero** para dominios de correo público (por ejemplo
  gmail.com, hotmail.com, outlook.com, yahoo.com, icloud.com, proton.me, y las operadoras
  telefonica.net y movistar.es; la lista completa está en el código) ni para los dominios del grupo
  (`INTERNAL_EMAIL_DOMAINS`, los mismos que usa el worker). Para los públicos sí puede proponerse
  la dirección concreta si cumple el umbral; para los internos, ni dirección, porque los
  compañeros reenvían de todo. `--apply` repite el filtro por si el fichero de candidatas es
  anterior. Esos correos se siguen clasificando por CIF y razón social.
- Las candidatas se revisan con el usuario antes de activarse.
- Los informes de candidatas se escriben en `data/history/` (ignorado por git)
  ([0010](0010-retencion-y-datos-de-terceros.md)).

## Consecuencias

- Una regla candidata no es una verdad: las discrepancias entre reglas y etiquetas del equipo se
  miran antes de contarlas como error.
