import type { ExtractedEmail } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import type { RuleRecord } from '../classify/rules';

import {
  createPrismaReviewInboxStore,
  reviewInboxWithRule,
  type ReviewInboxStore,
} from './review-inbox-with-rule';

const rule: RuleRecord = {
  id: 'r1',
  type: 'dominio',
  value: 'proveedor.ejemplo.com',
  category: 'LATERAL',
  weight: 'medio',
};

const email = (messageId: string, fromAddress: string): ExtractedEmail => ({
  messageId,
  conversationId: null,
  internetMessageId: null,
  receivedAt: new Date('2026-10-17T10:00:00Z'),
  fromAddress,
  fromName: null,
  subject: 'Factura',
  bodyText: '',
  categories: [],
  attachments: [],
});

function fakeStore(found: RuleRecord | null, candidates: string[]): ReviewInboxStore {
  return {
    findActiveRule: vi.fn(async () => found),
    listInboxCandidates: vi.fn(async () => candidates),
    markForReprocess: vi.fn(async () => {}),
  };
}

describe('reviewInboxWithRule', () => {
  it('vuelve a decidir solo los correos con los que coincide la regla y cuenta los que no se leen', async () => {
    const store = fakeStore(rule, ['a', 'b', 'c']);
    const extract = vi.fn(async (id: string) => {
      if (id === 'c') throw new Error('404');
      return email(id, id === 'a' ? 'facturas@proveedor.ejemplo.com' : 'otro@ejemplo.com');
    });
    const enqueue = vi.fn(async () => {});
    const result = await reviewInboxWithRule('r1', {
      store,
      extract,
      enqueue,
      internalDomains: [],
      log: () => {},
    });
    expect(result).toEqual({ status: 'done', checked: 2, matched: 1, failed: 1 });
    expect(store.markForReprocess).toHaveBeenCalledExactlyOnceWith('a');
    expect(enqueue).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('no lee nada si la regla ya no está activa', async () => {
    const store = fakeStore(null, ['a']);
    const extract = vi.fn();
    const result = await reviewInboxWithRule('r1', {
      store,
      extract,
      enqueue: vi.fn(),
      internalDomains: [],
    });
    expect(result.status).toBe('rule-inactive');
    expect(store.listInboxCandidates).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('para al cancelarse el trabajo', async () => {
    const controller = new AbortController();
    const extract = vi.fn(async (id: string) => {
      controller.abort();
      return email(id, 'facturas@proveedor.ejemplo.com');
    });
    const result = await reviewInboxWithRule('r1', {
      store: fakeStore(rule, ['a', 'b']),
      extract,
      enqueue: vi.fn(async () => {}),
      internalDomains: [],
      signal: controller.signal,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.checked).toBe(1);
  });
});

describe('createPrismaReviewInboxStore', () => {
  it('descarta los correos con categorías puestas por una persona; las escritas por el servicio no cuentan', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'sin-categorias', seenCategories: [], appliedCategories: [] },
      {
        id: 'del-servicio',
        seenCategories: ['LATERAL'],
        appliedCategories: [{ category: 'LATERAL' }],
      },
      { id: 'del-equipo', seenCategories: ['FOOD BOX'], appliedCategories: [] },
    ]);
    const store = createPrismaReviewInboxStore({ message: { findMany } } as never);
    expect(await store.listInboxCandidates()).toEqual(['sin-categorias', 'del-servicio']);
    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      OR: [{ folder: 'inbox' }, { folder: null }],
      status: 'processed',
      corrections: { none: {} },
    });
  });

  it('marca para reprocesar y deja pendiente', async () => {
    const update = vi.fn().mockResolvedValue({});
    const store = createPrismaReviewInboxStore({ message: { update } } as never);
    await store.markForReprocess('a');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { needsReprocess: true, status: 'pending' },
    });
  });
});
