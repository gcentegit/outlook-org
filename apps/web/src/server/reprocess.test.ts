import { REPROCESS_FLAGGED_QUEUE } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import type { JobQueue } from './job-runner';
import { requestReprocess } from './reprocess';

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

describe('requestReprocess', () => {
  it('encola el trabajo y devuelve cuántos correos se volvieron a encolar', async () => {
    const q = queue({ enqueued: 7 });
    expect(await requestReprocess(q, clock())).toEqual({ ok: true, enqueued: 7 });
    expect(q.send).toHaveBeenCalledWith(REPROCESS_FLAGGED_QUEUE, {}, expect.any(Object));
  });

  it('si el worker no responde, lo dice y cancela el trabajo', async () => {
    const q = queue(undefined, 'created');
    const out = await requestReprocess(q, { ...clock(), timeoutMs: 3_000 });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message).toContain('worker no respondió');
    expect(q.cancel).toHaveBeenCalled();
  });
});
