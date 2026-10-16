# Sociedades y categorías del clasificador

Fuente: hoja **"Resumen"** de `datos-fiscales.xlsx` (documento interno, guardado fuera del repositorio en `docs/privado/`), entregado el 2026-10-02. La otra hoja (locales, CECO y códigos de pedido) no se usa.

Regla del negocio: FOODBOX va a **FOOD BOX**, ARCO BETA va a **ARCOBETA**, y toda sociedad con "Lateral" en la razón social va a **LATERAL**.

## Sociedad → categoría

| Razón social | CIF | Empresa SAP | Categoría |
| --- | --- | --- | --- |
| FOODBOX, S.A. | A87240420 | S022 | FOOD BOX |
| ARCO BETA, S.L. | B87694121 | S009 | ARCOBETA |
| GRUPO RESTAURACION LATERAL, S.L. | B85554921 | S008 | LATERAL |
| LATERAL SANTA ANA, S.L. | B85275279 | S004 | LATERAL |
| LATERAL CONSELL, S.L. | B86898491 | S007 | LATERAL |
| LATERAL IBERIA, S.L. | B88300413 | S018 | LATERAL |
| LATERAL CESAR AUGUSTO, S.L. | B88445325 | S020 | LATERAL |

## Señales

1. **CIF del cliente** en la factura. Es la señal más fiable. Solo cuentan estos siete CIF, porque en la factura también aparece el del proveedor.
2. **Razón social del cliente**, con su forma societaria escrita de cualquier manera («FOODBOX S.A»,
   «Foodbox, SA», «FOODBOX S.L.U.») y como palabra completa (regla del negocio, 2026-10-16). El
   nombre suelto no cuenta: «colaboración Fergofrio-Foodbox» o «Factura Amazon Foodbox» aparecen en
   correos que no son de FOODBOX. Tampoco cuenta dentro de una dirección de correo o una web:
   «ana@foodbox.es» o «www.foodbox.es» no son una factura a FOODBOX. Si un correo nombra varias
   sociedades y ninguna por su CIF (ficheros de pago, informes, rapeles), queda en duda en vez de
   llevar todas las categorías. Las facturas también escriben la razón social de otra forma, y las
   dos valen (reglas del negocio, 2026-10-12):
   - FOODBOX también como **FOOD BOX**
   - ARCO BETA también como **ARCOBETA**
   - **GRUPO LATERAL** cuenta como LATERAL (criterio del equipo, 2026-10-14): las facturas lo usan
     en los conceptos, y cada sociedad nombrada en ellos lleva su categoría aunque la factura vaya
     a otra.

   Las variantes están en [`packages/shared/src/sociedades.ts`](../../packages/shared/src/sociedades.ts)
   y cada una es una regla fuerte más.
3. **Palabras clave** del asunto o el cuerpo: se sacarán del histórico del buzón.

La dirección fiscal no sirve para distinguir: las siete sociedades comparten "C/ Núñez Morgado 6, 28036 Madrid".
