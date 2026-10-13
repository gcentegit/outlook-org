import { canonicalCategory, type Category } from '@clasificador/shared';

import { GraphError, type GraphClient } from './client';

/** Lo que el servicio ya escribió en cada correo (tabla `AppliedCategory`). */
export interface AppliedCategoryStore {
  listApplied(messageId: string): Promise<string[]>;
  recordApplied(messageId: string, categories: readonly string[]): Promise<void>;
  /** Borra lo anotado cuando Graph rechazó la escritura: seguro que no se aplicó. */
  forgetApplied(messageId: string, categories: readonly string[]): Promise<void>;
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

/** Respuestas de Graph cuando el correo cambió desde que se leyó: se vuelve a leer. */
const CONFLICT_STATUS = new Set([409, 412]);

/**
 * Añade categorías a un correo sin quitar ninguna. El `PATCH` de Graph reemplaza la lista entera,
 * así que se leen las categorías actuales justo antes y se escribe con `If-Match`: si el correo
 * cambió entre la lectura y la escritura (412 o 409), se vuelve a leer. Sin etag no se escribe,
 * porque no habría forma de no pisar un cambio. Una categoría que el correo ya tiene no se toca, y
 * una que el servicio escribió antes y ya no está tampoco se vuelve a poner.
 *
 * Lo que se va a escribir se anota antes del `PATCH` y se borra solo si Graph lo rechaza con un
 * error que no sea de conflicto. Si no se sabe cómo acabó (corte de red, conflicto), queda anotado:
 * en la duda, el servicio no vuelve a poner una categoría que el correo no tiene, porque podría
 * haberla quitado el equipo.
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
    const etag = message['@odata.etag'];
    if (!etag) throw new Error(`Graph no devolvió el etag del correo ${messageId}: no se escribe`);

    await deps.store.recordApplied(messageId, result.added);
    try {
      await deps.graph.patchJson(
        path,
        { categories: [...current, ...result.added] },
        { ifMatch: etag },
      );
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      // Un conflicto puede venir de un reintento de un PATCH que ya se aplicó: lo anotado se queda
      // y, al releer, lo que ya esté en el correo cuenta como escrito por el servicio.
      if (CONFLICT_STATUS.has(err.status)) {
        if (attempt < maxAttempts) continue;
        throw err;
      }
      // Solo un rechazo definitivo (4xx) asegura que no se escribió. Un 5xx o un 429 tras los
      // reintentos pudo aplicarse: lo anotado se queda, para no volver a poner lo que quite el equipo.
      if (err.status < 500 && err.status !== 429) {
        await deps.store.forgetApplied(messageId, result.added);
      }
      throw err;
    }
    return result;
  }
}
