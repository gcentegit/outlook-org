import { describe, expect, it, vi } from 'vitest';

import { GraphError } from '../graph/client';
import { runCreateMasterCategory, runListMasterCategories } from './master-categories';

const access = (
  over: { getAll?: () => Promise<unknown[]>; postJson?: () => Promise<unknown> } = {},
) => ({
  mailbox: 'buzon@ejemplo.com',
  graph: {
    getAll: vi.fn(over.getAll ?? (async () => [])) as never,
    postJson: vi.fn(over.postJson ?? (async () => ({}))) as never,
  },
});

describe('runListMasterCategories', () => {
  it('devuelve las categorías ordenadas y descarta las que no tienen forma válida', async () => {
    const result = await runListMasterCategories(
      access({
        getAll: async () => [
          { id: '2', displayName: 'LATERAL', color: 'preset7' },
          { id: '1', displayName: 'ARCOBETA' },
          { displayName: 'sin id' },
          null,
        ],
      }),
    );
    expect(result).toEqual({
      status: 'ok',
      mailbox: 'buzon@ejemplo.com',
      categories: [
        { id: '1', displayName: 'ARCOBETA', color: 'none' },
        { id: '2', displayName: 'LATERAL', color: 'preset7' },
      ],
    });
  });

  it('sin credenciales de Graph explica qué falta, sin lanzar', async () => {
    const result = await runListMasterCategories({ missing: ['GRAPH_TENANT_ID', 'MAILBOX'] });
    expect(result).toEqual({
      status: 'unconfigured',
      message: 'El worker no tiene credenciales de Graph (faltan: GRAPH_TENANT_ID, MAILBOX).',
    });
  });

  it('un fallo de Graph se devuelve como error con el motivo', async () => {
    const result = await runListMasterCategories(
      access({
        getAll: async () => {
          throw new GraphError('Graph 403 en /x: Forbidden', 403);
        },
      }),
    );
    expect(result).toEqual({ status: 'error', message: 'Graph 403 en /x: Forbidden' });
  });
});

describe('runCreateMasterCategory', () => {
  it('crea la categoría con nombre y color', async () => {
    const a = access({
      postJson: async () => ({ id: '9', displayName: 'Pagado', color: 'preset4' }),
    });
    const result = await runCreateMasterCategory({ name: ' Pagado ', color: 'preset4' }, a);
    expect(result).toEqual({
      status: 'created',
      category: { id: '9', displayName: 'Pagado', color: 'preset4' },
    });
    expect(a.graph.postJson).toHaveBeenCalledWith(
      '/users/buzon%40ejemplo.com/outlook/masterCategories',
      { displayName: 'Pagado', color: 'preset4' },
    );
  });

  it('no crea una que ya existe (sin distinguir mayúsculas)', async () => {
    const a = access({
      getAll: async () => [{ id: '1', displayName: 'Lateral', color: 'preset1' }],
    });
    const result = await runCreateMasterCategory({ name: 'LATERAL', color: 'preset4' }, a);
    expect(result.status).toBe('exists');
    expect(a.graph.postJson).not.toHaveBeenCalled();
  });

  it('rechaza una petición inválida antes de llamar a Graph', async () => {
    const a = access();
    const result = await runCreateMasterCategory({ name: '', color: 'preset99' }, a);
    expect(result.status).toBe('error');
    expect(a.graph.getAll).not.toHaveBeenCalled();
  });

  it('sin credenciales de Graph lo dice; un error de Graph al crear se devuelve', async () => {
    expect(
      (await runCreateMasterCategory({ name: 'a', color: 'preset1' }, { missing: ['MAILBOX'] }))
        .status,
    ).toBe('unconfigured');
    const failing = access({
      postJson: async () => {
        throw new GraphError('Graph 409 en /x: duplicado', 409);
      },
    });
    expect(await runCreateMasterCategory({ name: 'a', color: 'preset1' }, failing)).toEqual({
      status: 'error',
      message: 'Graph 409 en /x: duplicado',
    });
  });
});
