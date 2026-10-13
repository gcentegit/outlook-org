import { CHECK_FOLDERS_QUEUE } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import { requestFolderCheck } from './folder-check';
import type { JobQueue } from './job-runner';

function queue(jobId: string | null) {
  return {
    send: vi.fn().mockResolvedValue(jobId),
    getJobById: vi.fn(),
    cancel: vi.fn(),
    deleteJob: vi.fn(),
  } satisfies JobQueue;
}

describe('requestFolderCheck', () => {
  it('encola la comprobación sin esperar al resultado', async () => {
    const q = queue('job-1');
    expect(await requestFolderCheck(q)).toBe('queued');
    expect(q.send).toHaveBeenCalledWith(CHECK_FOLDERS_QUEUE, {}, expect.any(Object));
    expect(q.getJobById).not.toHaveBeenCalled();
  });

  it('si ya hay una esperando, pg-boss no crea otra y lo dice', async () => {
    expect(await requestFolderCheck(queue(null))).toBe('busy');
  });
});
