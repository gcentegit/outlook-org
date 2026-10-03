import { SOCIEDADES, normalizeCif } from '@clasificador/shared';

import type { RuleRecord } from './rules';

/** Reglas fuertes por defecto: CIF y razón social de las siete sociedades (docs/referencia/sociedades-categorias.md). */
export function defaultRules(): RuleRecord[] {
  return SOCIEDADES.flatMap((s) => [
    {
      id: `cif-${s.cif}`,
      type: 'cif' as const,
      value: normalizeCif(s.cif),
      category: s.category,
      weight: 'fuerte' as const,
    },
    {
      id: `rs-${s.cif}`,
      type: 'razon_social' as const,
      value: s.razonSocial,
      category: s.category,
      weight: 'fuerte' as const,
    },
  ]);
}
