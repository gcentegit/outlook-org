import { describe, expect, it, vi } from 'vitest';

import { createPrismaDecisionStore } from './decision-store';

describe('forget', () => {
  it('en una transacción borra el correo sin decisión y, si la tiene, lo deja procesado y sin marcar', async () => {
    const message = {
      deleteMany: vi.fn((args: unknown) => ({ op: 'delete', args })),
      updateMany: vi.fn((args: unknown) => ({ op: 'update', args })),
    };
    const $transaction = vi.fn(async () => []);
    await createPrismaDecisionStore({ message, decision: {}, $transaction } as never).forget('m1');
    expect($transaction).toHaveBeenCalledWith([
      { op: 'delete', args: { where: { id: 'm1', decisions: { none: {} } } } },
      // Archivado: el id cambió y reprocesarlo daría 404 siempre; no debe quedarse en cola.
      {
        op: 'update',
        args: { where: { id: 'm1' }, data: { status: 'processed', needsReprocess: false } },
      },
    ]);
  });
});
