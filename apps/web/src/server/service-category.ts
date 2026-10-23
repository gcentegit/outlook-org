import type { PrismaClient } from '@clasificador/db';
import { canonicalCategory } from '@clasificador/shared';

/**
 * Categoría del buzón que el worker añade a los correos en los que escribe, como marca de lo que
 * puso él (tabla `ServiceCategorySetting`, una sola fila). Solo se puede elegir una de la lista
 * maestra (el servicio nunca crea categorías) y no puede ser FOOD BOX, LATERAL ni ARCOBETA: como
 * marca acabaría en los correos de las otras dos.
 */

const ID = 'service';

export interface ServiceCategory {
  name: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

type Db = Pick<PrismaClient, 'serviceCategorySetting'>;

export async function getServiceCategory(db: Db): Promise<ServiceCategory | null> {
  return db.serviceCategorySetting.findUnique({
    where: { id: ID },
    select: { name: true, updatedAt: true, updatedBy: true },
  });
}

/**
 * Guarda la categoría elegida (`null` para ninguna) si está en la lista maestra del buzón y no es
 * una de las del clasificador.
 */
export async function setServiceCategory(
  db: Db,
  name: string | null,
  masterNames: readonly string[],
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (name !== null && canonicalCategory(name)) {
    return {
      ok: false,
      message: `«${name}» es una de las categorías que pone el clasificador y no puede ser la marca. Elige otra, por ejemplo 🤖.`,
    };
  }
  if (name !== null && !masterNames.includes(name)) {
    return {
      ok: false,
      message: `«${name}» no está en la lista de categorías del buzón. Recarga la página y elige otra.`,
    };
  }
  await db.serviceCategorySetting.upsert({
    where: { id: ID },
    create: { id: ID, name, updatedBy },
    update: { name, updatedBy },
  });
  return { ok: true };
}
