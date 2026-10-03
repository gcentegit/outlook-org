import {
  CATEGORIES,
  testClassifyRequestSchema,
  type ExtractedEmail,
  type TestClassifyResult,
} from '@clasificador/shared';
import type { LanguageModel } from 'ai';

import {
  classify,
  createLlmClassifier,
  type LlmClassifier,
  type LlmOutcome,
  type LlmSettingRecord,
  type ProviderKeys,
} from '../classify';

export interface TestClassifyDeps {
  keys: ProviderKeys;
  confidenceThreshold?: number;
  /** Para pruebas: sustituye la fábrica de modelos del AI SDK. */
  createModel?: (setting: LlmSettingRecord, keys: ProviderKeys) => LanguageModel;
}

/** Margen bajo el tiempo máximo del panel (60 s) para que la respuesta llegue a tiempo. */
const TEST_LLM_TIMEOUT_MS = 25_000;

/**
 * Prueba un proveedor y modelo concretos con un correo de ejemplo. El correo va directo al
 * modelo, sin reglas ni herencia del hilo (con reglas, un correo con CIF de la tabla nunca
 * llegaría al LLM), y no toca `LlmSetting`. Nunca guarda nada.
 *
 * Lanza solo si la petición no cumple el esquema (el panel ya la valida: sería un fallo de
 * versiones). Los problemas del proveedor se devuelven como `unavailable` o `failed`.
 */
export async function runTestClassify(
  data: unknown,
  deps: TestClassifyDeps,
): Promise<TestClassifyResult> {
  const request = testClassifyRequestSchema.parse(data);
  const setting = { provider: request.provider, model: request.model };

  const llm = createLlmClassifier({
    settings: { getActive: async () => setting },
    keys: deps.keys,
    timeoutMs: TEST_LLM_TIMEOUT_MS,
    ...(deps.createModel ? { createModel: deps.createModel } : {}),
  });
  let outcome: LlmOutcome | null = null;
  const capturing: LlmClassifier = async (email, categories) => {
    outcome = await llm(email, categories);
    return outcome;
  };

  const email: ExtractedEmail = {
    messageId: 'prueba-del-panel',
    conversationId: null,
    internetMessageId: null,
    receivedAt: new Date(),
    fromAddress: null,
    fromName: null,
    subject: request.email.subject,
    bodyText: request.email.body,
    categories: [],
    attachments: [],
  };
  const result = await classify(email, {
    availableCategories: CATEGORIES,
    mode: 'shadow',
    rules: { listActiveRules: async () => [] },
    threads: { findThreadCategories: async () => [] },
    llm: capturing,
    ...(deps.confidenceThreshold !== undefined
      ? { confidenceThreshold: deps.confidenceThreshold }
      : {}),
  });

  const final = outcome as LlmOutcome | null;
  if (final?.status === 'unavailable') {
    return {
      status: 'unavailable',
      message: final.reason,
      decision: null,
      usage: null,
      latencyMs: null,
    };
  }
  if (final?.status === 'failed') {
    return {
      status: 'failed',
      message: final.reason,
      decision: null,
      usage: final.usage,
      latencyMs: final.latencyMs,
    };
  }
  return {
    status: 'ok',
    message: null,
    decision: result.decision,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}
