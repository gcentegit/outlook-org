import type { Category, ExtractedEmail } from '@clasificador/shared';

/** Categoría ya presente en otro correo de la misma conversación. */
export interface ThreadCategory {
  category: Category;
  messageId: string;
  /** `team`: categorías finales del equipo (corrección o categorías vistas); `decision`: última decisión del clasificador en un correo que nadie ha revisado. */
  origin: 'team' | 'decision';
}

/** Origen de las categorías del hilo; inyectable para probar sin base de datos. */
export interface ThreadRepository {
  /** Categorías de los demás correos de la conversación (excluye `excludeMessageId`). */
  findThreadCategories(conversationId: string, excludeMessageId: string): Promise<ThreadCategory[]>;
}

/**
 * Categorías heredadas del hilo: una por categoría, con el correo del que salen. Si una misma
 * categoría viene de una persona y de una decisión previa, gana la de la persona.
 */
export async function inheritFromThread(
  email: Pick<ExtractedEmail, 'messageId' | 'conversationId'>,
  repo: ThreadRepository,
): Promise<Map<Category, ThreadCategory>> {
  const inherited = new Map<Category, ThreadCategory>();
  if (!email.conversationId) return inherited;
  const found = await repo.findThreadCategories(email.conversationId, email.messageId);
  for (const item of found) {
    const current = inherited.get(item.category);
    if (!current || (current.origin === 'decision' && item.origin === 'team')) {
      inherited.set(item.category, item);
    }
  }
  return inherited;
}
