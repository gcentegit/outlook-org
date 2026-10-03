import { z } from 'zod';

/** Proveedores de LLM soportados; el valor es el que se guarda en `LlmSetting.provider`. */
export const LLM_PROVIDER_IDS = ['anthropic', 'openrouter', 'openai-compatible', 'google'] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Proveedor y modelo elegidos (panel y prueba): el modelo es el identificador que espera el proveedor. */
export const llmSelectionSchema = z.object({
  provider: z.enum(LLM_PROVIDER_IDS, { error: 'Elige un proveedor de la lista.' }),
  model: z
    .string()
    .trim()
    .min(1, 'Indica el modelo.')
    .max(200, 'El nombre del modelo es demasiado largo.')
    .regex(/^[\w./:@+-]+$/, 'El modelo solo admite letras, números y . / : @ + - _'),
});

export type LlmSelection = z.infer<typeof llmSelectionSchema>;
