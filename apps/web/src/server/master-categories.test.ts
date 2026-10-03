import { CREATE_MASTER_CATEGORY_QUEUE, LIST_MASTER_CATEGORIES_QUEUE } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import type { JobQueue } from './job-runner';
import {
  createMasterCategory,
  hasCategoryNamed,
  listMasterCategories,
  missingCategories,
} from './master-categories';

function queueReturning(output: unknown, state = 'completed') {
  return {
    send: vi.fn().mockResolvedValue('job-1'),
    getJobById: vi.fn().mockResolvedValue({ state, output }),
    cancel: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
  } satisfies JobQueue;
}

/** Reloj simulado: cada espera avanza el tiempo, sin esperar de verdad. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('listMasterCategories', () => {
  it('pide la lista al worker y devuelve lo que responde', async () => {
    const output = {
      status: 'ok',
      mailbox: 'buzon@ejemplo.com',
      categories: [{ id: '1', displayName: 'LATERAL', color: 'preset4' }],
    };
    const queue = queueReturning(output);
    expect(await listMasterCategories(queue, clock())).toEqual(output);
    expect(queue.send).toHaveBeenCalledWith(LIST_MASTER_CATEGORIES_QUEUE, {}, expect.any(Object));
  });

  it('si el worker no tiene credenciales de Graph, devuelve su motivo (sin fallar)', async () => {
    const output = { status: 'unconfigured', message: 'faltan GRAPH_TENANT_ID' };
    expect(await listMasterCategories(queueReturning(output), clock())).toEqual(output);
  });

  it('si el worker no responde, devuelve un error con el motivo y cancela el trabajo', async () => {
    const queue = queueReturning(undefined, 'created');
    const result = await listMasterCategories(queue, { ...clock(), timeoutMs: 5_000 });
    expect(result).toMatchObject({ status: 'error' });
    expect(result.status === 'error' && result.message).toContain('worker no respondió');
    expect(queue.cancel).toHaveBeenCalledWith(LIST_MASTER_CATEGORIES_QUEUE, 'job-1');
  });

  it('si la cola no está disponible, devuelve un error en lugar de lanzar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = queueReturning({});
    queue.send.mockRejectedValue(new Error('base de datos caída'));
    expect((await listMasterCategories(queue, clock())).status).toBe('error');
  });
});

describe('createMasterCategory', () => {
  it('envía nombre y color al worker y devuelve la categoría creada', async () => {
    const category = { id: '9', displayName: 'Pagado', color: 'preset4' };
    const queue = queueReturning({ status: 'created', category });
    const result = await createMasterCategory(queue, { name: 'Pagado', color: 'preset4' }, clock());
    expect(result).toEqual({ status: 'created', category });
    expect(queue.send).toHaveBeenCalledWith(
      CREATE_MASTER_CATEGORY_QUEUE,
      { name: 'Pagado', color: 'preset4' },
      expect.any(Object),
    );
  });

  it('propaga que ya existía y los errores de Graph', async () => {
    expect(
      await createMasterCategory(
        queueReturning({ status: 'exists', message: 'Ya existe' }),
        { name: 'a', color: 'preset1' },
        clock(),
      ),
    ).toEqual({ status: 'exists', message: 'Ya existe' });
    expect(
      await createMasterCategory(
        queueReturning({ status: 'error', message: 'Graph 403' }),
        { name: 'a', color: 'preset1' },
        clock(),
      ),
    ).toEqual({ status: 'error', message: 'Graph 403' });
  });

  it('un resultado con otra forma se rechaza como error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await createMasterCategory(
      queueReturning({ raro: true }),
      { name: 'a', color: 'preset1' },
      clock(),
    );
    expect(result.status).toBe('error');
  });
});

describe('missingCategories y hasCategoryNamed', () => {
  const existing = [
    { id: '1', displayName: 'Food Box', color: 'preset0' },
    { id: '2', displayName: 'lateral', color: 'preset1' },
  ];

  it('detecta las categorías del clasificador que faltan, sin distinguir mayúsculas', () => {
    expect(missingCategories(existing)).toEqual(['ARCOBETA']);
    expect(missingCategories([])).toEqual(['FOOD BOX', 'LATERAL', 'ARCOBETA']);
  });

  it('busca por nombre sin distinguir mayúsculas ni espacios de los extremos', () => {
    expect(hasCategoryNamed(existing, ' LATERAL ')).toBe(true);
    expect(hasCategoryNamed(existing, 'ARCOBETA')).toBe(false);
  });
});
