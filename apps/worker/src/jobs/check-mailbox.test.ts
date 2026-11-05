import { describe, expect, it, vi } from 'vitest';

import { GraphError } from '../graph/client';
import { runCheckMailbox } from './check-mailbox';

const MAILBOX = 'buzon@ejemplo.com';

const failing = (error: unknown) => ({
  graph: {
    getJson: vi.fn(async () => {
      throw error;
    }),
  },
  mailbox: MAILBOX,
});

describe('runCheckMailbox', () => {
  it('lee la Bandeja de entrada del buzón configurado y devuelve cuántos correos tiene', async () => {
    const getJson = vi.fn(async () => ({ id: 'inbox', totalItemCount: 42 }));
    const result = await runCheckMailbox({ graph: { getJson } as never, mailbox: MAILBOX });
    expect(result).toEqual({ status: 'ok', mailbox: MAILBOX, inboxTotal: 42 });
    expect(getJson).toHaveBeenCalledWith(
      '/users/buzon%40ejemplo.com/mailFolders/inbox?$select=id,totalItemCount',
    );
  });

  it('sin credenciales de Graph dice cuáles faltan', async () => {
    expect(await runCheckMailbox({ missing: ['GRAPH_CERT_PATH', 'MAILBOX'] })).toEqual({
      status: 'unconfigured',
      message: 'El worker no tiene credenciales de Graph (faltan: GRAPH_CERT_PATH, MAILBOX).',
    });
  });

  it('un 403 es falta de permiso sobre el buzón', async () => {
    const result = await runCheckMailbox(
      failing(new GraphError('Graph 403: ErrorAccessDenied', 403)),
    );
    expect(result).toEqual({
      status: 'forbidden',
      mailbox: MAILBOX,
      message: 'Graph 403: ErrorAccessDenied',
    });
  });

  it('un 404 es un buzón que no existe con esa dirección', async () => {
    const result = await runCheckMailbox(failing(new GraphError('Graph 404', 404)));
    expect(result).toMatchObject({ status: 'not-found', mailbox: MAILBOX });
  });

  it('un 401 o un fallo al pedir el token es un problema de autenticación', async () => {
    expect(await runCheckMailbox(failing(new GraphError('Graph 401', 401)))).toMatchObject({
      status: 'auth',
    });
    const tokenError = Object.assign(new Error('certificado no válido'), {
      name: 'AuthenticationError',
    });
    expect(await runCheckMailbox(failing(tokenError))).toEqual({
      status: 'auth',
      message: 'certificado no válido',
    });
  });

  it('cualquier otro fallo se devuelve como error sin lanzar', async () => {
    expect(await runCheckMailbox(failing(new TypeError('fetch failed')))).toEqual({
      status: 'error',
      message: 'fetch failed',
    });
    expect(await runCheckMailbox(failing(new GraphError('Graph 500', 500)))).toMatchObject({
      status: 'error',
    });
  });
});
