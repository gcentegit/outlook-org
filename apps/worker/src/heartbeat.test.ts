import { describe, expect, it, vi } from 'vitest';

import { buildHeartbeatUrl, createHeartbeat } from './heartbeat';

describe('buildHeartbeatUrl', () => {
  it('añade status, msg y ping conservando el resto de la URL de push', () => {
    const url = new URL(
      buildHeartbeatUrl('https://kuma.example/api/push/TOKEN?x=1', 'up', 'ok: 2 nuevos'),
    );
    expect(url.pathname).toBe('/api/push/TOKEN');
    expect(url.searchParams.get('x')).toBe('1');
    expect(url.searchParams.get('status')).toBe('up');
    expect(url.searchParams.get('msg')).toBe('ok: 2 nuevos');
    expect(url.searchParams.has('ping')).toBe(true);
  });

  it('sustituye el status que ya traiga la URL', () => {
    const url = new URL(
      buildHeartbeatUrl('https://k/api/push/T?status=up&msg=OK&ping=', 'down', 'fallo'),
    );
    expect(url.searchParams.getAll('status')).toEqual(['down']);
    expect(url.searchParams.get('msg')).toBe('fallo');
  });
});

describe('createHeartbeat', () => {
  it('sin URL no hace ninguna petición', async () => {
    const fetchImpl = vi.fn();
    await createHeartbeat({ fetchImpl: fetchImpl as never }).ping('up', 'ok');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hace GET a la URL de push', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response('{"ok":true}'),
    );
    await createHeartbeat({ url: 'https://k/api/push/T', fetchImpl }).ping('up', 'ok');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('status=up');
  });

  it('nunca lanza: un fallo de red o un 404 solo se registran', async () => {
    const log = vi.fn();
    await createHeartbeat({
      url: 'https://k/api/push/T',
      fetchImpl: vi.fn(async () => {
        throw new Error('sin red');
      }),
      log,
    }).ping('up', 'ok');
    await createHeartbeat({
      url: 'https://k/api/push/T',
      fetchImpl: vi.fn(async () => new Response('no', { status: 404 })),
      log,
    }).ping('up', 'ok');
    expect(log).toHaveBeenCalledTimes(2);
  });
});
