import { describe, expect, it, vi } from 'vitest';

import {
  INSTANCE_LOCK_KEY,
  acquireInstanceLock,
  tryAcquireInstanceLock,
  type LockConnection,
} from './instance-lock';

function fakeConnection(locked: boolean) {
  const handlers: ((err: Error) => void)[] = [];
  const conn = {
    connect: vi.fn(async () => {}),
    query: vi.fn(async (text: string) => ({
      rows: text.includes('try_advisory_lock') ? [{ locked }] : [],
    })),
    end: vi.fn(async () => {}),
    on: vi.fn((_event: 'error', listener: (err: Error) => void) => {
      handlers.push(listener);
    }),
  } satisfies LockConnection;
  return { conn, emitError: (err: Error) => handlers.forEach((h) => h(err)) };
}

describe('tryAcquireInstanceLock', () => {
  it('toma el bloqueo con la clave fija y lo libera cerrando la sesión', async () => {
    const { conn } = fakeConnection(true);
    const lock = await tryAcquireInstanceLock('postgresql://x', {
      onLost: () => {},
      createConnection: () => conn,
    });
    expect(lock).not.toBeNull();
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), [
      INSTANCE_LOCK_KEY,
    ]);
    await lock!.release();
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), [
      INSTANCE_LOCK_KEY,
    ]);
    expect(conn.end).toHaveBeenCalledOnce();
  });

  it('devuelve null y cierra la conexión si otra instancia lo tiene', async () => {
    const { conn } = fakeConnection(false);
    const lock = await tryAcquireInstanceLock('postgresql://x', {
      onLost: () => {},
      createConnection: () => conn,
    });
    expect(lock).toBeNull();
    expect(conn.end).toHaveBeenCalledOnce();
  });

  it('avisa si se pierde la conexión mientras se tiene el bloqueo, pero no tras liberarlo', async () => {
    const { conn, emitError } = fakeConnection(true);
    const onLost = vi.fn();
    const lock = await tryAcquireInstanceLock('postgresql://x', {
      onLost,
      createConnection: () => conn,
    });
    emitError(new Error('conexión cortada'));
    expect(onLost).toHaveBeenCalledTimes(1);
    await lock!.release();
    emitError(new Error('otra'));
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('cierra la conexión y propaga el error si la consulta falla', async () => {
    const { conn } = fakeConnection(true);
    conn.query.mockRejectedValueOnce(new Error('sin permisos'));
    await expect(
      tryAcquireInstanceLock('postgresql://x', { onLost: () => {}, createConnection: () => conn }),
    ).rejects.toThrow('sin permisos');
    expect(conn.end).toHaveBeenCalledOnce();
  });
});

describe('acquireInstanceLock', () => {
  it('espera y reintenta hasta que la otra instancia lo suelta', async () => {
    const attempts = [fakeConnection(false), fakeConnection(false), fakeConnection(true)];
    let i = 0;
    const onWaiting = vi.fn();
    const sleep = vi.fn(async () => {});
    const lock = await acquireInstanceLock('postgresql://x', {
      onLost: () => {},
      createConnection: () => attempts[i++]!.conn,
      onWaiting,
      sleep,
      retryMs: 5,
    });
    expect(lock).not.toBeNull();
    expect(onWaiting).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it('no sigue intentando si se aborta', async () => {
    const controller = new AbortController();
    controller.abort();
    const create = vi.fn();
    const lock = await acquireInstanceLock('postgresql://x', {
      onLost: () => {},
      createConnection: create,
      signal: controller.signal,
    });
    expect(lock).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
