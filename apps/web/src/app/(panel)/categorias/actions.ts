'use server';

import { prisma } from '@clasificador/db';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/lib/action-state';
import { newCategorySchema } from '@/lib/outlook-colors';
import { requireUser } from '@/lib/session';
import { addMasterCategory, readMasterCategories } from '@/server/master-categories-service';
import { setServiceCategory } from '@/server/service-category';

/**
 * Crea una categoría en la lista maestra del buzón. Exige la confirmación explícita del
 * formulario (`confirmado`). El panel no tiene credenciales de Graph: se lo pide al worker por la
 * cola de trabajos, que comprueba que no exista ya y la crea. El registro de auditoría lo escribe
 * el panel con el usuario de la sesión, que es quien está autenticado (el worker no recibe ni
 * confía en un email que venga en el trabajo).
 */
export async function createCategoryAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (form.get('confirmado') !== 'si') {
    return { status: 'error', message: 'Confirma la creación antes de continuar.' };
  }
  const parsed = newCategorySchema.safeParse({ name: form.get('name'), color: form.get('color') });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Datos no válidos.' };
  }

  const created = await addMasterCategory(parsed.data);
  if (created.status !== 'created') {
    return {
      status: 'error',
      message:
        created.status === 'error'
          ? `No se pudo crear la categoría: ${created.message}`
          : created.message,
    };
  }

  try {
    await prisma().categoryAudit.create({
      data: { name: parsed.data.name, color: parsed.data.color, createdBy: user.email },
    });
  } catch (error) {
    console.error('Categoría creada en el buzón pero sin registro de auditoría', error);
    revalidatePath('/categorias');
    return {
      status: 'error',
      message: `La categoría «${parsed.data.name}» se creó en el buzón, pero no se pudo registrar quién la creó.`,
    };
  }
  revalidatePath('/categorias');
  return { status: 'ok', message: `Categoría «${parsed.data.name}» creada en el buzón.` };
}

/**
 * Elige la categoría del buzón que el worker añade a los correos en los que escribe, o ninguna
 * (valor vacío). Se comprueba contra la lista maestra leída en ese momento: el servicio no crea
 * categorías.
 */
export async function setServiceCategoryAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const raw = form.get('name');
  if (typeof raw !== 'string') return { status: 'error', message: 'Datos no válidos.' };
  const name = raw === '' ? null : raw;

  let masterNames: string[] = [];
  if (name !== null) {
    const listing = await readMasterCategories();
    if (listing.status !== 'ok') {
      return {
        status: 'error',
        message: `No se pudo comprobar la lista de categorías del buzón: ${listing.message}`,
      };
    }
    masterNames = listing.categories.map((c) => c.displayName);
  }

  try {
    const result = await setServiceCategory(prisma(), name, masterNames, user.email);
    if (!result.ok) return { status: 'error', message: result.message };
  } catch (error) {
    console.error('No se pudo guardar la categoría del clasificador', error);
    return { status: 'error', message: 'No se pudo guardar el cambio. Inténtalo de nuevo.' };
  }
  revalidatePath('/categorias');
  return {
    status: 'ok',
    message:
      name === null
        ? 'El clasificador deja de añadir una categoría propia.'
        : `El clasificador añadirá «${name}» a los correos en los que escriba a partir de ahora.`,
  };
}
