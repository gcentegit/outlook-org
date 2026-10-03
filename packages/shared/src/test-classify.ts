import { z } from 'zod';

import { decisionSchema } from './decision-schema';
import { llmSelectionSchema } from './llm-providers';
import { SOCIEDADES } from './sociedades';

/** Cola de pg-boss con la que el panel pide al worker probar un proveedor y modelo de LLM. */
export const TEST_CLASSIFY_QUEUE = 'test-classify';

/** Tiempo máximo que el panel espera el resultado de una prueba. */
export const TEST_CLASSIFY_TIMEOUT_MS = 60_000;

export const TEST_EMAIL_LIMITS = { subject: 300, body: 20_000 } as const;

export const testClassifyRequestSchema = llmSelectionSchema.extend({
  email: z.object({
    subject: z.string().max(TEST_EMAIL_LIMITS.subject),
    body: z.string().min(1).max(TEST_EMAIL_LIMITS.body),
  }),
});

export type TestClassifyRequest = z.infer<typeof testClassifyRequestSchema>;

const usageSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
});

/**
 * Resultado de la prueba. `unavailable`: no se llamó al modelo (p. ej. falta la clave del
 * proveedor); `failed`: se llamó y falló. En ambos casos `message` explica el motivo.
 */
export const testClassifyResultSchema = z.object({
  status: z.enum(['ok', 'unavailable', 'failed']),
  message: z.string().nullable(),
  decision: decisionSchema.nullable(),
  usage: usageSchema.nullable(),
  latencyMs: z.number().nullable(),
});

export type TestClassifyResult = z.infer<typeof testClassifyResultSchema>;

/** Correo sintético para probar un modelo sin pegar datos reales; lleva el CIF de una sociedad de la tabla. */
export function sampleTestEmail(): TestClassifyRequest['email'] {
  const sociedad = SOCIEDADES.find((s) => s.category === 'LATERAL') ?? SOCIEDADES[0]!;
  return {
    subject: 'Factura 2026-0153 de Suministros Ejemplo, S.L.',
    body: [
      'Buenos días,',
      '',
      'Adjuntamos la factura 2026-0153 correspondiente al servicio de septiembre.',
      '',
      'FACTURA 2026-0153',
      'Emisor: Suministros Ejemplo, S.L. (CIF B00000000)',
      `Cliente: ${sociedad.razonSocial}`,
      `CIF cliente: ${sociedad.cif}`,
      'Importe total: 1.210,00 EUR (IVA incluido)',
      '',
      'Un saludo.',
    ].join('\n'),
  };
}
