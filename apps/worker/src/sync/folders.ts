import type { PrismaClient } from '@clasificador/db';
import {
  FOLDERS_SYNC_ID,
  TREE_FOLDERS,
  type CheckFoldersResult,
  type MessageFolder,
} from '@clasificador/shared';

import { evaluateCategoryChange } from '../corrections';
import type { GraphClient } from '../graph/client';
import { listAllFolders } from '../history/graph-import';
import type { SyncStore } from './delta';

/**
 * Comprueba en qué carpeta acabó cada correo detectado. La sincronización solo sigue la Bandeja de
 * entrada: cuando el equipo archiva un correo, Graph solo dice que salió de ella. Esa carpeta es la
 * verdad con la que el panel mide el acierto (el árbol Foodbox es FOOD BOX y el árbol Lateral es
 * LATERAL), porque el equipo archiva siempre y etiqueta pocas veces.
 *
 * Solo lee el buzón. El id de Graph cambia al mover un correo, así que se busca por su conversación
 * y su fecha de recepción, que no cambian. Fuera de la Bandeja la sincronización ya no ve las
 * categorías del correo: se leen aquí y se anotan igual que ella (con su corrección, si la hay).
 */

/** Correos que se comprueban como mucho en cada ronda, los que llevan más tiempo sin mirar primero. */
export const MAX_MESSAGES_PER_CHECK = 500;

/** Los que ya salieron de la Bandeja de entrada se vuelven a mirar una vez al día, por si los mueven... */
export const SETTLED_RECHECK_MS = 24 * 3600 * 1000;

/** ...pero solo si llegaron hace menos de esto: pasado ese tiempo el equipo ya no los toca. */
export const SETTLED_RECHECK_HORIZON_MS = 30 * 24 * 3600 * 1000;

/** Margen al comparar la fecha de recepción guardada con la de Graph. */
const RECEIVED_TOLERANCE_MS = 1000;

export interface MessageToLocate {
  id: string;
  conversationId: string;
  receivedAt: Date;
}

/** Dónde está una carpeta: su tipo y su ruta legible (`Bandeja de entrada/Foodbox/2026`). */
export interface FolderInfo {
  folder: MessageFolder;
  /** Null si la carpeta no aparece en la lista (creada después de leerla). */
  path: string | null;
}

export interface MessageLocation extends FolderInfo {
  /**
   * Categorías que tiene en Outlook donde está ahora. Null si sigue en la Bandeja (o hay una copia
   * allí): de esas se ocupa la sincronización. También null si ya no existe.
   */
  categories: string[] | null;
}

export interface FolderCheckStore {
  /**
   * Los que aún no se han comprobado, los que siguen en la Bandeja y, una vez al día, los archivados
   * hace poco; los que llevan más tiempo sin mirar primero. Los que ya no están no se buscan más.
   */
  listToCheck(now: Date, limit: number): Promise<MessageToLocate[]>;
  /** Si el correo se ha borrado mientras tanto (p. ej. dio 404 al procesarlo), no hace nada. */
  saveLocation(messageId: string, location: FolderInfo, checkedAt: Date): Promise<void>;
  /** Fecha de la última ronda que comprobó algo, para el panel. */
  markChecked(at: Date): Promise<void>;
}

interface GraphFolderRef {
  id: string;
}

interface GraphMessageLocation {
  id: string;
  receivedDateTime: string;
  parentFolderId: string;
  categories?: string[];
}

const userPath = (mailbox: string): string => `/users/${encodeURIComponent(mailbox)}`;

/**
 * Traduce el id de una carpeta a dónde está: la Bandeja de entrada, uno de los árboles de las
 * sociedades (la carpeta con su nombre directamente bajo la Bandeja y todas sus subcarpetas) u otra,
 * con su ruta.
 */
export async function loadFolderMap(
  graph: GraphClient,
  mailbox: string,
): Promise<(folderId: string) => FolderInfo> {
  const inbox = await graph.getJson<GraphFolderRef>(
    `${userPath(mailbox)}/mailFolders/inbox?$select=id`,
  );
  const folders = await listAllFolders(graph, mailbox);
  const inboxPath = folders.find((folder) => folder.id === inbox.id)?.path;
  if (!inboxPath) throw new Error('No se encontró la Bandeja de entrada entre las carpetas.');

  const byId = new Map<string, FolderInfo>();
  for (const folder of folders) {
    const path = folder.path.toLowerCase();
    const tree = TREE_FOLDERS.find((t) => {
      const root = `${inboxPath}/${t.name}`.toLowerCase();
      return path === root || path.startsWith(`${root}/`);
    });
    const kind = folder.id === inbox.id ? 'inbox' : (tree?.folder ?? 'other');
    byId.set(folder.id, { folder: kind, path: folder.path });
  }
  return (folderId) => byId.get(folderId) ?? { folder: 'other', path: null };
}

/** Si una copia está en el árbol de una sociedad, manda esa; después la Bandeja; al final otras. */
const FOLDER_RANK: Record<MessageFolder, number> = {
  foodbox: 0,
  lateral: 0,
  inbox: 1,
  other: 2,
  missing: 3,
};

/** Las copias del correo en todo el buzón: misma conversación y misma fecha de recepción. */
async function findCopies(
  graph: GraphClient,
  mailbox: string,
  message: MessageToLocate,
): Promise<GraphMessageLocation[]> {
  const filter = `conversationId eq '${message.conversationId.replaceAll("'", "''")}'`;
  const items = await graph.getAll<GraphMessageLocation>(
    `${userPath(mailbox)}/messages?$filter=${encodeURIComponent(filter)}` +
      '&$select=id,receivedDateTime,parentFolderId,categories&$top=50',
  );
  const received = message.receivedAt.getTime();
  return items.filter(
    (item) => Math.abs(Date.parse(item.receivedDateTime) - received) < RECEIVED_TOLERANCE_MS,
  );
}

/**
 * Id actual de un correo que ya no se encuentra por el suyo: al archivarlo, Graph le da otro. Null
 * si ya no está en el buzón.
 */
export async function findCurrentMessageId(
  graph: GraphClient,
  mailbox: string,
  message: MessageToLocate,
): Promise<string | null> {
  const [copy] = await findCopies(graph, mailbox, message);
  return copy?.id ?? null;
}

export async function locateMessage(
  graph: GraphClient,
  mailbox: string,
  message: MessageToLocate,
  folderOf: (folderId: string) => FolderInfo,
): Promise<MessageLocation> {
  const matches = (await findCopies(graph, mailbox, message))
    .map((item) => ({ item, ...folderOf(item.parentFolderId) }))
    .sort((a, b) => FOLDER_RANK[a.folder] - FOLDER_RANK[b.folder]);
  const best = matches[0];
  if (!best) return { folder: 'missing', path: null, categories: null };
  const inInbox = matches.some((match) => match.folder === 'inbox');
  return {
    folder: best.folder,
    path: best.path,
    categories: inInbox ? null : (best.item.categories ?? []),
  };
}

/**
 * Anota las categorías de un correo archivado con la misma lógica que la sincronización: actualiza
 * lo visto y, si el equipo dejó algo distinto de lo propuesto, registra la corrección.
 */
export async function recordArchivedCategories(
  store: Pick<SyncStore, 'findKnown' | 'recordChange'>,
  messageId: string,
  categories: string[],
): Promise<void> {
  const known = (await store.findKnown([messageId])).get(messageId);
  if (!known) return;
  const change = evaluateCategoryChange(known, categories);
  if (change.kind === 'unchanged') return;
  await store.recordChange({
    messageId,
    seenCategories: categories,
    correction: change.kind === 'correction' ? change : null,
  });
}

export interface CheckFoldersDeps {
  graph: GraphClient;
  mailbox: string;
  store: FolderCheckStore;
  /** Anota las categorías leídas fuera de la Bandeja (`recordArchivedCategories`). */
  recordCategories: (messageId: string, categories: string[]) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
  /** Se aborta si el trabajo caduca: la ronda se detiene para no solaparse con la siguiente. */
  signal?: AbortSignal;
}

/**
 * Una ronda: localiza los correos pendientes de comprobar y guarda su carpeta. Un fallo
 * con un correo no detiene la ronda: ese correo se vuelve a intentar en la siguiente.
 */
export async function checkFolders(deps: CheckFoldersDeps): Promise<CheckFoldersResult> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? console.log;
  const pending = await deps.store.listToCheck(now, MAX_MESSAGES_PER_CHECK);
  const result: CheckFoldersResult = { checked: 0, archived: 0, failed: 0 };
  if (pending.length === 0) {
    await deps.store.markChecked(now);
    return result;
  }
  const folderOf = await loadFolderMap(deps.graph, deps.mailbox);
  for (const message of pending) {
    if (deps.signal?.aborted) {
      log(
        'carpetas: la ronda pasó de su caducidad; los correos que faltan quedan para la siguiente',
      );
      break;
    }
    try {
      const location = await locateMessage(deps.graph, deps.mailbox, message, folderOf);
      await deps.store.saveLocation(message.id, location, now);
      if (location.categories) await deps.recordCategories(message.id, location.categories);
      result.checked++;
      if (location.folder === 'foodbox' || location.folder === 'lateral') result.archived++;
    } catch (err) {
      // Cualquier fallo (Graph, red, base de datos) se queda en ese correo: no tira la ronda.
      result.failed++;
      log(`carpetas: no se pudo localizar ${message.id}: ${String(err)}`);
    }
  }
  // Si todas las búsquedas fallan (permisos, Graph caído), el panel no debe decir «comparado ahora».
  if (result.checked > 0) await deps.store.markChecked(now);
  return result;
}

export function createPrismaFolderCheckStore(
  db: Pick<PrismaClient, 'message' | 'syncState'>,
): FolderCheckStore {
  return {
    listToCheck(now, limit) {
      // Una sola lista, los que llevan más tiempo sin mirar primero: un archivado pendiente de su
      // repaso diario no se queda atrás aunque haya muchos correos en la Bandeja.
      return db.message.findMany({
        where: {
          conversationId: { not: '' },
          OR: [
            { folderCheckedAt: null },
            { folder: 'inbox' },
            {
              folder: { in: ['foodbox', 'lateral', 'other'] },
              folderCheckedAt: { lt: new Date(now.getTime() - SETTLED_RECHECK_MS) },
              receivedAt: { gte: new Date(now.getTime() - SETTLED_RECHECK_HORIZON_MS) },
            },
          ],
        },
        orderBy: { folderCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: limit,
        select: { id: true, conversationId: true, receivedAt: true },
      });
    },
    async saveLocation(messageId, { folder, path }, checkedAt) {
      await db.message.updateMany({
        where: { id: messageId },
        data: { folder, folderPath: path, folderCheckedAt: checkedAt },
      });
    },
    async markChecked(at) {
      await db.syncState.upsert({
        where: { id: FOLDERS_SYNC_ID },
        create: { id: FOLDERS_SYNC_ID, lastSyncAt: at },
        update: { lastSyncAt: at },
      });
    },
  };
}
