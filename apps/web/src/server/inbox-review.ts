import { REVIEW_INBOX_WITH_RULE_QUEUE, type ReviewInboxWithRule } from '@clasificador/shared';

import type { JobQueue } from './job-runner';

/** `busy`: ya hay una revisión con esa regla esperando a empezar. */
export type InboxReviewRequest = 'queued' | 'busy';

/**
 * Pide al worker que revise la Bandeja de entrada con una regla y vuelva a decidir los correos que
 * coinciden. No espera al resultado: el worker relee cada correo y con muchos tarda minutos.
 */
export async function requestInboxReview(
  queue: JobQueue,
  ruleId: string,
): Promise<InboxReviewRequest> {
  const data: ReviewInboxWithRule = { ruleId };
  const jobId = await queue.send(REVIEW_INBOX_WITH_RULE_QUEUE, data, {
    retryLimit: 0,
    expireInSeconds: 3600,
    singletonKey: ruleId,
  });
  return jobId ? 'queued' : 'busy';
}
