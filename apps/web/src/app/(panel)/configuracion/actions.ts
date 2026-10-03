'use server';

import { prisma } from '@clasificador/db';
import { CATEGORIES } from '@clasificador/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionState } from '@/lib/action-state';
import { requireUser } from '@/lib/session';
import { addAllowedUser, removeAllowedUser } from '@/server/allowed-users';
import { setCategoryMode } from '@/server/category-modes';

const modeSchema = z.object({
  category: z.enum(CATEGORIES),
  mode: z.enum(['shadow', 'live']),
});

export async function setCategoryModeAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = modeSchema.safeParse({ category: form.get('category'), mode: form.get('mode') });
  if (!parsed.success) return { status: 'error', message: 'Datos no válidos.' };
  // Pasar a live aplica categorías en los correos de todo el equipo: exige confirmación explícita.
  if (parsed.data.mode === 'live' && form.get('confirmado') !== 'si') {
    return { status: 'error', message: 'Confirma el paso a live marcando la casilla.' };
  }
  try {
    const result = await setCategoryMode(
      prisma(),
      parsed.data.category,
      parsed.data.mode,
      user.email,
    );
    if (!result.ok) return { status: 'error', message: result.message };
  } catch (error) {
    console.error('No se pudo cambiar el modo de la categoría', error);
    return { status: 'error', message: 'No se pudo guardar el cambio. Inténtalo de nuevo.' };
  }
  revalidatePath('/configuracion');
  return {
    status: 'ok',
    message: `${parsed.data.category}: modo ${parsed.data.mode === 'live' ? 'live' : 'sombra'}.`,
  };
}

export async function addUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  try {
    const result = await addAllowedUser(prisma(), String(form.get('email') ?? ''));
    if (!result.ok) return { status: 'error', message: result.message };
  } catch (error) {
    console.error('No se pudo dar de alta al usuario', error);
    return { status: 'error', message: 'No se pudo guardar el cambio. Inténtalo de nuevo.' };
  }
  revalidatePath('/configuracion');
  return { status: 'ok', message: 'Usuario autorizado.' };
}

export async function removeUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const result = await removeAllowedUser(prisma(), String(form.get('id') ?? ''), user.email);
    if (!result.ok) return { status: 'error', message: result.message };
  } catch (error) {
    console.error('No se pudo dar de baja al usuario', error);
    return { status: 'error', message: 'No se pudo guardar el cambio. Inténtalo de nuevo.' };
  }
  revalidatePath('/configuracion');
  return { status: 'ok', message: 'Usuario dado de baja.' };
}
