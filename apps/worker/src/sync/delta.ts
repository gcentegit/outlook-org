import type { MessageStatus } from '@clasificador/db';

import { evaluateCategoryChange, type CategoryChange, type KnownMessage } from '../corrections';
import { GraphError, type GraphClient } from '../graph/client';

/** Id de la fila de `SyncState` de la Bandeja de entrada (la única carpeta que se sigue). */
export const INBOX_SYNC_ID = 'inbox';

/** Margen al arrancar de cero: cubre el desfase de reloj con Exchange (los duplicados son inocuos). */
const FIRST_SYNC_MARGIN_MS = 60_000;
const DELTA_SELECT = 'id,receivedDateTime,conversationId,categories';

export interface DeltaItem {
  id: string;
  receivedDateTime?: string;
  conversationId?: string;
  categories?: string[];
  '@removed'?: { reason?: string };
}

interface DeltaPage {
  value: DeltaItem[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface SyncState {
  deltaLink: string | null;
  lastSyncAt: Date | null;
}

/** Persistencia de la sincronización; la implementación real usa Prisma. */
export interface SyncStore {
  getState(): Promise<SyncState | null>;
  /** Guarda el `deltaLink` y la hora de esta sincronización correcta. */
  saveState(deltaLink: string, syncedAt: Date): Promise<void>;
  /** Olvida el `deltaLink` caducado conservando la fecha de la última sincronización. */
  clearDeltaLink(): Promise<void>;
  /** Fecha de recepción del correo registrado más antiguo (hasta donde hay que seguir vigilando). */
  earliestReceivedAt(): Promise<Date | null>;
  findKnown(ids: string[]): Promise<Map<string, KnownMessage & { status: MessageStatus }>>;
  /** Registra un correo recién detectado como pendiente, antes de procesarlo. Si ya existe no hace nada. */
  registerNew(message: {
    id: string;
    conversationId: string;
    receivedAt: Date;
    seenCategories: string[];
  }): Promise<void>;
  /** Anota el cambio de categorías: crea la corrección (si la hay) y actualiza lo visto. */
  recordChange(args: {
    messageId: string;
    seenCategories: string[];
    correction: Extract<CategoryChange, { kind: 'correction' }> | null;
  }): Promise<void>;
}

export interface SyncDeps {
  graph: Pick<GraphClient, 'getJson'>;
  mailbox: string;
  store: SyncStore;
  /** Encola el procesado de un correo nuevo; debe ser idempotente por `messageId`. */
  enqueue: (messageId: string) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface SyncResult {
  /** Correos nuevos registrados y encolados. */
  enqueued: number;
  /** Correos ya registrados con cambios de categorías. */
  changed: number;
  corrections: number;
  /** Correos que salieron de la carpeta (movidos o borrados). */
  removed: number;
  /** El `deltaLink` había caducado (410) y se resincronizó desde el correo registrado más antiguo. */
  resynced: boolean;
}

export function inboxDeltaUrl(mailbox: string, since: Date): string {
  const base = `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages/delta`;
  const filter = `receivedDateTime+ge+${since.toISOString()}`;
  return `${base}?$select=${DELTA_SELECT}&$filter=${filter}`;
}

/**
 * Una ronda de sincronización de la Bandeja de entrada con delta query de Graph.
 *
 * - Sin estado previo, la primera ronda pide solo lo recibido desde ahora: el histórico no se
 *   reprocesa (de eso se encarga la importación) y solo interesa obtener el `deltaLink`.
 * - Graph no distingue creados de actualizados en la carga útil; se decide por la base de datos:
 *   un correo desconocido es nuevo (se registra como pendiente y se encola) y uno conocido es una
 *   posible corrección. Registrarlo antes de procesarlo hace que los cambios del equipo durante el
 *   procesado se vean como cambios de un correo conocido, y que los pendientes se puedan contar.
 *   Un correo conocido que sigue pendiente (su trabajo no llegó a encolarse) se vuelve a encolar.
 * - El `deltaLink` solo se guarda al terminar la ronda. Si algo falla, la siguiente ronda repite
 *   los mismos cambios, que son idempotentes.
 * - Un 410 (token caducado) reinicia desde la fecha del correo registrado más antiguo, no desde el
 *   último: el filtro por fecha queda fijado en el nuevo `deltaLink`, y así se siguen viendo las
 *   correcciones de los correos anteriores. Los ya conocidos solo pasan por la comparación de
 *   categorías: no se reprocesa nada.
 */
export async function syncInbox(deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.log;
  const result: SyncResult = {
    enqueued: 0,
    changed: 0,
    corrections: 0,
    removed: 0,
    resynced: false,
  };

  const state = await deps.store.getState();
  let url =
    state?.deltaLink ??
    inboxDeltaUrl(
      deps.mailbox,
      state
        ? await resyncSince(deps.store, state, now())
        : new Date(now().getTime() - FIRST_SYNC_MARGIN_MS),
    );
  if (!state) log('primera sincronización: solo se sigue lo que llegue a partir de ahora');

  for (;;) {
    try {
      const deltaLink = await drain(url, deps, result);
      await deps.store.saveState(deltaLink, now());
      return result;
    } catch (err) {
      if (!(err instanceof GraphError) || err.status !== 410 || result.resynced) throw err;
      await deps.store.clearDeltaLink();
      const since = await resyncSince(deps.store, state, now());
      log(`deltaLink caducado (410): se resincroniza desde ${since.toISOString()}`);
      url = inboxDeltaUrl(deps.mailbox, since);
      result.resynced = true;
    }
  }
}

async function resyncSince(store: SyncStore, state: SyncState | null, now: Date): Promise<Date> {
  return (await store.earliestReceivedAt()) ?? state?.lastSyncAt ?? now;
}

/** Recorre las páginas de la ronda y devuelve el `deltaLink` final. */
async function drain(firstUrl: string, deps: SyncDeps, result: SyncResult): Promise<string> {
  let url = firstUrl;
  for (;;) {
    const page = await deps.graph.getJson<DeltaPage>(url);
    await handleItems(page.value, deps, result);
    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
      continue;
    }
    const deltaLink = page['@odata.deltaLink'];
    if (!deltaLink)
      throw new Error('Graph no devolvió ni nextLink ni deltaLink en la delta query.');
    return deltaLink;
  }
}

async function handleItems(items: DeltaItem[], deps: SyncDeps, result: SyncResult): Promise<void> {
  const live = items.filter((item) => {
    if (item['@removed']) result.removed++;
    return !item['@removed'];
  });
  if (live.length === 0) return;

  const known = await deps.store.findKnown(live.map((item) => item.id));
  for (const item of live) {
    const message = known.get(item.id);
    if (!message) {
      await deps.store.registerNew({
        id: item.id,
        conversationId: item.conversationId ?? '',
        receivedAt: item.receivedDateTime
          ? new Date(item.receivedDateTime)
          : (deps.now ?? (() => new Date()))(),
        seenCategories: item.categories ?? [],
      });
      await deps.enqueue(item.id);
      result.enqueued++;
      continue;
    }
    // Sin `categories` en el cambio (p. ej. solo leído/no leído) no hay nada que comparar.
    if (item.categories) {
      const change = evaluateCategoryChange(message, item.categories);
      if (change.kind !== 'unchanged') {
        result.changed++;
        if (change.kind === 'correction') result.corrections++;
        await deps.store.recordChange({
          messageId: item.id,
          seenCategories: item.categories,
          correction: change.kind === 'correction' ? change : null,
        });
      }
    }
    if (message.status === 'pending') await deps.enqueue(item.id);
  }
}
