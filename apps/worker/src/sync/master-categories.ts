import type { GraphClient } from '../graph/client';

/** Segundos que se reutiliza la lista maestra de categorías del buzón. */
export const MASTER_CATEGORIES_TTL_MS = 5 * 60_000;

interface MasterCategory {
  displayName: string;
}

/** Nombres de la lista maestra de categorías del buzón (`/outlook/masterCategories`). */
export async function fetchMasterCategories(
  graph: Pick<GraphClient, 'getAll'>,
  mailbox: string,
): Promise<string[]> {
  const items = await graph.getAll<MasterCategory>(
    `/users/${encodeURIComponent(mailbox)}/outlook/masterCategories`,
  );
  return items.map((item) => item.displayName);
}

export interface MasterCategoriesOptions {
  graph: Pick<GraphClient, 'getAll'>;
  mailbox: string;
  ttlMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Lista de categorías con caché corta. Si Graph falla y hay una copia anterior, se usa esa
 * (la lista casi nunca cambia); sin copia, el error se propaga y el trabajo se reintenta.
 */
export function createMasterCategoriesProvider(
  options: MasterCategoriesOptions,
): () => Promise<string[]> {
  const ttlMs = options.ttlMs ?? MASTER_CATEGORIES_TTL_MS;
  const now = options.now ?? Date.now;
  const log = options.log ?? console.warn;
  let cached: { names: string[]; at: number } | null = null;

  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.names;
    try {
      cached = {
        names: await fetchMasterCategories(options.graph, options.mailbox),
        at: now(),
      };
    } catch (err) {
      if (!cached) throw err;
      log(
        `no se pudo refrescar la lista de categorías, se usa la anterior: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return cached.names;
  };
}
