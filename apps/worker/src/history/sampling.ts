import { CATEGORIES } from '@clasificador/shared';

import { teamLabels } from './types';

export const STRATA = [...CATEGORIES, 'varias', 'ninguna'] as const;
export type Stratum = (typeof STRATA)[number];

/** Estrato de un correo según las categorías del equipo: una sola de las tres, varias o ninguna. */
export function stratumOf(categories: readonly string[]): Stratum {
  const labels = teamLabels(categories);
  if (labels.length === 0) return 'ninguna';
  return labels.length === 1 ? (labels[0] as Stratum) : 'varias';
}

/** Generador pseudoaleatorio con semilla (mulberry32): el mismo conjunto da siempre la misma muestra. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Reparte `size` a partes iguales entre los estratos; un estrato con menos correos que su cuota
 * aporta todos los que tiene y el sobrante se reparte entre los demás (un estrato vacío, como
 * ARCOBETA antes de que exista la categoría, simplemente no aporta).
 */
export function allocateQuotas(
  available: Record<Stratum, number>,
  size: number,
): Record<Stratum, number> {
  const quota = Object.fromEntries(STRATA.map((s) => [s, 0])) as Record<Stratum, number>;
  let open = STRATA.filter((s) => available[s] > 0);
  let remaining = Math.min(
    size,
    STRATA.reduce((sum, s) => sum + available[s], 0),
  );
  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    const extra = remaining % open.length;
    let granted = 0;
    const stillOpen: Stratum[] = [];
    open.forEach((s, i) => {
      const want = share + (i < extra ? 1 : 0);
      const take = Math.min(want, available[s] - quota[s]);
      quota[s] += take;
      granted += take;
      if (quota[s] < available[s]) stillOpen.push(s);
    });
    remaining -= granted;
    // Si nadie pudo tomar nada más, no hay nada que repartir.
    if (granted === 0) break;
    open = stillOpen;
  }
  return quota;
}

export interface StratifiedSample<T> {
  selected: T[];
  perStratum: Record<Stratum, { available: number; selected: number }>;
}

/** Muestra estratificada reproducible; el resultado sale ordenado por fecha de recepción. */
export function stratifiedSample<T extends { categories: readonly string[]; receivedAt: string }>(
  items: readonly T[],
  size: number,
  seed = 20261002,
): StratifiedSample<T> {
  const groups = Object.fromEntries(STRATA.map((s) => [s, [] as T[]])) as Record<Stratum, T[]>;
  for (const item of items) groups[stratumOf(item.categories)].push(item);

  const available = Object.fromEntries(STRATA.map((s) => [s, groups[s].length])) as Record<
    Stratum,
    number
  >;
  const quota = allocateQuotas(available, size);
  const random = seededRandom(seed);

  const selected: T[] = [];
  const perStratum = {} as StratifiedSample<T>['perStratum'];
  for (const stratum of STRATA) {
    const picked = shuffle(groups[stratum], random).slice(0, quota[stratum]);
    selected.push(...picked);
    perStratum[stratum] = { available: available[stratum], selected: picked.length };
  }
  selected.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return { selected, perStratum };
}

export interface DateSplit {
  /** Primer instante de la prueba (ISO); `null` si no hay correos. Todo lo anterior es desarrollo. */
  splitDate: string | null;
  dev: number;
  test: number;
}

/** El corte deja `devRatio` de los correos (los más antiguos) en desarrollo y el resto, los más recientes, en prueba. */
export function computeDateSplit(receivedAts: readonly string[], devRatio: number): DateSplit {
  if (receivedAts.length === 0) return { splitDate: null, dev: 0, test: 0 };
  const sorted = [...receivedAts].sort();
  const devCount = Math.min(sorted.length - 1, Math.max(1, Math.round(sorted.length * devRatio)));
  const splitDate = sorted[Math.min(devCount, sorted.length - 1)] as string;
  // Con fechas repetidas en el corte, todas van a prueba: el criterio es estrictamente por fecha.
  const dev = sorted.filter((d) => d < splitDate).length;
  return { splitDate, dev, test: sorted.length - dev };
}

export const isDevelopment = (receivedAt: string, splitDate: string | null): boolean =>
  splitDate === null || receivedAt < splitDate;
