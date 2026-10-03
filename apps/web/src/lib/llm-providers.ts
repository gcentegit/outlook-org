import {
  LLM_PROVIDER_IDS,
  llmSelectionSchema,
  type LlmProviderId,
  type LlmSelection,
} from '@clasificador/shared';

export { LLM_PROVIDER_IDS, llmSelectionSchema, type LlmProviderId, type LlmSelection };

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
  /** Modelos de ejemplo para autocompletar; el campo admite cualquier identificador. */
  examples: string[];
  /** Variable de entorno del worker con la clave (no se muestra ni se edita desde el panel). */
  keyVariable: string;
}

export const LLM_PROVIDERS: readonly LlmProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    examples: ['claude-haiku-4-5-20251001'],
    keyVariable: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    examples: ['anthropic/claude-haiku-4.5'],
    keyVariable: 'OPENROUTER_API_KEY',
  },
  {
    id: 'openai-compatible',
    label: 'Compatible con OpenAI (Ollama, Groq, Mistral...)',
    examples: ['llama3.1:8b'],
    keyVariable: 'OPENAI_COMPATIBLE_BASE_URL (y OPENAI_COMPATIBLE_API_KEY si la pide)',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    examples: ['gemini-2.5-flash'],
    keyVariable: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
];

export interface PrivacyNotice {
  level: 'info' | 'warning';
  text: string;
}

/**
 * Aviso de privacidad (RGPD) para la selección. Los correos llevan datos de proveedores y
 * facturas: solo valen proveedores que no entrenen con ellos.
 */
export function privacyNotice(provider: string, model: string): PrivacyNotice | null {
  const free = /:free$/i.test(model.trim());
  switch (provider) {
    case 'openrouter':
      return {
        level: 'warning',
        text:
          'OpenRouter reenvía los correos a terceros que pueden entrenar con ellos. Activa no-entrenar y ZDR (retención cero) en tu cuenta de OpenRouter antes de usarlo' +
          (free ? '. Los modelos gratuitos (:free) suelen entrenar con los datos: evítalos.' : '.'),
      };
    case 'google':
      return {
        level: 'warning',
        text: 'El nivel gratuito de la API de Gemini puede usar los datos para mejorar los productos de Google. Usa una cuenta con facturación y confirma en sus condiciones que no se entrena con los datos.',
      };
    case 'openai-compatible':
      return {
        level: 'warning',
        text: 'Con Ollama en la propia máquina los datos no salen del servidor. Si la URL es de un servicio externo, comprueba que no entrena con los datos y que activas la retención cero.',
      };
    case 'anthropic':
      return free
        ? null
        : {
            level: 'info',
            text: 'Los Commercial Terms de Anthropic incluyen DPA y no se entrena con los datos de la API.',
          };
    default:
      return null;
  }
}
