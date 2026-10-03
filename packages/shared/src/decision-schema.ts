import { z } from 'zod';

import { CATEGORIES } from './categories';

export const categorySchema = z.enum(CATEGORIES);

/**
 * Quién ha tomado la decisión: una regla, el LLM, la herencia del hilo (`conversationId`) o
 * `none` cuando no hubo ninguna señal ni LLM (sin `ruleId` ni `model`; queda en revisión salvo
 * que no haya nada pendiente, p. ej. el equipo ya puso todas las categorías).
 */
export const decisionSourceSchema = z.enum(['rule', 'llm', 'thread', 'none']);

export const decisionModeSchema = z.enum(['shadow', 'live']);

/**
 * Decisión del clasificador para un correo. Se valida con este esquema tanto la salida del
 * LLM/reglas como lo que se guarda en la base de datos. Un correo dudoso lleva
 * `categories: []` y `needsReview: true`; nunca se inventa una categoría.
 */
export const decisionSchema = z
  .object({
    messageId: z.string().min(1),
    categories: z.array(categorySchema).max(CATEGORIES.length),
    source: decisionSourceSchema,
    /** Identificador de la regla que decidió; solo si `source` es `rule`. */
    ruleId: z.string().min(1).nullable(),
    /** Modelo del LLM usado; solo si `source` es `llm`. */
    model: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
    reason: z.string().min(1),
    mode: decisionModeSchema,
  })
  .superRefine((d, ctx) => {
    if (new Set(d.categories).size !== d.categories.length) {
      ctx.addIssue({ code: 'custom', path: ['categories'], message: 'Categorías repetidas' });
    }
    if (d.source === 'rule' && d.ruleId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['ruleId'],
        message: 'Falta ruleId en una decisión de regla',
      });
    }
    if (d.source === 'none') {
      if (d.ruleId !== null || d.model !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['source'],
          message: 'Una decisión sin fuente no lleva ruleId ni model',
        });
      }
    }
    if (d.source === 'llm' && d.model === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'Falta model en una decisión del LLM',
      });
    }
  });

export type Decision = z.infer<typeof decisionSchema>;
export type DecisionSource = z.infer<typeof decisionSourceSchema>;
export type DecisionMode = z.infer<typeof decisionModeSchema>;
