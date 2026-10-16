import type { GraphClient } from '../graph/client';
import type { SyncStore } from './delta';
import { loadInboxTree } from './folders';

/**
 * Recupera los correos que llegaron mientras la sincronización estaba parada y que el equipo ya
 * sacó de la Bandeja de entrada antes de que volviera: la delta de la Bandeja no los devuelve
 * nunca. Se buscan en todo el buzón por fecha de recepción y solo cuentan los que están en la
 * Bandeja o en sus subcarpetas (donde archiva el equipo); los borrados, enviados y borradores no.
 *
 * Al moverlo Graph le cambia el id, así que un correo ya registrado con otro id se reconoce por
 * su conversación y su fecha de recepción, como en la comprobación de carpetas.
 */

/** Recibidos antes de la última sincronización correcta también se miran: cubre el desfase de reloj. */
export const CATCH_UP_MARGIN_MS = 60_000;

const RECEIVED_TOLERANCE_MS = 1000;

interface GraphMessage {
  id: string;
  receivedDateTime: string;
  conversationId?: string;
  parentFolderId: string;
  categories?: string[];
}

export interface CatchUpStore extends Pick<SyncStore, 'findKnown' | 'registerNew'> {
  /** Si ya hay un correo registrado de esa conversación con esa fecha de recepción (± `toleranceMs`). */
  hasCopy(conversationId: string, receivedAt: Date, toleranceMs: number): Promise<boolean>;
}

export interface CatchUpDeps {
  graph: GraphClient;
  mailbox: string;
  store: CatchUpStore;
  enqueue: (messageId: string) => Promise<void>;
}

/** Registra y encola los correos archivados durante la parada; devuelve cuántos. */
export async function catchUpArchived(deps: CatchUpDeps, lastSyncAt: Date): Promise<number> {
  const since = new Date(lastSyncAt.getTime() - CATCH_UP_MARGIN_MS).toISOString();
  const items = await deps.graph.getAll<GraphMessage>(
    `/users/${encodeURIComponent(deps.mailbox)}/messages` +
      `?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
      '&$select=id,receivedDateTime,conversationId,parentFolderId,categories&$top=100',
  );
  const known = await deps.store.findKnown(items.map((item) => item.id));
  const unknown = items.filter((item) => !known.has(item.id) && item.conversationId);
  if (unknown.length === 0) return 0;

  const inboxTree = await loadInboxTree(deps.graph, deps.mailbox);
  let recovered = 0;
  for (const item of unknown) {
    const conversationId = item.conversationId ?? '';
    const receivedAt = new Date(item.receivedDateTime);
    if (!inboxTree.has(item.parentFolderId)) continue;
    if (await deps.store.hasCopy(conversationId, receivedAt, RECEIVED_TOLERANCE_MS)) continue;
    await deps.store.registerNew({
      id: item.id,
      conversationId,
      receivedAt,
      seenCategories: item.categories ?? [],
    });
    await deps.enqueue(item.id);
    recovered++;
  }
  return recovered;
}
