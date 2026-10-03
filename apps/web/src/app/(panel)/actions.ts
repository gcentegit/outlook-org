'use server';

import { prisma } from '@clasificador/db';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/lib/action-state';
import { requireUser } from '@/lib/session';
import { getJobQueue } from '@/server/boss';
import { requestReprocess } from '@/server/reprocess';

/**
 * Vuelve a encolar los correos marcados para reprocesar (los decididos con un fallo técnico y los
 * que agotaron los reintentos). Lo hace el worker, que es quien los procesa; el panel solo lo pide
 * y espera a saber cuántos eran.
 */
export async function reprocessFlaggedAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  await requireUser();
  try {
    if ((await prisma().message.count({ where: { needsReprocess: true } })) === 0) {
      return { status: 'ok', message: 'No hay correos marcados para reprocesar.' };
    }
    const outcome = await requestReprocess(await getJobQueue());
    if (!outcome.ok) return { status: 'error', message: outcome.message };
    revalidatePath('/');
    return {
      status: 'ok',
      message: `${outcome.enqueued} correo(s) vuelto(s) a encolar. El worker los procesará en breve.`,
    };
  } catch (error) {
    console.error('No se pudo pedir el reproceso', error);
    return {
      status: 'error',
      message:
        'No se pudo pedir el reproceso. Comprueba que el worker ha arrancado y que la base de datos responde.',
    };
  }
}
