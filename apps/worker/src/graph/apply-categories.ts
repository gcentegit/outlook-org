import { canonicalCategory, type Category } from '@clasificador/shared';

import { GraphError, type GraphClient } from './client';

/** Lo que el servicio ya escribió en cada correo (tabla `AppliedCategory`). */
export interface AppliedCategoryStore {
  listApplied(messageId: string): Promise<string[]>;
  recordApplied(messageId: string, categories: readonly string[]): Promise<void>;
}

export interface ApplyCategoriesDeps {
  graph: GraphClient;
  mailbox: string;
  store: AppliedCategoryStore;
  /** Lecturas y escrituras como máximo si otro cambia el correo entre medias (por defecto 3). */
  maxAttempts?: number;
}

export interface ApplyCategoriesResult {
  added: string[];
  /** Ya la tenía (puesta por el equipo o por una pasada anterior). */
  alreadyPresent: string[];
  /** El servicio la puso antes y ya no está: la quitó el equipo y no se vuelve a poner. */
  removedByTeam: string[];
}

interface MessageCategories {
  '@odata.etag'?: string;
  categories?: string[];
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Categorías de la decisión que se escriben en el buzón: solo las que el panel tiene en live, con el
 * nombre exacto de la lista maestra del buzón. Una categoría sin entrada en la lista maestra no se
 * escribe: el servicio nunca crea categorías por su cuenta.
 */
export function categoriesToApply(
  decided: readonly Category[],
  live: readonly Category[],
  masterNames: readonly string[],
): string[] {
  const names: string[] = [];
  for (const category of decided) {
    if (!live.includes(category)) continue;
    const name = masterNames.find((n) => canonicalCategory(n) === category);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Añade categorías a un correo sin quitar ninguna. El `PATCH` de Graph reemplaza la lista entera,
 * así que se leen las categorías actuales justo antes y se escribe con `If-Match`: si el correo
 * cambió entre la lectura y la escritura (412), se vuelve a leer. Una categoría que el correo ya
 * tiene no se toca, y una que el servicio escribió antes y ya no está tampoco se vuelve a poner.
 */
export async function applyCategories(
  messageId: string,
  categories: readonly string[],
  deps: ApplyCategoriesDeps,
): Promise<ApplyCategoriesResult> {
  const path = `/users/${encodeURIComponent(deps.mailbox)}/messages/${encodeURIComponent(messageId)}`;
  const applied = await deps.store.listApplied(messageId);
  const maxAttempts = deps.maxAttempts ?? 3;

  for (let attempt = 1; ; attempt++) {
    const message = await deps.graph.getJson<MessageCategories>(`${path}?$select=categories`);
    const current = message.categories ?? [];
    const result: ApplyCategoriesResult = { added: [], alreadyPresent: [], removedByTeam: [] };
    for (const name of categories) {
      if (current.some((c) => sameName(c, name))) result.alreadyPresent.push(name);
      else if (applied.some((c) => sameName(c, name))) result.removedByTeam.push(name);
      else result.added.push(name);
    }
    if (result.added.length === 0) return result;

    try {
      await deps.graph.patchJson(
        path,
        { categories: [...current, ...result.added] },
        message['@odata.etag'] ? { ifMatch: message['@odata.etag'] } : {},
      );
    } catch (err) {
      if (err instanceof GraphError && err.status === 412 && attempt < maxAttempts) continue;
      throw err;
    }
    await deps.store.recordApplied(messageId, result.added);
    return result;
  }
}
