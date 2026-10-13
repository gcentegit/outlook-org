import { describe, expect, it, vi } from 'vitest';

import { createPrismaDecisionStore } from './decision-store';

function fakeDb() {
  const message = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  return { message, decision: {}, $transaction: vi.fn() };
}

describe('forget', () => {
  it('borra el correo sin decisión y, si tiene decisión, lo deja procesado y sin marcar', async () => {
    const db = fakeDb();
    const store = createPrismaDecisionStore(db as never);
    await store.forget('m1');
    expect(db.message.deleteMany).toHaveBeenCalledWith({
      where: { id: 'm1', decisions: { none: {} } },
    });
    // Archivado: el id cambió y reprocesarlo daría 404 siempre; no debe quedarse en cola.
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'processed', needsReprocess: false },
    });
  });
});
