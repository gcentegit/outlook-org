import { CATEGORIES, normalizeCif } from '@clasificador/shared';
import { z } from 'zod';

export type RuleType = 'cif' | 'razon_social' | 'remitente' | 'dominio' | 'palabra_clave';
export type RuleWeight = 'fuerte' | 'medio';

/**
 * Tipos de regla en el orden en que se muestran. El peso sale del tipo: CIF y razón social
 * identifican a la sociedad y deciden solas; remitente, dominio y palabra clave solo si nada más
 * fuerte responde.
 */
export const RULE_TYPES: readonly { type: RuleType; label: string; weight: RuleWeight }[] = [
  { type: 'cif', label: 'CIF', weight: 'fuerte' },
  { type: 'razon_social', label: 'Razón social', weight: 'fuerte' },
  { type: 'remitente', label: 'Remitente', weight: 'medio' },
  { type: 'dominio', label: 'Dominio', weight: 'medio' },
  { type: 'palabra_clave', label: 'Palabra clave', weight: 'medio' },
];

const RULE_TYPE_VALUES = RULE_TYPES.map((t) => t.type) as [RuleType, ...RuleType[]];

export function ruleWeight(type: RuleType): RuleWeight {
  return RULE_TYPES.find((t) => t.type === type)?.weight ?? 'medio';
}

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
const EMAIL = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;

/**
 * Valor como lo guarda la tabla `Rule` (el CIF en mayúsculas y sin separadores ni prefijo ES;
 * remitente y dominio en minúsculas) o el motivo por el que no vale.
 */
export function normalizeRuleValue(
  type: RuleType,
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, message: 'Escribe el valor de la regla.' };
  switch (type) {
    case 'cif': {
      let cif = normalizeCif(text);
      if (/^ES[A-Z0-9]{9}$/.test(cif)) cif = cif.slice(2);
      return /^[A-Z0-9]{9}$/.test(cif)
        ? { ok: true, value: cif }
        : { ok: false, message: 'El CIF tiene que tener 9 letras o números (p. ej. B12345678).' };
    }
    case 'remitente': {
      const email = text.toLowerCase();
      return EMAIL.test(email)
        ? { ok: true, value: email }
        : { ok: false, message: 'Escribe una dirección de correo completa.' };
    }
    case 'dominio': {
      const domain = text.toLowerCase().replace(/^@/, '');
      return DOMAIN.test(domain)
        ? { ok: true, value: domain }
        : { ok: false, message: 'Escribe un dominio, sin «www» ni «https» (p. ej. ejemplo.com).' };
    }
    case 'razon_social':
    case 'palabra_clave':
      if (text.length < 3)
        return { ok: false, message: 'El valor tiene que tener al menos 3 caracteres.' };
      if (text.length > 200) return { ok: false, message: 'El valor es demasiado largo.' };
      return { ok: true, value: text };
  }
}

export const newRuleSchema = z
  .object({
    category: z.enum(CATEGORIES, { error: 'Elige una categoría.' }),
    type: z.enum(RULE_TYPE_VALUES, { error: 'Elige un tipo de regla.' }),
    value: z.string({ error: 'Escribe el valor de la regla.' }),
  })
  .transform((input, ctx) => {
    const normalized = normalizeRuleValue(input.type, input.value);
    if (!normalized.ok) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: normalized.message });
      return z.NEVER;
    }
    return { ...input, value: normalized.value, weight: ruleWeight(input.type) };
  });

export type NewRule = z.output<typeof newRuleSchema>;
