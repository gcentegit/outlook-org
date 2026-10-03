import { describe, expect, it, vi } from 'vitest';

import type { KnownMessage } from '../corrections';
import { GraphError } from '../graph/client';
import { inboxDeltaUrl, syncInbox, type SyncState, type SyncStore } from './delta';

const NOW = new Date('2026-10-02T10:00:00Z');
const BASE = 'https://graph.microsoft.com/v1.0/users/p%40x.com/mailFolders/inbox/messages/delta';

type Known = KnownMessage & { status: 'pending' | 'processed' | 'failed' };

function fakeStore(state: SyncState | null, known: Known[] = [], earliest: Date | null = null) {
  let current = state;
  const store = {
    getState: vi.fn(async () => current),
    saveState: vi.fn(async (deltaLink: string, at: Date) => {
      current = { deltaLink, lastSyncAt: at };
    }),
    clearDeltaLink: vi.fn(async () => {
      current = { deltaLink: null, lastSyncAt: current?.lastSyncAt ?? null };
    }),
    earliestReceivedAt: vi.fn(async () => earliest),
    findKnown: vi.fn(async (ids: string[]) => {
      const map = new Map<string, Known>();
      for (const k of known) if (ids.includes(k.id)) map.set(k.id, k);
      return map;
    }),
    registerNew: vi.fn(async () => {}),
    recordChange: vi.fn(async () => {}),
  } satisfies SyncStore;
  return store;
}

function knownMsg(over: Partial<Known> = {}): Known {
  return {
    id: 'old',
    status: 'processed',
    seenCategories: [],
    latestDecision: { id: 'd1', categories: ['LATERAL'], mode: 'shadow' },
    latestCorrection: null,
    ...over,
  };
}

function setup(
  pages: Record<string, unknown>,
  store: ReturnType<typeof fakeStore>,
): { deps: Parameters<typeof syncInbox>[0]; urls: string[]; enqueued: string[] } {
  const urls: string[] = [];
  const enqueued: string[] = [];
  const getJson = vi.fn(async (url: string) => {
    urls.push(url);
    const page = pages[url];
    if (page instanceof Error) throw page;
    if (!page) throw new Error(`URL no prevista: ${url}`);
    return page;
  });
  return {
    urls,
    enqueued,
    deps: {
      graph: { getJson } as never,
      mailbox: 'p@x.com',
      store,
      enqueue: async (id) => void enqueued.push(id),
      now: () => NOW,
      log: () => {},
    },
  };
}

describe('inboxDeltaUrl', () => {
  it('pide la Bandeja de entrada con $select y el filtro por fecha de recepción', () => {
    expect(inboxDeltaUrl('p@x.com', NOW)).toBe(
      '/users/p%40x.com/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,conversationId,categories&$filter=receivedDateTime+ge+2026-10-02T10:00:00.000Z',
    );
  });
});

describe('syncInbox', () => {
  it('primera pasada: solo pide desde ahora (con margen), sigue nextLink y guarda el deltaLink', async () => {
    const store = fakeStore(null);
    const first = inboxDeltaUrl('p@x.com', new Date(NOW.getTime() - 60_000));
    const { deps, urls, enqueued } = setup(
      {
        [first]: { value: [{ id: 'a' }], '@odata.nextLink': `${BASE}?$skiptoken=1` },
        [`${BASE}?$skiptoken=1`]: {
          value: [{ id: 'b' }],
          '@odata.deltaLink': `${BASE}?$deltatoken=T1`,
        },
      },
      store,
    );
    const result = await syncInbox(deps);
    expect(urls).toEqual([first, `${BASE}?$skiptoken=1`]);
    expect(enqueued).toEqual(['a', 'b']);
    expect(result).toMatchObject({ enqueued: 2, resynced: false });
    expect(store.saveState).toHaveBeenCalledWith(`${BASE}?$deltatoken=T1`, NOW);
  });

  it('con deltaLink guardado lo usa tal cual', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW });
    const { deps, urls } = setup(
      { [link]: { value: [], '@odata.deltaLink': `${BASE}?$deltatoken=T2` } },
      store,
    );
    await syncInbox(deps);
    expect(urls).toEqual([link]);
    expect(store.saveState).toHaveBeenCalledWith(`${BASE}?$deltatoken=T2`, NOW);
  });

  it('encola los desconocidos y no encola los ya registrados', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [knownMsg({ id: 'old' })]);
    const { deps, enqueued } = setup(
      {
        [link]: {
          value: [{ id: 'new' }, { id: 'old', categories: [] }],
          '@odata.deltaLink': `${BASE}?$deltatoken=T2`,
        },
      },
      store,
    );
    const result = await syncInbox(deps);
    expect(enqueued).toEqual(['new']);
    expect(result).toMatchObject({ enqueued: 1, changed: 0, corrections: 0 });
  });

  it('registra el correo nuevo como pendiente antes de encolarlo, con sus categorías y su fecha', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW });
    const order: string[] = [];
    store.registerNew.mockImplementation(async () => void order.push('registrar'));
    const { deps } = setup(
      {
        [link]: {
          value: [
            {
              id: 'new',
              receivedDateTime: '2026-10-02T09:30:00Z',
              conversationId: 'conv-1',
              categories: ['Pagado'],
            },
          ],
          '@odata.deltaLink': `${BASE}?$deltatoken=T2`,
        },
      },
      store,
    );
    deps.enqueue = async () => void order.push('encolar');
    await syncInbox(deps);
    expect(order).toEqual(['registrar', 'encolar']);
    expect(store.registerNew).toHaveBeenCalledWith({
      id: 'new',
      conversationId: 'conv-1',
      receivedAt: new Date('2026-10-02T09:30:00Z'),
      seenCategories: ['Pagado'],
    });
  });

  it('un cambio del equipo en un correo aún pendiente actualiza lo visto y lo vuelve a encolar', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const pending = knownMsg({
      id: 'p1',
      status: 'pending',
      latestDecision: null,
      seenCategories: [],
    });
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [pending]);
    const { deps, enqueued } = setup(
      {
        [link]: {
          value: [{ id: 'p1', categories: ['FOOD BOX'] }],
          '@odata.deltaLink': `${BASE}?$deltatoken=T2`,
        },
      },
      store,
    );
    const result = await syncInbox(deps);
    expect(store.recordChange).toHaveBeenCalledWith({
      messageId: 'p1',
      seenCategories: ['FOOD BOX'],
      correction: null,
    });
    expect(enqueued).toEqual(['p1']);
    // No es un correo nuevo: no se registra de nuevo ni cuenta como nuevo.
    expect(store.registerNew).not.toHaveBeenCalled();
    expect(result).toMatchObject({ enqueued: 0, changed: 1, corrections: 0 });
  });

  it('un correo fallido o ya procesado no se vuelve a encolar por un cambio', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [
      knownMsg({ id: 'f1', status: 'failed' }),
      knownMsg({ id: 'd1' }),
    ]);
    const { deps, enqueued } = setup(
      {
        [link]: {
          value: [
            { id: 'f1', categories: ['X'] },
            { id: 'd1', categories: ['Y'] },
          ],
          '@odata.deltaLink': `${BASE}?$deltatoken=T2`,
        },
      },
      store,
    );
    await syncInbox(deps);
    expect(enqueued).toEqual([]);
  });

  it('registra la corrección cuando el equipo cambia las categorías de un correo conocido', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [knownMsg()]);
    const { deps } = setup(
      {
        [link]: {
          value: [{ id: 'old', categories: ['FOOD BOX', 'Pagado'] }],
          '@odata.deltaLink': `${BASE}?$deltatoken=T2`,
        },
      },
      store,
    );
    const result = await syncInbox(deps);
    expect(result).toMatchObject({ changed: 1, corrections: 1 });
    expect(store.recordChange).toHaveBeenCalledWith({
      messageId: 'old',
      seenCategories: ['FOOD BOX', 'Pagado'],
      correction: {
        kind: 'correction',
        decisionId: 'd1',
        proposed: ['LATERAL'],
        final: ['FOOD BOX'],
      },
    });
  });

  it('ignora los cambios sin categorías (leído/no leído) de un correo conocido', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [knownMsg()]);
    const { deps } = setup(
      { [link]: { value: [{ id: 'old' }], '@odata.deltaLink': `${BASE}?$deltatoken=T2` } },
      store,
    );
    expect(await syncInbox(deps)).toMatchObject({ changed: 0, enqueued: 0 });
    expect(store.recordChange).not.toHaveBeenCalled();
  });

  it('cuenta los @removed (movidos o borrados) sin encolarlos', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW });
    const { deps, enqueued } = setup(
      {
        [link]: {
          value: [{ id: 'gone', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': `${BASE}?$deltatoken=T2`,
        },
      },
      store,
    );
    const result = await syncInbox(deps);
    expect(result.removed).toBe(1);
    expect(enqueued).toEqual([]);
    expect(store.findKnown).not.toHaveBeenCalled();
  });

  it('con un 410 olvida el deltaLink y resincroniza desde el correo registrado más antiguo', async () => {
    const link = `${BASE}?$deltatoken=OLD`;
    const earliest = new Date('2026-09-14T07:15:00Z');
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [], earliest);
    const resync = inboxDeltaUrl('p@x.com', earliest);
    const { deps, urls, enqueued } = setup(
      {
        [link]: new GraphError('syncStateNotFound', 410),
        [resync]: { value: [{ id: 'x' }], '@odata.deltaLink': `${BASE}?$deltatoken=NEW` },
      },
      store,
    );
    const result = await syncInbox(deps);
    expect(urls).toEqual([link, resync]);
    expect(store.clearDeltaLink).toHaveBeenCalledOnce();
    expect(enqueued).toEqual(['x']);
    expect(result.resynced).toBe(true);
    expect(store.saveState).toHaveBeenCalledWith(`${BASE}?$deltatoken=NEW`, NOW);
  });

  it('sin correos registrados el 410 resincroniza desde la última sincronización', async () => {
    const link = `${BASE}?$deltatoken=OLD`;
    const last = new Date('2026-10-02T09:00:00Z');
    const store = fakeStore({ deltaLink: link, lastSyncAt: last });
    const resync = inboxDeltaUrl('p@x.com', last);
    const { deps, urls } = setup(
      {
        [link]: new GraphError('gone', 410),
        [resync]: { value: [], '@odata.deltaLink': `${BASE}?$deltatoken=NEW` },
      },
      store,
    );
    await syncInbox(deps);
    expect(urls[1]).toBe(resync);
  });

  it('un segundo 410 seguido se propaga y no guarda estado', async () => {
    const link = `${BASE}?$deltatoken=OLD`;
    const earliest = new Date('2026-10-01T16:30:00Z');
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW }, [], earliest);
    const { deps } = setup(
      {
        [link]: new GraphError('gone', 410),
        [inboxDeltaUrl('p@x.com', earliest)]: new GraphError('gone', 410),
      },
      store,
    );
    await expect(syncInbox(deps)).rejects.toThrow('gone');
    expect(store.saveState).not.toHaveBeenCalled();
  });

  it('otros errores de Graph se propagan sin guardar el deltaLink', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW });
    const { deps } = setup({ [link]: new GraphError('Graph 500', 500) }, store);
    await expect(syncInbox(deps)).rejects.toThrow('Graph 500');
    expect(store.saveState).not.toHaveBeenCalled();
  });

  it('si encolar falla no avanza el deltaLink (la ronda se repetirá)', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW });
    const { deps } = setup(
      { [link]: { value: [{ id: 'a' }], '@odata.deltaLink': `${BASE}?$deltatoken=T2` } },
      store,
    );
    deps.enqueue = async () => {
      throw new Error('pg-boss caído');
    };
    await expect(syncInbox(deps)).rejects.toThrow('pg-boss caído');
    expect(store.saveState).not.toHaveBeenCalled();
  });

  it('falla si Graph no devuelve ni nextLink ni deltaLink', async () => {
    const link = `${BASE}?$deltatoken=T1`;
    const store = fakeStore({ deltaLink: link, lastSyncAt: NOW });
    const { deps } = setup({ [link]: { value: [] } }, store);
    await expect(syncInbox(deps)).rejects.toThrow(/ni nextLink ni deltaLink/);
  });
});
