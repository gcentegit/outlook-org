import { z } from 'zod';

/**
 * Trabajo con el que el panel pide al worker revisar la Bandeja de entrada con una regla: relee
 * cada correo que sigue en la Bandeja y vuelve a decidir los que coinciden con ella. El panel no
 * espera al resultado (con muchos correos tarda minutos).
 */
export const REVIEW_INBOX_WITH_RULE_QUEUE = 'review-inbox-with-rule';

export const reviewInboxWithRuleSchema = z.object({ ruleId: z.string().min(1) });

export type ReviewInboxWithRule = z.infer<typeof reviewInboxWithRuleSchema>;

/** Resultado de la revisión: correos leídos, cuántos coinciden (y se vuelven a decidir) y cuántos no se pudieron leer. */
export interface ReviewInboxWithRuleResult {
  status: 'done' | 'rule-inactive';
  checked: number;
  matched: number;
  failed: number;
}
