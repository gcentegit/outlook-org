import { REVIEW_INBOX_WITH_RULE_QUEUE } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import { requestInboxReview } from './inbox-review';
import type { JobQueue } from './job-runner';

function queue(jobId: string | null) {
  return {
    send: vi.fn().mockResolvedValue(jobId),
    getJobById: vi.fn(),
    cancel: vi.fn(),
    deleteJob: vi.fn(),
  } satisfies JobQueue;
}

describe('requestInboxReview', () => {
  it('encola la revisión de esa regla, una en espera por regla, sin esperar al resultado', async () => {
    const q = queue('job-1');
    expect(await requestInboxReview(q, 'r1')).toBe('queued');
    expect(q.send).toHaveBeenCalledWith(
      REVIEW_INBOX_WITH_RULE_QUEUE,
      { ruleId: 'r1' },
      expect.objectContaining({ singletonKey: 'r1' }),
    );
    expect(q.getJobById).not.toHaveBeenCalled();
  });

  it('si ya hay una esperando para esa regla, lo dice', async () => {
    expect(await requestInboxReview(queue(null), 'r1')).toBe('busy');
  });
});
