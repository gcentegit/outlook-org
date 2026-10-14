import type { Category } from './categories';

/**
 * Las siete sociedades del grupo y su categoría. Fuente: docs/referencia/sociedades-categorias.md (hoja
 * "Resumen" de datos-fiscales.xlsx). Solo cuentan estos CIF: en la factura también aparece el del
 * proveedor, que nunca debe contar. La dirección fiscal es común a las siete y no sirve de señal.
 *
 * Las reglas reales se leen de la tabla `Rule`; esta lista alimenta la semilla, el prompt del LLM
 * y las reglas por defecto del evaluador.
 *
 * `variantes`: otras formas en que las facturas escriben la razón social (regla del negocio): cada
 * una es una regla fuerte más. La forma societaria no se exige en el texto.
 */
export const SOCIEDADES: ReadonlyArray<{
  razonSocial: string;
  cif: string;
  category: Category;
  variantes?: readonly string[];
}> = [
  {
    razonSocial: 'FOODBOX, S.A.',
    cif: 'A87240420',
    category: 'FOOD BOX',
    variantes: ['FOOD BOX, S.A.'],
  },
  {
    razonSocial: 'ARCO BETA, S.L.',
    cif: 'B87694121',
    category: 'ARCOBETA',
    variantes: ['ARCOBETA, S.L.'],
  },
  {
    razonSocial: 'GRUPO RESTAURACION LATERAL, S.L.',
    cif: 'B85554921',
    category: 'LATERAL',
    variantes: ['GRUPO LATERAL'],
  },
  { razonSocial: 'LATERAL SANTA ANA, S.L.', cif: 'B85275279', category: 'LATERAL' },
  { razonSocial: 'LATERAL CONSELL, S.L.', cif: 'B86898491', category: 'LATERAL' },
  { razonSocial: 'LATERAL IBERIA, S.L.', cif: 'B88300413', category: 'LATERAL' },
  { razonSocial: 'LATERAL CESAR AUGUSTO, S.L.', cif: 'B88445325', category: 'LATERAL' },
];

/** Razón social y sus variantes: todas las formas que cuentan como la sociedad. */
export function razonesSociales(s: (typeof SOCIEDADES)[number]): string[] {
  return [s.razonSocial, ...(s.variantes ?? [])];
}
