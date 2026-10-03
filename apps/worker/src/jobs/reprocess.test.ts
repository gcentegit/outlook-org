import { describe, expect, it, vi } from 'vitest';

import { createPrismaReprocessStore, reprocessFlagged } from './reprocess';

describe('reprocessFlagged', () => {
  it('deja pendientes y encola cada correo marcado', async () => {
    const store = {
      listFlagged: vi.fn(async () => ['a', 'b']),
      markPending: vi.fn(async () => {}),
    };
    const enqueue = vi.fn(async (_id: string) => {});
    expect(await reprocessFlagged(store, enqueue)).toBe(2);
    expect(store.markPending).toHaveBeenCalledWith(['a', 'b']);
    expect(enqueue.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('sin correos marcados no encola nada', async () => {
    const store = {
      listFlagged: vi.fn(async (): Promise<string[]> => []),
      markPending: vi.fn(async () => {}),
    };
    const enqueue = vi.fn(async (_id: string) => {});
    expect(await reprocessFlagged(store, enqueue)).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('createPrismaReprocessStore', () => {
  it('lista los marcados por antigüedad y los deja pendientes sin quitar la marca', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'x' }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const store = createPrismaReprocessStore({ message: { findMany, updateMany } } as never);
    expect(await store.listFlagged()).toEqual(['x']);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { needsReprocess: true } });
    await store.markPending(['x']);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x'] } },
      data: { status: 'pending' },
    });
    updateMany.mockClear();
    await store.markPending([]);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
