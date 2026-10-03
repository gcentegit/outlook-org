import { describe, expect, it, vi } from 'vitest';

import type { SyncResult } from './delta';
import { createPoller, type Poller } from './poller';

const ok: SyncResult = { enqueued: 1, changed: 0, corrections: 0, removed: 0, resynced: false };

describe('createPoller', () => {
  it('ejecuta rondas seguidas, avisa al heartbeat y para sin dejar rondas a medias', async () => {
    const ping = vi.fn(async () => {});
    let cycles = 0;
    let stopped: Promise<void> = Promise.resolve();
    const poller: Poller = createPoller({
      intervalMs: 5,
      heartbeat: { ping },
      log: () => {},
      runCycle: async () => {
        cycles++;
        if (cycles === 3) stopped = poller.stop();
        return ok;
      },
      wait: async () => {},
    });
    poller.start();
    while (cycles < 3) await new Promise((r) => setTimeout(r, 1));
    await stopped;
    expect(cycles).toBe(3);
    expect(ping).toHaveBeenCalledTimes(3);
    expect(ping).toHaveBeenCalledWith('up', expect.stringContaining('1 nuevos'));
    expect(poller.lastError()).toBeNull();
  });

  it('un fallo avisa con down, guarda el error y la siguiente ronda se recupera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ping = vi.fn(async () => {});
    let cycles = 0;
    let stopped: Promise<void> = Promise.resolve();
    const errors: (string | null)[] = [];
    const poller: Poller = createPoller({
      intervalMs: 5,
      heartbeat: { ping },
      log: () => {},
      runCycle: async () => {
        cycles++;
        errors.push(poller.lastError());
        if (cycles === 1) throw new Error('Graph 503');
        stopped = poller.stop();
        return ok;
      },
      wait: async () => {},
    });
    poller.start();
    while (cycles < 2) await new Promise((r) => setTimeout(r, 1));
    await stopped;
    expect(ping).toHaveBeenNthCalledWith(1, 'down', 'Graph 503');
    expect(ping).toHaveBeenNthCalledWith(2, 'up', expect.any(String));
    expect(errors).toEqual([null, 'Graph 503']);
    expect(poller.lastError()).toBeNull();
    vi.restoreAllMocks();
  });

  it('stop interrumpe la espera entre rondas', async () => {
    const poller = createPoller({
      intervalMs: 60_000,
      heartbeat: { ping: async () => {} },
      log: () => {},
      runCycle: async () => ok,
    });
    poller.start();
    await poller.stop();
  });

  it('registra la actividad del bucle aunque las rondas fallen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const poller = createPoller({
      intervalMs: 60_000,
      heartbeat: { ping: async () => {} },
      log: () => {},
      runCycle: async () => {
        throw new Error('Graph 503');
      },
      wait: async () => gate,
    });
    expect(poller.lastActivityAt()).toBeNull();
    const before = Date.now();
    poller.start();
    while (poller.lastError() === null) await new Promise((r) => setTimeout(r, 1));
    expect(poller.lastActivityAt()!.getTime()).toBeGreaterThanOrEqual(before);
    release();
    await poller.stop();
    vi.restoreAllMocks();
  });
});
