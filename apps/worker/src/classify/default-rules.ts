import { SOCIEDADES, normalizeCif, razonesSociales } from '@clasificador/shared';

import type { RuleRecord } from './rules';

/** Reglas fuertes por defecto: CIF, razón social y sus variantes de las siete sociedades (docs/referencia/sociedades-categorias.md). */
export function defaultRules(): RuleRecord[] {
  return SOCIEDADES.flatMap((s) => [
    {
      id: `cif-${s.cif}`,
      type: 'cif' as const,
      value: normalizeCif(s.cif),
      category: s.category,
      weight: 'fuerte' as const,
    },
    ...razonesSociales(s).map((value, i) => ({
      id: i === 0 ? `rs-${s.cif}` : `rs-${s.cif}-${i}`,
      type: 'razon_social' as const,
      value,
      category: s.category,
      weight: 'fuerte' as const,
    })),
  ]);
}
