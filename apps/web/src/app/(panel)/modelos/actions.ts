'use server';

import { prisma } from '@clasificador/db';
import type { TestClassifyResult } from '@clasificador/shared';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/lib/action-state';
import { llmSelectionSchema } from '@/lib/llm-providers';
import { requireUser } from '@/lib/session';
import { getJobQueue } from '@/server/boss';
import { setActiveLlm } from '@/server/llm-settings';
import { buildTestRequest, runTestClassify } from '@/server/test-classify';

export async function changeModelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = llmSelectionSchema.safeParse({
    provider: form.get('provider'),
    model: form.get('model'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Datos no válidos.' };
  }
  try {
    await setActiveLlm(prisma(), parsed.data, user.email);
  } catch (error) {
    console.error('No se pudo cambiar el modelo activo', error);
    return { status: 'error', message: 'No se pudo guardar el cambio. Inténtalo de nuevo.' };
  }
  revalidatePath('/modelos');
  return {
    status: 'ok',
    message: `Modelo activo: ${parsed.data.provider} / ${parsed.data.model}. El worker lo usará en el siguiente trabajo.`,
  };
}

/** Resultado de «Probar»: la decisión del modelo o el motivo por el que no se pudo probar. */
export type TestState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: TestClassifyResult };

/**
 * Prueba el proveedor y modelo del formulario con un correo de ejemplo (el pegado o uno sintético
 * con un CIF de la tabla). No cambia el modelo activo ni guarda nada.
 */
export async function testModelAction(_prev: TestState, form: FormData): Promise<TestState> {
  await requireUser();
  const built = buildTestRequest({
    provider: form.get('provider'),
    model: form.get('model'),
    subject: form.get('testSubject'),
    body: form.get('testBody'),
  });
  if (!built.ok) return { status: 'error', message: built.message };

  let queue;
  try {
    queue = await getJobQueue();
  } catch (error) {
    console.error('No se pudo conectar con la cola de trabajos', error);
    return {
      status: 'error',
      message:
        'No se pudo conectar con la cola de trabajos. Comprueba que el worker ha arrancado al menos una vez y que la base de datos responde.',
    };
  }
  const outcome = await runTestClassify(queue, built.request);
  return outcome.ok
    ? { status: 'done', result: outcome.result }
    : { status: 'error', message: outcome.message };
}
