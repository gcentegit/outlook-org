import { describe, expect, it, vi } from 'vitest';

import type { KnownMessage } from '../corrections';
import { GraphClient } from '../graph/client';
import { catchUpArchived, type CatchUpStore } from './catch-up';

const USER = '/users/buzon%40ejemplo.com';
const LAST_SYNC = new Date('2026-10-16T08:00:00Z');

const FOLDERS: Record<string, { id: string; displayName: string; childFolderCount: number }[]> = {
  root: [
    { id: 'inbox', displayName: 'Bandeja de entrada', childFolderCount: 1 },
    { id: 'sent', displayName: 'Elementos enviados', childFolderCount: 0 },
  ],
  inbox: [{ id: 'fb', displayName: 'Foodbox', childFolderCount: 1 }],
  fb: [{ id: 'fb-2026', displayName: '2026', childFolderCount: 0 }],
};

interface FakeItem {
  id: string;
  conversationId?: string;
  receivedDateTime: string;
  parentFolderId: string;
  categories?: string[];
}

function fakeMailbox(items: FakeItem[]) {
  const filters: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const path = u.pathname;
    if (path === `${USER}/mailFolders/inbox`) return Response.json({ id: 'inbox' });
    if (path === `${USER}/mailFolders`) return Response.json({ value: FOLDERS.root });
    const children = /\/mailFolders\/([^/]+)\/childFolders$/.exec(path);
    if (children) return Response.json({ value: FOLDERS[children[1] ?? ''] ?? [] });
    if (path === `${USER}/messages`) {
      filters.push(u.searchParams.get('$filter') ?? '');
      return Response.json({ value: items });
    }
    return new Response('no esperado', { status: 404 });
  });
  const graph = new GraphClient({
    getToken: async () => 't',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: 'https://graph.test',
    sleep: async () => {},
  });
  return { graph, filters, fetchImpl };
}

function fakeStore(knownIds: string[] = [], copies: string[] = []) {
  return {
    findKnown: vi.fn(async (ids: string[]) => {
      const map = new Map<string, KnownMessage & { status: 'processed' }>();
      for (const id of ids.filter((i) => knownIds.includes(i))) {
        map.set(id, {
          id,
          status: 'processed',
          seenCategories: [],
          latestDecision: null,
          latestCorrection: null,
          appliedCategories: [],
        });
      }
      return map;
    }),
    registerNew: vi.fn(async () => {}),
    hasCopy: vi.fn(async (conversationId: string) => copies.includes(conversationId)),
  } satisfies CatchUpStore;
}

const item = (id: string, parentFolderId: string, over: Partial<FakeItem> = {}): FakeItem => ({
  id,
  conversationId: `c-${id}`,
  receivedDateTime: '2026-10-16T08:30:00Z',
  parentFolderId,
  ...over,
});

describe('catchUpArchived', () => {
  it('registra y encola los archivados en el árbol de la Bandeja durante la parada', async () => {
    const { graph, filters } = fakeMailbox([
      item('archivado', 'fb-2026', { categories: ['FOOD BOX'] }),
      item('enviado', 'sent'),
    ]);
    const store = fakeStore();
    const enqueued: string[] = [];
    const recovered = await catchUpArchived(
      { graph, mailbox: 'buzon@ejemplo.com', store, enqueue: async (id) => void enqueued.push(id) },
      LAST_SYNC,
    );
    // Pide lo recibido desde la última sincronización, con un minuto de margen.
    expect(filters).toEqual(['receivedDateTime ge 2026-10-16T07:59:00.000Z']);
    expect(recovered).toBe(1);
    expect(enqueued).toEqual(['archivado']);
    expect(store.registerNew).toHaveBeenCalledWith({
      id: 'archivado',
      conversationId: 'c-archivado',
      receivedAt: new Date('2026-10-16T08:30:00Z'),
      seenCategories: ['FOOD BOX'],
    });
  });

  it('no repite los ya registrados, por su id o por su conversación y fecha si se movieron', async () => {
    const { graph } = fakeMailbox([
      item('en-bandeja', 'inbox'),
      item('movido', 'fb', { conversationId: 'c-conocida' }),
    ]);
    const store = fakeStore(['en-bandeja'], ['c-conocida']);
    const enqueue = vi.fn(async () => {});
    const recovered = await catchUpArchived(
      { graph, mailbox: 'buzon@ejemplo.com', store, enqueue },
      LAST_SYNC,
    );
    expect(recovered).toBe(0);
    expect(store.hasCopy).toHaveBeenCalledWith('c-conocida', expect.any(Date), 1000);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('sin correos desconocidos no lee el árbol de carpetas', async () => {
    const { graph, fetchImpl } = fakeMailbox([item('en-bandeja', 'inbox')]);
    const recovered = await catchUpArchived(
      {
        graph,
        mailbox: 'buzon@ejemplo.com',
        store: fakeStore(['en-bandeja']),
        enqueue: async () => {},
      },
      LAST_SYNC,
    );
    expect(recovered).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
