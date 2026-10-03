import 'server-only';

import type { NewCategory } from '@clasificador/shared';

import { getJobQueue } from './boss';
import {
  createMasterCategory,
  listMasterCategories,
  type CategoryListing,
  type CreateResult,
} from './master-categories';

const NO_QUEUE =
  'No se pudo conectar con la cola de trabajos. Comprueba que el worker ha arrancado al menos una vez y que la base de datos responde.';

/** Lista maestra del buzón vía worker. Nunca lanza: si no hay cola o worker, devuelve el motivo. */
export async function readMasterCategories(): Promise<CategoryListing> {
  let queue;
  try {
    queue = await getJobQueue();
  } catch (error) {
    console.error('No se pudo conectar con la cola de trabajos', error);
    return { status: 'error', message: NO_QUEUE };
  }
  return listMasterCategories(queue);
}

/** Crea una categoría en el buzón vía worker. Nunca lanza. */
export async function addMasterCategory(input: NewCategory): Promise<CreateResult> {
  let queue;
  try {
    queue = await getJobQueue();
  } catch (error) {
    console.error('No se pudo conectar con la cola de trabajos', error);
    return { status: 'error', message: NO_QUEUE };
  }
  return createMasterCategory(queue, input);
}
