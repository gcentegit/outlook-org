import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHealthServer, evaluateHealth, evaluateLoopLiveness } from './health';

const now = new Date('2026-10-02T12:00:00Z');
const FIVE_MIN = 300_000;

describe('evaluateHealth', () => {
  it('es stale si nunca se ha sincronizado', () => {
    expect(evaluateHealth(null, now, FIVE_MIN)).toEqual({ status: 'stale', lastSyncAt: null });
  });

  it('es ok con una sincronización reciente y en el límite exacto', () => {
    expect(evaluateHealth(new Date('2026-10-02T11:58:00Z'), now, FIVE_MIN).status).toBe('ok');
    expect(evaluateHealth(new Date('2026-10-02T11:55:00Z'), now, FIVE_MIN).status).toBe('ok');
  });

  it('es stale con más de 5 minutos', () => {
    expect(evaluateHealth(new Date('2026-10-02T11:54:59Z'), now, FIVE_MIN).status).toBe('stale');
  });
});

describe('createHealthServer', () => {
  const servers: ReturnType<typeof createHealthServer>[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  async function start(
    getLastSyncAt: () => Promise<Date | null>,
    extra: Partial<Parameters<typeof createHealthServer>[0]> = {},
  ): Promise<string> {
    const server = createHealthServer({
      version: 'abc123',
      staleMs: FIVE_MIN,
      getLastSyncAt,
      now: () => now,
      ...extra,
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('responde 503 sin sincronización', async () => {
    const res = await fetch(`${await start(async () => null)}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'stale',
      version: 'abc123',
      lastSyncAt: null,
      reason: 'todavía no hay ninguna sincronización correcta',
    });
  });

  it('responde 200 con una sincronización reciente', async () => {
    const res = await fetch(`${await start(async () => new Date('2026-10-02T11:59:00Z'))}/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('ok');
  });

  it('responde 503 con status error si falla la base de datos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fetch(
      `${await start(async () => {
        throw new Error('db caída');
      })}/health`,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe('error');
  });

  it('responde 503 disabled con el motivo cuando la sincronización no está en marcha', async () => {
    const getLastSyncAt = vi.fn(async () => new Date('2026-10-02T11:59:00Z'));
    const res = await fetch(
      `${await start(getLastSyncAt, {
        mode: 'shadow',
        getInactiveReason: () => 'sin credenciales de Graph (faltan: MAILBOX)',
      })}/health`,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'disabled',
      version: 'abc123',
      mode: 'shadow',
      lastSyncAt: null,
      reason: 'sin credenciales de Graph (faltan: MAILBOX)',
    });
    expect(getLastSyncAt).not.toHaveBeenCalled();
  });

  it('con retraso muestra el error de la última ronda como motivo', async () => {
    const res = await fetch(
      `${await start(async () => new Date('2026-10-02T11:00:00Z'), {
        getLastError: () => 'Graph 503',
      })}/health`,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'stale', reason: 'Graph 503' });
  });

  it('responde 200 sin motivo y con el modo cuando todo va bien', async () => {
    const res = await fetch(
      `${await start(async () => new Date('2026-10-02T11:59:00Z'), { mode: 'shadow' })}/health`,
    );
    expect(await res.json()).toEqual({
      status: 'ok',
      version: 'abc123',
      mode: 'shadow',
      lastSyncAt: '2026-10-02T11:59:00.000Z',
    });
  });

  it('responde 404 en otras rutas', async () => {
    expect((await fetch(`${await start(async () => null)}/otra`)).status).toBe(404);
  });

  it('incluye los modos por categoría y no falla si no se pueden leer', async () => {
    const modes = { LATERAL: 'live' };
    const ok = await fetch(
      `${await start(async () => now, { getCategoryModes: async () => modes })}/health`,
    );
    expect(((await ok.json()) as { categoryModes?: unknown }).categoryModes).toEqual(modes);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = await fetch(
      `${await start(async () => now, {
        getCategoryModes: async () => {
          throw new Error('sin tabla');
        },
      })}/health`,
    );
    expect(broken.status).toBe(200);
    expect(((await broken.json()) as { categoryModes?: unknown }).categoryModes).toBeUndefined();
  });

  it('/livez responde 200 aunque la sincronización esté parada: la frescura no es de su incumbencia', async () => {
    const base = await start(async () => null, {
      getInactiveReason: () => 'sin credenciales de Graph (faltan: MAILBOX)',
    });
    expect((await fetch(`${base}/health`)).status).toBe(503);
    const live = await fetch(`${base}/livez`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'alive', version: 'abc123' });
  });

  it('/livez no consulta la base de datos', async () => {
    const getLastSyncAt = vi.fn(async () => null);
    const base = await start(getLastSyncAt);
    await fetch(`${base}/livez`);
    expect(getLastSyncAt).not.toHaveBeenCalled();
  });

  it('/livez responde 503 con el motivo si el servicio no ha arrancado o el bucle está parado', async () => {
    const base = await start(async () => null, {
      getLiveness: () => ({ ok: false, reason: 'aplicando migraciones' }),
    });
    const res = await fetch(`${base}/livez`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'unavailable',
      version: 'abc123',
      reason: 'aplicando migraciones',
    });
  });
});

describe('evaluateLoopLiveness', () => {
  const limit = 15 * 60_000;

  it('sin bucle (p. ej. sin credenciales de Graph) está vivo', () => {
    expect(evaluateLoopLiveness(null, now, limit)).toEqual({ ok: true });
  });

  it('con actividad reciente está vivo, también si las rondas fallan (Graph caído)', () => {
    expect(evaluateLoopLiveness(new Date('2026-10-02T11:50:00Z'), now, limit)).toEqual({
      ok: true,
    });
  });

  it('un bucle que lleva más del límite sin avanzar no está vivo', () => {
    const result = evaluateLoopLiveness(new Date('2026-10-02T11:30:00Z'), now, limit);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('1800 s');
  });
});
