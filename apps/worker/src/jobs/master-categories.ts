import {
  newCategorySchema,
  type CreateMasterCategoryResult,
  type ListMasterCategoriesResult,
  type MailCategory,
} from '@clasificador/shared';

import { GraphError, type GraphClient } from '../graph/client';

/** Acceso a la lista maestra del buzón, o el motivo por el que no hay: faltan credenciales de Graph. */
export type MasterCategoriesAccess =
  { graph: Pick<GraphClient, 'getAll' | 'postJson'>; mailbox: string } | { missing: string[] };

const unconfigured = (missing: string[]): { status: 'unconfigured'; message: string } => ({
  status: 'unconfigured',
  message: `El worker no tiene credenciales de Graph (faltan: ${missing.join(', ')}).`,
});

function describeError(error: unknown): string {
  if (error instanceof GraphError) return error.message.slice(0, 300);
  return error instanceof Error ? error.message.slice(0, 300) : 'Error desconocido';
}

function toCategory(raw: unknown): MailCategory | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, displayName, color } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof displayName !== 'string') return null;
  return { id, displayName, color: typeof color === 'string' ? color : 'none' };
}

const masterCategoriesPath = (mailbox: string): string =>
  `/users/${encodeURIComponent(mailbox)}/outlook/masterCategories`;

async function readCategories(
  access: Extract<MasterCategoriesAccess, { graph: unknown }>,
): Promise<MailCategory[]> {
  const raw = await access.graph.getAll<unknown>(masterCategoriesPath(access.mailbox));
  return raw
    .map(toCategory)
    .filter((c): c is MailCategory => c !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
}

/** Lista maestra de categorías del buzón. Nunca lanza: el panel muestra el motivo si falla. */
export async function runListMasterCategories(
  access: MasterCategoriesAccess,
): Promise<ListMasterCategoriesResult> {
  if ('missing' in access) return unconfigured(access.missing);
  try {
    return { status: 'ok', mailbox: access.mailbox, categories: await readCategories(access) };
  } catch (error) {
    return { status: 'error', message: describeError(error) };
  }
}

/**
 * Crea una categoría en la lista maestra (`POST .../outlook/masterCategories`). Comprueba aquí
 * que no exista ya (Outlook no distingue mayúsculas). No renombra ni borra nunca. Nunca lanza.
 */
export async function runCreateMasterCategory(
  data: unknown,
  access: MasterCategoriesAccess,
): Promise<CreateMasterCategoryResult> {
  const parsed = newCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Datos no válidos.' };
  }
  if ('missing' in access) return unconfigured(access.missing);
  const { name, color } = parsed.data;
  try {
    const existing = await readCategories(access);
    const wanted = name.toLowerCase();
    if (existing.some((c) => c.displayName.trim().toLowerCase() === wanted)) {
      return { status: 'exists', message: `Ya existe una categoría llamada «${name}».` };
    }
    const created = toCategory(
      await access.graph.postJson<unknown>(masterCategoriesPath(access.mailbox), {
        displayName: name,
        color,
      }),
    );
    if (!created) {
      return {
        status: 'error',
        message: 'Graph devolvió una respuesta inesperada al crear la categoría.',
      };
    }
    return { status: 'created', category: created };
  } catch (error) {
    return { status: 'error', message: describeError(error) };
  }
}
