import {
  CATEGORIES,
  CREATE_MASTER_CATEGORY_QUEUE,
  LIST_MASTER_CATEGORIES_QUEUE,
  MASTER_CATEGORY_LIST_TIMEOUT_MS,
  MASTER_CATEGORY_TIMEOUT_MS,
  createMasterCategoryResultSchema,
  listMasterCategoriesResultSchema,
  type Category,
  type CreateMasterCategoryResult,
  type ListMasterCategoriesResult,
  type MailCategory,
  type NewCategory,
} from '@clasificador/shared';

import { runQueueJob, type JobQueue, type JobRunOptions } from './job-runner';

/**
 * Lista maestra de categorías del buzón. El panel no tiene credenciales de Graph: pide al worker,
 * que sí las tiene, que lea y cree categorías por la cola de trabajos (como «Probar»). Si el
 * worker no está en marcha o no tiene credenciales, el resultado trae el motivo para mostrarlo.
 */

export type { MailCategory };

export type CategoryListing =
  | { status: 'ok'; mailbox: string; categories: MailCategory[] }
  | { status: 'unconfigured' | 'error'; message: string };

export type CreateResult =
  | { status: 'created'; category: MailCategory }
  | { status: 'exists' | 'unconfigured' | 'error'; message: string };

type Options = Partial<JobRunOptions>;

const withTimeout = (options: Options, defaultMs: number): JobRunOptions => ({
  ...options,
  timeoutMs: options.timeoutMs ?? defaultMs,
});

export async function listMasterCategories(
  queue: JobQueue,
  options: Options = {},
): Promise<CategoryListing> {
  const outcome = await runQueueJob(
    queue,
    LIST_MASTER_CATEGORIES_QUEUE,
    {},
    'la lectura de categorías',
    listMasterCategoriesResultSchema,
    withTimeout(options, MASTER_CATEGORY_LIST_TIMEOUT_MS),
  );
  if (!outcome.ok) return { status: 'error', message: outcome.message };
  const result: ListMasterCategoriesResult = outcome.output;
  return result;
}

/** Crea una categoría por el worker. No renombra ni borra nunca. */
export async function createMasterCategory(
  queue: JobQueue,
  input: NewCategory,
  options: Options = {},
): Promise<CreateResult> {
  const outcome = await runQueueJob(
    queue,
    CREATE_MASTER_CATEGORY_QUEUE,
    input,
    'la creación de la categoría',
    createMasterCategoryResultSchema,
    withTimeout(options, MASTER_CATEGORY_TIMEOUT_MS),
  );
  if (!outcome.ok) return { status: 'error', message: outcome.message };
  const result: CreateMasterCategoryResult = outcome.output;
  return result;
}

/** Categorías del clasificador que no están en la lista maestra (Outlook no distingue mayúsculas). */
export function missingCategories(existing: readonly MailCategory[]): Category[] {
  const names = new Set(existing.map((c) => c.displayName.trim().toLowerCase()));
  return CATEGORIES.filter((c) => !names.has(c.toLowerCase()));
}

export function hasCategoryNamed(existing: readonly MailCategory[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return existing.some((c) => c.displayName.trim().toLowerCase() === wanted);
}
