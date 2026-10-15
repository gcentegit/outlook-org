import { describe, expect, it } from 'vitest';

import { createOutageTracker, sanitizeCause, type OutageStore } from './outages';

function fakeStore() {
  const rows: { startedAt: Date; endedAt: Date | null; cause: string }[] = [];
  const store: OutageStore = {
    async open(startedAt, cause) {
      if (!rows.some((r) => r.endedAt === null)) rows.push({ startedAt, endedAt: null, cause });
    },
    async close(endedAt) {
      for (const r of rows) if (r.endedAt === null) r.endedAt = endedAt;
    },
  };
  return { rows, store };
}

const T0 = new Date('2026-10-15T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe('createOutageTracker', () => {
  it('abre al fallar, no duplica mientras sigue fallando y cierra al recuperarse', async () => {
    const { rows, store } = fakeStore();
    let t = 0;
    const tracker = createOutageTracker({ store, gapMs: 300_000, now: () => at(t) });
    await tracker.recovered();
    expect(rows).toHaveLength(0);
    t = 10;
    await tracker.failed('Graph 503');
    t = 100;
    await tracker.failed('Graph 503');
    expect(rows).toEqual([{ startedAt: at(10), endedAt: null, cause: 'Graph 503' }]);
    t = 190;
    await tracker.recovered();
    expect(rows[0]?.endedAt).toEqual(at(190));
    t = 300;
    await tracker.failed('otra');
    expect(rows).toHaveLength(2);
  });

  it('al arrancar tras un hueco mayor que el umbral abre desde la última sincronización', async () => {
    const { rows, store } = fakeStore();
    const tracker = createOutageTracker({ store, gapMs: 300_000, now: () => at(1000) });
    await tracker.checkGap(at(0));
    expect(rows).toEqual([{ startedAt: at(0), endedAt: null, cause: 'el worker estuvo parado' }]);
  });

  it('al arrancar sin hueco o sin sincronización previa no abre nada', async () => {
    const { rows, store } = fakeStore();
    const tracker = createOutageTracker({ store, gapMs: 300_000, now: () => at(100) });
    await tracker.checkGap(at(0));
    await tracker.checkGap(null);
    expect(rows).toHaveLength(0);
  });

  it('un fallo del almacén no se propaga', async () => {
    const logs: string[] = [];
    const tracker = createOutageTracker({
      store: {
        open: async () => Promise.reject(new Error('db caída')),
        close: async () => Promise.reject(new Error('db caída')),
      },
      gapMs: 1,
      log: (m) => logs.push(m),
    });
    await tracker.failed('x');
    await tracker.recovered();
    expect(logs).toHaveLength(2);
  });

  it('la causa guardada no lleva la dirección del buzón', async () => {
    const { rows, store } = fakeStore();
    const tracker = createOutageTracker({ store, gapMs: 1 });
    await tracker.failed(
      'Graph 503 en https://graph.microsoft.com/v1.0/users/buzon%40ejemplo.com/mailFolders/inbox/messages/delta: servicio no disponible',
    );
    const cause = rows[0]?.cause ?? '';
    expect(cause).toContain('Graph 503');
    expect(cause).not.toMatch(/buzon|ejemplo|%40|@/);
    expect(sanitizeCause('fallo con ana@ejemplo.com')).toBe('fallo con <buzón>');
  });
});
