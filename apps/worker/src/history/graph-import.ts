import { z } from 'zod';

import { GraphError, type GraphClient } from '../graph/client';
import type { GraphMessage } from '../graph/messages';
import { appendJsonl, historyPaths, readJsonFile, removeIfExists, writeJsonFile } from './store';
import type { HistoryMessage } from './types';

/** Solo metadatos: ni cuerpo ni adjuntos. */
const LIST_SELECT = [
  'subject',
  'from',
  'categories',
  'hasAttachments',
  'receivedDateTime',
  'internetMessageId',
  'conversationId',
].join(',');
const PAGE_SIZE = 100;

export interface MailFolder {
  id: string;
  path: string;
}

interface GraphFolder {
  id: string;
  displayName: string;
  childFolderCount?: number;
}

const userPath = (mailbox: string): string => `/users/${encodeURIComponent(mailbox)}`;

/** Todas las carpetas del buzón, subcarpetas incluidas (Archivo, 347…), con su ruta legible. */
export async function listAllFolders(
  graph: GraphClient,
  mailbox: string,
  skipNames: readonly string[] = [],
): Promise<MailFolder[]> {
  const skip = new Set(skipNames.map((n) => n.toLowerCase()));
  const out: MailFolder[] = [];
  async function walk(url: string, parentPath: string): Promise<void> {
    for (const folder of await graph.getAll<GraphFolder>(url)) {
      if (skip.has(folder.displayName.toLowerCase())) continue;
      const path = parentPath ? `${parentPath}/${folder.displayName}` : folder.displayName;
      out.push({ id: folder.id, path });
      if ((folder.childFolderCount ?? 0) > 0) {
        await walk(
          `${userPath(mailbox)}/mailFolders/${encodeURIComponent(folder.id)}/childFolders?$top=${PAGE_SIZE}`,
          path,
        );
      }
    }
  }
  await walk(`${userPath(mailbox)}/mailFolders?$top=${PAGE_SIZE}`, '');
  return out;
}

const importStateSchema = z.object({ since: z.string().min(1) });
const progressSchema = z.object({
  since: z.string(),
  nextLink: z.string().nullable(),
  done: z.boolean(),
  count: z.number().int().nonnegative(),
});

export interface ImportOptions {
  graph: GraphClient;
  mailbox: string;
  dataDir: string;
  /** Fecha de corte (receivedDateTime ≥); solo se usa en la primera ejecución, luego manda la guardada. */
  since: Date;
  skipFolders?: readonly string[];
  /** Borra el progreso y los correos importados y empieza de cero. */
  restart?: boolean;
  log?: (message: string) => void;
}

export interface ImportResult {
  since: string;
  folders: number;
  foldersSkipped: number;
  messagesWritten: number;
}

function toHistoryMessage(m: GraphMessage, folder: MailFolder): HistoryMessage {
  return {
    id: m.id,
    folderId: folder.id,
    folderPath: folder.path,
    subject: m.subject ?? '',
    fromAddress: m.from?.emailAddress?.address?.trim().toLowerCase() || null,
    fromName: m.from?.emailAddress?.name ?? null,
    receivedAt: new Date(m.receivedDateTime).toISOString(),
    categories: m.categories ?? [],
    hasAttachments: m.hasAttachments,
    conversationId: m.conversationId ?? null,
    internetMessageId: m.internetMessageId ?? null,
  };
}

/**
 * Importa los metadatos y categorías de todos los correos de todas las carpetas recibidos desde
 * `since`. Es reanudable: tras cada página se guarda el último `@odata.nextLink` de la carpeta, y
 * una carpeta terminada no se vuelve a leer. Un corte entre escribir la página y guardar el
 * progreso solo puede duplicar esa página, y `readMessages` deduplica por id.
 */
export async function importHistory(options: ImportOptions): Promise<ImportResult> {
  const { graph, mailbox, dataDir } = options;
  const log = options.log ?? console.log;
  const paths = historyPaths(dataDir);

  if (options.restart) {
    await Promise.all([
      removeIfExists(paths.progressDir),
      removeIfExists(paths.importState),
      removeIfExists(paths.messages),
    ]);
  }

  // El corte se fija en la primera ejecución: así reanudar al día siguiente no cambia el rango.
  let state = await readJsonFile(paths.importState, importStateSchema);
  if (!state) {
    state = { since: options.since.toISOString() };
    await writeJsonFile(paths.importState, state);
  } else if (state.since !== options.since.toISOString()) {
    log(
      `Se mantiene el corte de la primera ejecución (${state.since}); usa --restart para cambiarlo.`,
    );
  }
  const since = state.since;

  const folders = await listAllFolders(graph, mailbox, options.skipFolders);
  log(`${folders.length} carpetas en el buzón (subcarpetas incluidas).`);

  const firstUrl = (folder: MailFolder): string =>
    `${userPath(mailbox)}/mailFolders/${encodeURIComponent(folder.id)}/messages` +
    `?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
    `&$orderby=receivedDateTime desc&$select=${LIST_SELECT}&$top=${PAGE_SIZE}`;

  let foldersSkipped = 0;
  let messagesWritten = 0;
  for (const folder of folders) {
    const progressPath = paths.progressFile(folder.id);
    const saved = await readJsonFile(progressPath, progressSchema);
    if (saved?.done && saved.since === since) {
      foldersSkipped++;
      continue;
    }
    let next: string | null = saved && saved.since === since ? saved.nextLink : null;
    let count = saved && saved.since === since ? saved.count : 0;
    let url: string | null = next ?? firstUrl(folder);
    try {
      while (url) {
        const page: { value: GraphMessage[]; '@odata.nextLink'?: string } =
          await graph.getJson(url);
        await appendJsonl(
          paths.messages,
          page.value.map((m) => toHistoryMessage(m, folder)),
        );
        count += page.value.length;
        messagesWritten += page.value.length;
        next = page['@odata.nextLink'] ?? null;
        url = next;
        await writeJsonFile(progressPath, { since, nextLink: next, done: next === null, count });
      }
    } catch (err) {
      // Una carpeta que Graph no deja abrir (404) no debe impedir importar el resto.
      if (err instanceof GraphError && err.status === 404) {
        log(`Carpeta omitida (404): ${folder.path}`);
        await writeJsonFile(progressPath, { since, nextLink: null, done: true, count });
        continue;
      }
      throw err;
    }
    log(`${folder.path}: ${count} correos`);
  }

  return { since, folders: folders.length, foldersSkipped, messagesWritten };
}
