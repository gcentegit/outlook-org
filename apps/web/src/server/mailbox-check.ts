import {
  CHECK_MAILBOX_QUEUE,
  checkMailboxResultSchema,
  MAILBOX_CHECK_TIMEOUT_MS,
  type CheckMailboxResult,
} from '@clasificador/shared';

import { formatInt } from '@/lib/format';

import { runQueueJob, type JobQueue, type JobRunOptions } from './job-runner';

export type MailboxCheckOutcome = { ok: boolean; message: string };

/** Qué significa el resultado de la comprobación y qué revisar. */
export function describeMailboxCheck(result: CheckMailboxResult): MailboxCheckOutcome {
  switch (result.status) {
    case 'ok':
      return {
        ok: true,
        message:
          `Conexión correcta: el worker lee la Bandeja de entrada de ${result.mailbox} ` +
          `(${formatInt(result.inboxTotal)} correos). Si la sincronización figura como parada, ` +
          'se pondrá al día sola en la próxima ronda y recuperará los correos que llegaron mientras tanto.',
      };
    case 'forbidden':
      return {
        ok: false,
        message:
          `Sin permiso sobre ${result.mailbox}: Microsoft Graph responde 403. Suele deberse a que ` +
          'cambió la dirección del buzón y el ámbito de Exchange sigue con la antigua, o a que el ' +
          'ámbito se cambió hace menos de dos horas (caché de Exchange). Revisa el paso B6 de la ' +
          'guía de RBAC.',
      };
    case 'not-found':
      return {
        ok: false,
        message:
          `Microsoft Graph no encuentra el buzón ${result.mailbox}. Comprueba que la variable ` +
          'MAILBOX del worker tiene la dirección actual del buzón.',
      };
    case 'auth':
      return {
        ok: false,
        message:
          'El worker no pudo autenticarse en Microsoft Graph: revisa el certificado y los datos de ' +
          `la app del buzón (GRAPH_TENANT_ID, GRAPH_CLIENT_ID). Detalle: ${result.message}`,
      };
    case 'unconfigured':
      return { ok: false, message: result.message };
    case 'error':
      return { ok: false, message: `La comprobación falló: ${result.message}` };
  }
}

/**
 * Pide al worker que compruebe que llega al buzón (lee la Bandeja de entrada con su certificado,
 * como la sincronización) y espera el resultado ya explicado para el usuario.
 */
export async function requestMailboxCheck(
  queue: JobQueue,
  options: Partial<JobRunOptions> = {},
): Promise<MailboxCheckOutcome> {
  const outcome = await runQueueJob(
    queue,
    CHECK_MAILBOX_QUEUE,
    {},
    'la comprobación de la conexión',
    checkMailboxResultSchema,
    { ...options, timeoutMs: options.timeoutMs ?? MAILBOX_CHECK_TIMEOUT_MS },
  );
  return outcome.ok ? describeMailboxCheck(outcome.output) : outcome;
}
