import { CATEGORIES, type Category } from '@clasificador/shared';

import { parseDateRange, type DateRange } from './dates';

export type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface PanelFilter {
  range: DateRange;
  category: Category | null;
  page: number;
}

/** Lee `desde`, `hasta`, `categoria` y `pagina` de la URL; lo que no sea válido se ignora. */
export function parseFilter(params: SearchParams, now: Date = new Date()): PanelFilter {
  const category = first(params.categoria);
  const page = Number(first(params.pagina));
  return {
    range: parseDateRange(first(params.desde), first(params.hasta), now),
    category: CATEGORIES.find((c) => c === category) ?? null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
