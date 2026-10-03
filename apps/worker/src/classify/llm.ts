import { categorySchema, type Category, type ExtractedEmail } from '@clasificador/shared';
import { NoObjectGeneratedError, generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';

import { DEFAULT_LLM_MAX_CHARS, buildSystemPrompt, buildUserPrompt } from './prompt';
import {
  ProviderUnavailableError,
  createLanguageModel,
  estimateCostUsd,
  type ProviderKeys,
} from './providers';

export interface LlmSettingRecord {
  provider: string;
  model: string;
}

/** Proveedor y modelo activos; se consulta en cada llamada para que el panel pueda cambiarlos. */
export interface LlmSettingRepository {
  getActive(): Promise<LlmSettingRecord | null>;
}

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Coste estimado en USD; null si el proveedor no lo da y no hay tarifa conocida. */
  costUsd: number | null;
}

export interface LlmVerdict {
  applies: boolean;
  confidence: number;
  reason: string;
}

export type LlmOutcome =
  /** El modelo respondió con un objeto válido. */
  | {
      status: 'ok';
      model: string;
      verdicts: Partial<Record<Category, LlmVerdict>>;
      usage: LlmUsage;
      /** Milisegundos de la llamada al modelo. */
      latencyMs: number;
    }
  /** No se llamó: no hay modelo activo o falta la clave del proveedor. */
  | { status: 'unavailable'; reason: string }
  /** Se llamó y falló: error, tiempo agotado, cuota o respuesta que no cumple el esquema. */
  | {
      status: 'failed';
      model: string;
      reason: string;
      usage: LlmUsage | null;
      /** Milisegundos hasta el fallo; null si no llegó a llamarse al modelo. */
      latencyMs: number | null;
    };

export type LlmClassifier = (
  email: ExtractedEmail,
  categories: readonly Category[],
) => Promise<LlmOutcome>;

/**
 * Esquema que se envía al modelo. Sin `min`/`max`: algunos proveedores rechazan esas
 * restricciones en el esquema JSON; los límites se comprueban después con `strictResponseSchema`.
 */
const responseSchema = z.object({
  categories: z.array(
    z.object({
      category: categorySchema,
      applies: z.boolean(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

const strictResponseSchema = z.object({
  categories: z.array(
    z.object({
      category: categorySchema,
      applies: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string().max(500),
    }),
  ),
});

export interface LlmClassifierOptions {
  settings: LlmSettingRepository;
  keys: ProviderKeys;
  /** Máximo de caracteres de contenido (asunto, cuerpo y adjuntos) enviados al modelo. */
  maxChars?: number;
  timeoutMs?: number;
  /** Para pruebas: sustituye la fábrica de modelos del AI SDK. */
  createModel?: (setting: LlmSettingRecord, keys: ProviderKeys) => LanguageModel;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_CHARS = 200;

function describeError(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message;
}

function toNumberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Crea el clasificador por LLM. Nunca lanza por culpa del modelo: cualquier fallo (error de red,
 * tiempo agotado, cuota, esquema inválido) se devuelve como `failed` y la categoría queda en duda.
 */
export function createLlmClassifier(options: LlmClassifierOptions): LlmClassifier {
  const maxChars = options.maxChars ?? DEFAULT_LLM_MAX_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createModel = options.createModel ?? createLanguageModel;

  return async (email, categories) => {
    const setting = await options.settings.getActive();
    if (!setting) return { status: 'unavailable', reason: 'no hay modelo de LLM activo' };

    let model: LanguageModel;
    try {
      model = createModel(setting, options.keys);
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        return { status: 'unavailable', reason: err.message };
      }
      return {
        status: 'failed',
        model: setting.model,
        reason: describeError(err),
        usage: null,
        latencyMs: null,
      };
    }

    let usage: LlmUsage | null = null;
    const startedAt = performance.now();
    const elapsedMs = (): number => Math.round(performance.now() - startedAt);
    try {
      const result = await generateText({
        model,
        system: buildSystemPrompt(),
        prompt: buildUserPrompt(email, categories, maxChars),
        output: Output.object({ schema: responseSchema }),
        temperature: 0,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = elapsedMs();
      const inputTokens = toNumberOrNull(result.usage.inputTokens);
      const outputTokens = toNumberOrNull(result.usage.outputTokens);
      usage = {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd({
          provider: setting.provider,
          model: setting.model,
          inputTokens,
          outputTokens,
          providerMetadata: result.providerMetadata,
        }),
      };

      const parsed = strictResponseSchema.safeParse(result.output);
      if (!parsed.success) {
        return {
          status: 'failed',
          model: setting.model,
          reason: `respuesta fuera de esquema: ${z.prettifyError(parsed.error).slice(0, MAX_ERROR_CHARS)}`,
          usage,
          latencyMs,
        };
      }

      const asked = new Set<Category>(categories);
      const verdicts: Partial<Record<Category, LlmVerdict>> = {};
      for (const item of parsed.data.categories) {
        // Solo se aceptan las categorías pedidas y la primera respuesta de cada una.
        if (!asked.has(item.category) || verdicts[item.category]) continue;
        verdicts[item.category] = {
          applies: item.applies,
          confidence: item.confidence,
          reason: item.reason,
        };
      }
      return { status: 'ok', model: setting.model, verdicts, usage, latencyMs };
    } catch (err) {
      // Una respuesta ilegible también consume tokens: se registran igualmente.
      if (!usage && NoObjectGeneratedError.isInstance(err) && err.usage) {
        const inputTokens = toNumberOrNull(err.usage.inputTokens);
        const outputTokens = toNumberOrNull(err.usage.outputTokens);
        usage = {
          inputTokens,
          outputTokens,
          costUsd: estimateCostUsd({
            provider: setting.provider,
            model: setting.model,
            inputTokens,
            outputTokens,
          }),
        };
      }
      return {
        status: 'failed',
        model: setting.model,
        reason: describeError(err),
        usage,
        latencyMs: elapsedMs(),
      };
    }
  };
}
