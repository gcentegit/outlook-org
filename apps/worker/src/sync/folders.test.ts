import { describe, expect, it, vi } from 'vitest';

import { GraphClient } from '../graph/client';
import type { MessageFolder } from '@clasificador/shared';

import type { KnownMessage } from '../corrections';
import {
  checkFolders,
  loadFolderMap,
  findCurrentMessageId,
  locateMessage,
  recordArchivedCategories,
  type FolderCheckStore,
  type FolderInfo,
  type MessageToLocate,
} from './folders';

const USER = '/users/buzon%40ejemplo.com';

/** Árbol de carpetas como lo devuelve Graph, con subcarpetas. */
const FOLDERS: Record<string, { id: string; displayName: string; childFolderCount: number }[]> = {
  root: [
    { id: 'inbox', displayName: 'Bandeja de entrada', childFolderCount: 2 },
    { id: 'deleted', displayName: 'Elementos eliminados', childFolderCount: 0 },
  ],
  inbox: [
    { id: 'fb', displayName: 'Foodbox', childFolderCount: 1 },
    { id: 'lat', displayName: 'LATERAL', childFolderCount: 0 },
  ],
  fb: [{ id: 'fb-2026', displayName: '2026', childFolderCount: 0 }],
};

interface FakeItem {
  id?: string;
  conversationId: string;
  receivedDateTime: string;
  parentFolderId: string;
  categories?: string[];
}

function fakeMailbox(items: FakeItem[], failFor: string[] = []) {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const path = u.pathname;
    if (path === `${USER}/mailFolders/inbox`) return Response.json({ id: 'inbox' });
    if (path === `${USER}/mailFolders`) return Response.json({ value: FOLDERS.root });
    const children = /\/mailFolders\/([^/]+)\/childFolders$/.exec(path);
    if (children) return Response.json({ value: FOLDERS[children[1] ?? ''] ?? [] });
    if (path === `${USER}/messages`) {
      const conversationId = /conversationId eq '(.*)'$/.exec(
        u.searchParams.get('$filter') ?? '',
      )?.[1];
      const wanted = conversationId?.replaceAll("''", "'");
      if (wanted && failFor.includes(wanted)) return new Response('fallo', { status: 500 });
      return Response.json({ value: items.filter((i) => i.conversationId === wanted) });
    }
    return new Response('no esperado', { status: 404 });
  });
  return new GraphClient({
    getToken: async () => 't',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: 'https://graph.test',
    sleep: async () => {},
  });
}

const msg = (id: string, conversationId: string, receivedAt: string): MessageToLocate => ({
  id,
  conversationId,
  receivedAt: new Date(receivedAt),
});

describe('loadFolderMap', () => {
  it('reconoce la Bandeja, los árboles de las sociedades con sus subcarpetas y el resto', async () => {
    const folderOf = await loadFolderMap(fakeMailbox([]), 'buzon@ejemplo.com');
    expect(folderOf('inbox')).toEqual({ folder: 'inbox', path: 'Bandeja de entrada' });
    expect(folderOf('fb')).toEqual({ folder: 'foodbox', path: 'Bandeja de entrada/Foodbox' });
    expect(folderOf('fb-2026')).toEqual({
      folder: 'foodbox',
      path: 'Bandeja de entrada/Foodbox/2026',
    });
    // El nombre no distingue mayúsculas.
    expect(folderOf('lat').folder).toBe('lateral');
    expect(folderOf('deleted')).toEqual({ folder: 'other', path: 'Elementos eliminados' });
    expect(folderOf('desconocida')).toEqual({ folder: 'other', path: null });
  });
});

describe('findCurrentMessageId', () => {
  it('devuelve el id actual del correo con la misma conversación y fecha', async () => {
    const graph = fakeMailbox([
      {
        id: 'otro',
        conversationId: 'c1',
        receivedDateTime: '2026-10-10T08:00:00Z',
        parentFolderId: 'lat',
      },
      {
        id: 'archivado',
        conversationId: 'c1',
        receivedDateTime: '2026-10-10T09:00:00Z',
        parentFolderId: 'lat',
      },
    ]);
    expect(
      await findCurrentMessageId(
        graph,
        'buzon@ejemplo.com',
        msg('m', 'c1', '2026-10-10T09:00:00.000Z'),
      ),
    ).toBe('archivado');
  });

  it('null si ya no está en el buzón', async () => {
    const graph = fakeMailbox([]);
    expect(
      await findCurrentMessageId(
        graph,
        'buzon@ejemplo.com',
        msg('m', 'c1', '2026-10-10T09:00:00Z'),
      ),
    ).toBeNull();
  });
});

describe('locateMessage', () => {
  const KINDS: Record<string, MessageFolder> = { inbox: 'inbox', fb: 'foodbox', lat: 'lateral' };
  const folderOf = (id: string): FolderInfo => ({
    folder: KINDS[id] ?? 'other',
    path: `ruta de ${id}`,
  });

  it('encuentra el correo por conversación y fecha, y toma sus categorías fuera de la Bandeja', async () => {
    const graph = fakeMailbox([
      { conversationId: 'c1', receivedDateTime: '2026-10-10T08:00:00Z', parentFolderId: 'lat' },
      {
        conversationId: 'c1',
        receivedDateTime: '2026-10-10T09:00:00Z',
        parentFolderId: 'fb',
        categories: ['FOOD BOX', 'Urgente'],
      },
    ]);
    expect(
      await locateMessage(
        graph,
        'buzon@ejemplo.com',
        msg('m', 'c1', '2026-10-10T09:00:00.000Z'),
        folderOf,
      ),
    ).toEqual({ folder: 'foodbox', path: 'ruta de fb', categories: ['FOOD BOX', 'Urgente'] });
  });

  it('en la Bandeja no toma categorías: de eso ya se ocupa la sincronización', async () => {
    const graph = fakeMailbox([
      {
        conversationId: 'c1',
        receivedDateTime: '2026-10-10T09:00:00Z',
        parentFolderId: 'inbox',
        categories: ['LATERAL'],
      },
    ]);
    expect(
      await locateMessage(
        graph,
        'buzon@ejemplo.com',
        msg('m', 'c1', '2026-10-10T09:00:00Z'),
        folderOf,
      ),
    ).toEqual({ folder: 'inbox', path: 'ruta de inbox', categories: null });
  });

  it('si hay copias en varias carpetas, manda la del árbol de una sociedad', async () => {
    const graph = fakeMailbox([
      { conversationId: 'c1', receivedDateTime: '2026-10-10T09:00:00Z', parentFolderId: 'deleted' },
      { conversationId: 'c1', receivedDateTime: '2026-10-10T09:00:00Z', parentFolderId: 'lat' },
    ]);
    const location = await locateMessage(
      graph,
      'buzon@ejemplo.com',
      msg('m', 'c1', '2026-10-10T09:00:00Z'),
      folderOf,
    );
    expect(location.folder).toBe('lateral');
  });

  it('con una copia todavía en la Bandeja no toma categorías: la sincronización sigue esa copia', async () => {
    const graph = fakeMailbox([
      {
        conversationId: 'c1',
        receivedDateTime: '2026-10-10T09:00:00Z',
        parentFolderId: 'inbox',
        categories: ['FOOD BOX'],
      },
      {
        conversationId: 'c1',
        receivedDateTime: '2026-10-10T09:00:00Z',
        parentFolderId: 'lat',
        categories: ['LATERAL'],
      },
    ]);
    expect(
      await locateMessage(
        graph,
        'buzon@ejemplo.com',
        msg('m', 'c1', '2026-10-10T09:00:00Z'),
        folderOf,
      ),
    ).toEqual({ folder: 'lateral', path: 'ruta de lat', categories: null });
  });

  it('si ya no está en el buzón lo marca como desaparecido; las comillas del id se escapan', async () => {
    const graph = fakeMailbox([
      { conversationId: "c'2", receivedDateTime: '2026-10-10T10:00:00Z', parentFolderId: 'fb' },
    ]);
    expect(
      await locateMessage(
        graph,
        'buzon@ejemplo.com',
        msg('m', "c'2", '2026-10-10T09:00:00Z'),
        folderOf,
      ),
    ).toEqual({ folder: 'missing', path: null, categories: null });
  });
});

function memoryStore(pending: MessageToLocate[]) {
  const saved = new Map<string, FolderInfo>();
  const categories = new Map<string, string[]>();
  let checkedAt: Date | null = null;
  const store: FolderCheckStore = {
    listToCheck: async () => pending,
    saveLocation: async (id, location) => void saved.set(id, location),
    markChecked: async (at) => void (checkedAt = at),
  };
  const recordCategories = async (id: string, names: string[]) => void categories.set(id, names);
  return { store, saved, categories, recordCategories, checkedAt: () => checkedAt };
}

describe('checkFolders', () => {
  it('guarda la carpeta de cada correo, sigue si uno falla y anota la ronda', async () => {
    const graph = fakeMailbox(
      [
        {
          conversationId: 'c1',
          receivedDateTime: '2026-10-10T09:00:00Z',
          parentFolderId: 'fb-2026',
          categories: ['FOOD BOX'],
        },
        { conversationId: 'c3', receivedDateTime: '2026-10-10T11:00:00Z', parentFolderId: 'inbox' },
      ],
      ['c2'],
    );
    const { store, saved, categories, recordCategories, checkedAt } = memoryStore([
      msg('m1', 'c1', '2026-10-10T09:00:00Z'),
      msg('m2', 'c2', '2026-10-10T10:00:00Z'),
      msg('m3', 'c3', '2026-10-10T11:00:00Z'),
    ]);
    const log = vi.fn();
    const now = new Date('2026-10-13T10:05:00Z');
    expect(
      await checkFolders({
        graph,
        mailbox: 'buzon@ejemplo.com',
        store,
        recordCategories,
        now: () => now,
        log,
      }),
    ).toEqual({ checked: 2, archived: 1, failed: 1 });
    expect(saved.get('m1')).toMatchObject({
      folder: 'foodbox',
      path: 'Bandeja de entrada/Foodbox/2026',
    });
    expect(saved.get('m3')?.folder).toBe('inbox');
    expect(saved.has('m2')).toBe(false);
    // Solo se anotan las categorías del archivado; las de la Bandeja son de la sincronización.
    expect([...categories]).toEqual([['m1', ['FOOD BOX']]]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('m2'));
    expect(checkedAt()).toEqual(now);
  });

  it('sin correos pendientes no pregunta a Graph, pero anota la ronda', async () => {
    const graph = fakeMailbox([]);
    const spy = vi.spyOn(graph, 'getJson');
    const { store, recordCategories, checkedAt } = memoryStore([]);
    expect(
      await checkFolders({ graph, mailbox: 'buzon@ejemplo.com', store, recordCategories }),
    ).toEqual({ checked: 0, archived: 0, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(checkedAt()).not.toBeNull();
  });

  it('si el trabajo caduca, se detiene y deja el resto para la siguiente ronda', async () => {
    const graph = fakeMailbox([
      { conversationId: 'c1', receivedDateTime: '2026-10-10T09:00:00Z', parentFolderId: 'inbox' },
    ]);
    const { store, saved, recordCategories, checkedAt } = memoryStore([
      msg('m1', 'c1', '2026-10-10T09:00:00Z'),
      msg('m2', 'c1', '2026-10-10T09:00:00Z'),
    ]);
    const controller = new AbortController();
    store.saveLocation = async (id, location) => {
      saved.set(id, location);
      controller.abort();
    };
    const result = await checkFolders({
      graph,
      mailbox: 'buzon@ejemplo.com',
      store,
      recordCategories,
      signal: controller.signal,
      log: () => {},
    });
    expect(result).toEqual({ checked: 1, archived: 0, failed: 0 });
    expect([...saved.keys()]).toEqual(['m1']);
    expect(checkedAt()).not.toBeNull();
  });

  it('si fallan todas las búsquedas no anota la ronda, para que el panel no diga «comparado»', async () => {
    const graph = fakeMailbox([], ['c1']);
    const { store, recordCategories, checkedAt } = memoryStore([
      msg('m1', 'c1', '2026-10-10T09:00:00Z'),
    ]);
    const result = await checkFolders({
      graph,
      mailbox: 'buzon@ejemplo.com',
      store,
      recordCategories,
      log: () => {},
    });
    expect(result).toEqual({ checked: 0, archived: 0, failed: 1 });
    expect(checkedAt()).toBeNull();
  });

  it('un fallo que no es de Graph (red, base de datos) tampoco tira la ronda', async () => {
    const graph = fakeMailbox([
      { conversationId: 'c1', receivedDateTime: '2026-10-10T09:00:00Z', parentFolderId: 'fb' },
    ]);
    const { store } = memoryStore([msg('m1', 'c1', '2026-10-10T09:00:00Z')]);
    const result = await checkFolders({
      graph,
      mailbox: 'buzon@ejemplo.com',
      store,
      recordCategories: async () => {
        throw new Error('base de datos caída');
      },
      log: () => {},
    });
    expect(result).toEqual({ checked: 0, archived: 0, failed: 1 });
  });
});

describe('recordArchivedCategories', () => {
  const known = (over: Partial<KnownMessage> = {}): KnownMessage & { status: 'processed' } => ({
    id: 'm1',
    status: 'processed',
    seenCategories: [],
    latestDecision: { id: 'd1', categories: ['FOOD BOX'], mode: 'shadow' },
    latestCorrection: null,
    appliedCategories: [],
    ...over,
  });

  function syncStore(message: (KnownMessage & { status: 'processed' }) | null) {
    return {
      findKnown: vi.fn(async () => new Map(message ? [[message.id, message]] : [])),
      recordChange: vi.fn(async () => {}),
    };
  }

  it('si el equipo dejó otra categoría al archivar, la registra como corrección', async () => {
    const store = syncStore(known());
    await recordArchivedCategories(store, 'm1', ['LATERAL', 'Pagado']);
    expect(store.recordChange).toHaveBeenCalledWith({
      messageId: 'm1',
      seenCategories: ['LATERAL', 'Pagado'],
      correction: {
        kind: 'correction',
        decisionId: 'd1',
        proposed: ['FOOD BOX'],
        final: ['LATERAL'],
      },
    });
  });

  it('sin cambios no escribe nada, y un correo que ya no existe se ignora', async () => {
    const same = syncStore(known({ seenCategories: ['FOOD BOX'] }));
    await recordArchivedCategories(same, 'm1', ['FOOD BOX']);
    expect(same.recordChange).not.toHaveBeenCalled();
    const gone = syncStore(null);
    await recordArchivedCategories(gone, 'm1', ['FOOD BOX']);
    expect(gone.recordChange).not.toHaveBeenCalled();
  });
});
