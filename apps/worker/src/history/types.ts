import { CATEGORIES, type Category } from '@clasificador/shared';
import { z } from 'zod';

/** Metadatos de un correo del histórico (sin cuerpo ni adjuntos). */
export const historyMessageSchema = z.object({
  id: z.string().min(1),
  folderId: z.string().min(1),
  folderPath: z.string(),
  subject: z.string(),
  fromAddress: z.string().nullable(),
  fromName: z.string().nullable(),
  /** ISO 8601 en UTC. */
  receivedAt: z.string().min(1),
  /** Categorías tal cual las puso el equipo (incluidas las que no son del clasificador). */
  categories: z.array(z.string()),
  hasAttachments: z.boolean(),
  conversationId: z.string().nullable(),
  internetMessageId: z.string().nullable(),
});

export type HistoryMessage = z.infer<typeof historyMessageSchema>;

const CATEGORY_BY_LOWER = new Map<string, Category>(CATEGORIES.map((c) => [c.toLowerCase(), c]));

/** Categorías del clasificador que tiene el correo; el resto de etiquetas del equipo ("Pte ok", nombres) se ignoran. */
export function teamLabels(categories: readonly string[]): Category[] {
  const found = new Set<Category>();
  for (const name of categories) {
    const category = CATEGORY_BY_LOWER.get(name.trim().toLowerCase());
    if (category) found.add(category);
  }
  return CATEGORIES.filter((c) => found.has(c));
}
