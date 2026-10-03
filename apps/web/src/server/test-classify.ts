import {
  TEST_CLASSIFY_QUEUE,
  TEST_CLASSIFY_TIMEOUT_MS,
  TEST_EMAIL_LIMITS,
  llmSelectionSchema,
  sampleTestEmail,
  testClassifyResultSchema,
  type TestClassifyRequest,
  type TestClassifyResult,
} from '@clasificador/shared';

import { runQueueJob, type JobQueue } from './job-runner';

export type TestClassifyOutcome =
  { ok: true; result: TestClassifyResult } | { ok: false; message: string };

export interface TestClassifyOptions {
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Encola la prueba y espera el resultado con sondeo, hasta `TEST_CLASSIFY_TIMEOUT_MS`. Si se agota
 * el tiempo cancela el trabajo para que el worker no llame al modelo cuando ya nadie espera. El
 * trabajo (y con él el texto pegado) se borra en cuanto se lee el resultado.
 */
export async function runTestClassify(
  queue: JobQueue,
  request: TestClassifyRequest,
  options: TestClassifyOptions = {},
): Promise<TestClassifyOutcome> {
  const outcome = await runQueueJob(
    queue,
    TEST_CLASSIFY_QUEUE,
    request,
    'la prueba',
    testClassifyResultSchema,
    { ...options, timeoutMs: options.timeoutMs ?? TEST_CLASSIFY_TIMEOUT_MS },
  );
  return outcome.ok ? { ok: true, result: outcome.output } : outcome;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Petición de prueba a partir de los campos del formulario. Sin texto pegado se usa el correo
 * sintético (con el CIF de una sociedad de la tabla); el asunto escrito se respeta.
 */
export function buildTestRequest(fields: {
  provider: unknown;
  model: unknown;
  subject: unknown;
  body: unknown;
}): { ok: true; request: TestClassifyRequest } | { ok: false; message: string } {
  const selection = llmSelectionSchema.safeParse({
    provider: fields.provider,
    model: fields.model,
  });
  if (!selection.success) {
    return { ok: false, message: selection.error.issues[0]?.message ?? 'Datos no válidos.' };
  }
  const subject = text(fields.subject);
  const body = text(fields.body);
  if (subject.length > TEST_EMAIL_LIMITS.subject) {
    return {
      ok: false,
      message: `El asunto no puede pasar de ${TEST_EMAIL_LIMITS.subject} caracteres.`,
    };
  }
  if (body.length > TEST_EMAIL_LIMITS.body) {
    return {
      ok: false,
      message: `El texto no puede pasar de ${TEST_EMAIL_LIMITS.body} caracteres.`,
    };
  }
  const sample = sampleTestEmail();
  const email = body
    ? { subject, body }
    : { subject: subject || sample.subject, body: sample.body };
  return { ok: true, request: { ...selection.data, email } };
}
