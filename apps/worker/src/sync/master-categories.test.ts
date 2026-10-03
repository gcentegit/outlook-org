import { describe, expect, it, vi } from 'vitest';

import { createMasterCategoriesProvider, fetchMasterCategories } from './master-categories';

const graphWith = (names: string[]) => ({
  getAll: vi.fn(async () => names.map((displayName) => ({ displayName }))),
});

describe('fetchMasterCategories', () => {
  it('lee /outlook/masterCategories del buzón', async () => {
    const graph = graphWith(['FOOD BOX', 'LATERAL']);
    expect(await fetchMasterCategories(graph as never, 'p@x.com')).toEqual(['FOOD BOX', 'LATERAL']);
    expect(graph.getAll).toHaveBeenCalledWith('/users/p%40x.com/outlook/masterCategories');
  });
});

describe('createMasterCategoriesProvider', () => {
  it('reutiliza la lista durante el TTL y la refresca después', async () => {
    const graph = graphWith(['FOOD BOX']);
    let now = 0;
    const get = createMasterCategoriesProvider({
      graph: graph as never,
      mailbox: 'p@x.com',
      ttlMs: 1000,
      now: () => now,
    });
    await get();
    now = 999;
    await get();
    expect(graph.getAll).toHaveBeenCalledTimes(1);
    now = 1000;
    await get();
    expect(graph.getAll).toHaveBeenCalledTimes(2);
  });

  it('si el refresco falla usa la copia anterior', async () => {
    const graph = graphWith(['LATERAL']);
    let now = 0;
    const log = vi.fn();
    const get = createMasterCategoriesProvider({
      graph: graph as never,
      mailbox: 'p@x.com',
      ttlMs: 10,
      now: () => now,
      log,
    });
    await get();
    now = 100;
    graph.getAll.mockRejectedValueOnce(new Error('Graph 503'));
    expect(await get()).toEqual(['LATERAL']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Graph 503'));
  });

  it('sin copia anterior propaga el error', async () => {
    const graph = graphWith([]);
    graph.getAll.mockRejectedValueOnce(new Error('Graph 500'));
    const get = createMasterCategoriesProvider({ graph: graph as never, mailbox: 'p@x.com' });
    await expect(get()).rejects.toThrow('Graph 500');
  });
});
