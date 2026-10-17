'use server';

import { prisma } from '@clasificador/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionState } from '@/lib/action-state';
import { newRuleSchema } from '@/lib/rule-form';
import { requireUser } from '@/lib/session';
import { getJobQueue } from '@/server/boss';
import { requestInboxReview } from '@/server/inbox-review';
import { createRule, setRuleActive } from '@/server/rules';

/** Resultado del alta: si sale bien, lleva la regla creada para ofrecer revisar la Bandeja con ella. */
export type CreateRuleState =
  ActionState | { status: 'created'; message: string; ruleId: string; category: string };

export async function createRuleAction(
  _prev: CreateRuleState,
  form: FormData,
): Promise<CreateRuleState> {
  const user = await requireUser();
  const parsed = newRuleSchema.safeParse({
    category: form.get('category'),
    type: form.get('type'),
    value: form.get('value'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Datos no válidos.' };
  }
  let result;
  try {
    result = await createRule(prisma(), parsed.data, user.email);
  } catch (error) {
    console.error('No se pudo crear la regla', error);
    return { status: 'error', message: 'No se pudo guardar la regla. Inténtalo de nuevo.' };
  }
  if (!result.ok) return { status: 'error', message: result.message };
  revalidatePath('/reglas');
  return {
    status: 'created',
    message: `Regla creada para ${parsed.data.category}: «${parsed.data.value}». El worker la aplicará desde el siguiente correo.`,
    ruleId: result.id,
    category: parsed.data.category,
  };
}

const toggleSchema = z.object({
  id: z.string().min(1),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export async function setRuleActiveAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = toggleSchema.safeParse({ id: form.get('id'), active: form.get('active') });
  if (!parsed.success) return { status: 'error', message: 'Datos no válidos.' };
  try {
    const result = await setRuleActive(prisma(), parsed.data.id, parsed.data.active, user.email);
    if (!result.ok) return { status: 'error', message: result.message };
  } catch (error) {
    console.error('No se pudo cambiar el estado de la regla', error);
    return { status: 'error', message: 'No se pudo guardar el cambio. Inténtalo de nuevo.' };
  }
  revalidatePath('/reglas');
  return { status: 'ok', message: parsed.data.active ? 'Regla activada.' : 'Regla desactivada.' };
}

/**
 * Pide al worker que relea los correos de la Bandeja de entrada y vuelva a decidir los que
 * coinciden con la regla. No espera: el resultado se ve al recargar, en «Correos decididos».
 */
export async function reviewInboxAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const ruleId = form.get('ruleId');
  if (typeof ruleId !== 'string' || !ruleId)
    return { status: 'error', message: 'Datos no válidos.' };
  try {
    const outcome = await requestInboxReview(await getJobQueue(), ruleId);
    return {
      status: 'ok',
      message:
        outcome === 'queued'
          ? 'Revisión pedida. El worker relee los correos de la Bandeja y vuelve a decidir los que coinciden; puede tardar unos minutos. Recarga para ver el resultado en «Correos decididos».'
          : 'Ya hay una revisión pendiente con esta regla. Recarga en unos minutos para ver el resultado.',
    };
  } catch (error) {
    console.error('No se pudo pedir la revisión de la Bandeja', error);
    return {
      status: 'error',
      message:
        'No se pudo pedir la revisión. Comprueba que el worker ha arrancado y que la base de datos responde.',
    };
  }
}
