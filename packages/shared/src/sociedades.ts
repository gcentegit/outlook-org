import type { Category } from './categories';

/**
 * Las siete sociedades del grupo y su categoría. Fuente: docs/referencia/sociedades-categorias.md (hoja
 * "Resumen" de datos-fiscales.xlsx). Solo cuentan estos CIF: en la factura también aparece el del
 * proveedor, que nunca debe contar. La dirección fiscal es común a las siete y no sirve de señal.
 *
 * Las reglas reales se leen de la tabla `Rule`; esta lista alimenta la semilla, el prompt del LLM
 * y las reglas por defecto del evaluador.
 */
export const SOCIEDADES: ReadonlyArray<{ razonSocial: string; cif: string; category: Category }> = [
  { razonSocial: 'FOODBOX, S.A.', cif: 'A87240420', category: 'FOOD BOX' },
  { razonSocial: 'ARCO BETA, S.L.', cif: 'B87694121', category: 'ARCOBETA' },
  { razonSocial: 'GRUPO RESTAURACION LATERAL, S.L.', cif: 'B85554921', category: 'LATERAL' },
  { razonSocial: 'LATERAL SANTA ANA, S.L.', cif: 'B85275279', category: 'LATERAL' },
  { razonSocial: 'LATERAL CONSELL, S.L.', cif: 'B86898491', category: 'LATERAL' },
  { razonSocial: 'LATERAL IBERIA, S.L.', cif: 'B88300413', category: 'LATERAL' },
  { razonSocial: 'LATERAL CESAR AUGUSTO, S.L.', cif: 'B88445325', category: 'LATERAL' },
];
