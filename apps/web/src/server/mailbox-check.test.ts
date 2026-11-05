import { CHECK_MAILBOX_QUEUE } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import type { JobQueue } from './job-runner';
import { describeMailboxCheck, requestMailboxCheck } from './mailbox-check';

function queue(output: unknown, state = 'completed') {
  return {
    send: vi.fn().mockResolvedValue('job-1'),
    getJobById: vi.fn().mockResolvedValue({ state, output }),
    cancel: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
  } satisfies JobQueue;
}

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};

const MAILBOX = 'buzon@ejemplo.com';

describe('requestMailboxCheck', () => {
  it('encola la comprobación y explica una conexión correcta', async () => {
    const q = queue({ status: 'ok', mailbox: MAILBOX, inboxTotal: 12345 });
    const out = await requestMailboxCheck(q, clock());
    expect(q.send).toHaveBeenCalledWith(CHECK_MAILBOX_QUEUE, {}, expect.any(Object));
    expect(out.ok).toBe(true);
    expect(out.message).toContain(`Bandeja de entrada de ${MAILBOX}`);
    expect(out.message).toContain('12.345 correos');
  });

  it('si el worker no responde, lo dice y cancela el trabajo', async () => {
    const q = queue(undefined, 'created');
    const out = await requestMailboxCheck(q, { ...clock(), timeoutMs: 3_000 });
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toContain('worker no respondió');
    expect(q.cancel).toHaveBeenCalled();
  });
});

describe('describeMailboxCheck', () => {
  it('un 403 apunta al ámbito de Exchange y a la guía', () => {
    const out = describeMailboxCheck({ status: 'forbidden', mailbox: MAILBOX, message: '403' });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('ámbito de Exchange');
    expect(out.message).toContain('B6');
  });

  it('un buzón no encontrado apunta a MAILBOX', () => {
    const out = describeMailboxCheck({ status: 'not-found', mailbox: MAILBOX, message: '404' });
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toContain('MAILBOX');
  });

  it('los fallos de autenticación, de configuración y otros no son correctos', () => {
    for (const result of [
      { status: 'auth', message: 'x' },
      { status: 'unconfigured', message: 'faltan credenciales' },
      { status: 'error', message: 'fetch failed' },
    ] as const) {
      expect(describeMailboxCheck(result).ok).toBe(false);
    }
  });
});
