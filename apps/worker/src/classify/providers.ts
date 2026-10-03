import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { isLlmProviderId } from '@clasificador/shared';
import type { LanguageModel } from 'ai';

/** Claves y URL de los proveedores. Vienen solo de variables de entorno, nunca de la base de datos. */
export interface ProviderKeys {
  ANTHROPIC_API_KEY?: string | undefined;
  OPENROUTER_API_KEY?: string | undefined;
  GOOGLE_GENERATIVE_AI_API_KEY?: string | undefined;
  OPENAI_COMPATIBLE_BASE_URL?: string | undefined;
  OPENAI_COMPATIBLE_API_KEY?: string | undefined;
}

/** El proveedor elegido no se puede usar (desconocido o sin clave). No es un fallo del modelo. */
export class ProviderUnavailableError extends Error {
  override name = 'ProviderUnavailableError';
}

function need(value: string | undefined, name: string, provider: string): string {
  if (!value?.trim()) {
    throw new ProviderUnavailableError(`Falta ${name} para el proveedor ${provider}`);
  }
  return value;
}

/**
 * Construye el modelo del AI SDK para el proveedor y modelo activos. Lanza
 * `ProviderUnavailableError` si el proveedor es desconocido o falta su clave.
 */
export function createLanguageModel(
  setting: { provider: string; model: string },
  keys: ProviderKeys,
): LanguageModel {
  const { provider, model } = setting;
  if (!isLlmProviderId(provider)) {
    throw new ProviderUnavailableError(`Proveedor de LLM desconocido: ${provider}`);
  }
  switch (provider) {
    case 'anthropic':
      return createAnthropic({
        apiKey: need(keys.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY', provider),
      })(model);
    case 'openrouter':
      return createOpenRouter({
        apiKey: need(keys.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY', provider),
      }).chat(model);
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: need(keys.GOOGLE_GENERATIVE_AI_API_KEY, 'GOOGLE_GENERATIVE_AI_API_KEY', provider),
      })(model);
    case 'openai-compatible': {
      const baseURL = need(keys.OPENAI_COMPATIBLE_BASE_URL, 'OPENAI_COMPATIBLE_BASE_URL', provider);
      // Ollama local no necesita clave; Groq, Mistral y similares sí.
      const apiKey = keys.OPENAI_COMPATIBLE_API_KEY?.trim() || undefined;
      return createOpenAICompatible({ name: 'openai-compatible', baseURL, apiKey })(model);
    }
  }
}

/** Precio en USD por millón de tokens (entrada, salida) de los modelos con tarifa conocida. */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'anthropic:claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

function openRouterReportedCost(providerMetadata: unknown): number | null {
  if (typeof providerMetadata !== 'object' || providerMetadata === null) return null;
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (typeof openrouter !== 'object' || openrouter === null) return null;
  const usage = (openrouter as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
}

/**
 * Coste estimado en USD de una llamada, o null si el proveedor no lo da y el modelo no tiene
 * tarifa conocida (Ollama es local y gratuito en dinero: tampoco se estima).
 */
export function estimateCostUsd(args: {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  providerMetadata?: unknown;
}): number | null {
  const reported = openRouterReportedCost(args.providerMetadata);
  if (reported !== null) return reported;
  const price = PRICE_PER_MILLION[`${args.provider}:${args.model}`];
  if (!price || args.inputTokens === null || args.outputTokens === null) return null;
  return (args.inputTokens * price.input + args.outputTokens * price.output) / 1_000_000;
}
