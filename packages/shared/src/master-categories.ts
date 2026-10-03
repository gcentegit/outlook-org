import { z } from 'zod';

/**
 * Trabajos con los que el panel pide al worker leer y crear categorías maestras del buzón. El
 * panel no tiene credenciales de Graph: solo encola y consulta (como con `test-classify`).
 */
export const LIST_MASTER_CATEGORIES_QUEUE = 'list-master-categories';
export const CREATE_MASTER_CATEGORY_QUEUE = 'create-master-category';
/** Pide al worker que vuelva a encolar los correos marcados para reprocesar. */
export const REPROCESS_FLAGGED_QUEUE = 'reprocess-flagged';

/** Resultado del trabajo de reproceso: cuántos correos se volvieron a encolar. */
export const reprocessResultSchema = z.object({ enqueued: z.number().int().nonnegative() });

/** Tiempo máximo que el panel espera la lectura de categorías (bloquea la carga de la pantalla). */
export const MASTER_CATEGORY_LIST_TIMEOUT_MS = 15_000;

/** Tiempo máximo que el panel espera una creación de categoría o un reproceso. */
export const MASTER_CATEGORY_TIMEOUT_MS = 30_000;

/** `preset0`-`preset24` (colores de categoría de Outlook). */
const COLOR_PRESET = /^preset(?:[0-9]|1[0-9]|2[0-4])$/;

export const newCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre de la categoría.')
    .max(255, 'El nombre es demasiado largo (máximo 255 caracteres).'),
  color: z.string().refine((value) => COLOR_PRESET.test(value), {
    error: 'Elige uno de los colores de la lista.',
  }),
});

export type NewCategory = z.infer<typeof newCategorySchema>;

export const mailCategorySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** `preset0`-`preset24` o `none`. */
  color: z.string(),
});

export type MailCategory = z.infer<typeof mailCategorySchema>;

/** `unconfigured`: el worker no tiene credenciales de Graph; `error`: Graph falló. */
export const listMasterCategoriesResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    mailbox: z.string(),
    categories: z.array(mailCategorySchema),
  }),
  z.object({ status: z.literal('unconfigured'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);

export type ListMasterCategoriesResult = z.infer<typeof listMasterCategoriesResultSchema>;

export const createMasterCategoryResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), category: mailCategorySchema }),
  z.object({ status: z.literal('exists'), message: z.string() }),
  z.object({ status: z.literal('unconfigured'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);

export type CreateMasterCategoryResult = z.infer<typeof createMasterCategoryResultSchema>;
