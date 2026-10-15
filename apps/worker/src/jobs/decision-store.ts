import type { PrismaClient } from '@clasificador/db';

import type { DecisionStore } from './process-message';

type Db = Pick<PrismaClient, 'decision' | 'message' | '$transaction'>;

export function createPrismaDecisionStore(db: Db): DecisionStore {
  return {
    async hasDecision(messageId, mode) {
      const flagged = await db.message.count({ where: { id: messageId, needsReprocess: true } });
      if (flagged > 0) return false;
      return (await db.decision.count({ where: { messageId, mode, degraded: false } })) > 0;
    },

    async saveDecision(email, result, { degradedReason }) {
      const { decision, usage } = result;
      const degraded = degradedReason !== null;
      // `seenCategories` no se toca si el correo ya existe: lo mantiene la sincronización, que
      // puede haber visto cambios del equipo más recientes que los leídos al extraer.
      const details = {
        conversationId: email.conversationId ?? '',
        sender: email.fromAddress ?? '',
        subject: email.subject,
        receivedAt: email.receivedAt,
        status: 'processed' as const,
        needsReprocess: degraded,
      };
      await db.$transaction(async (tx) => {
        await tx.message.upsert({
          where: { id: email.messageId },
          create: { id: email.messageId, ...details, seenCategories: email.categories },
          update: details,
        });
        await tx.decision.create({
          data: {
            messageId: email.messageId,
            decision,
            categories: decision.categories,
            model: decision.model,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            costUsd: usage?.costUsd ?? null,
            latencyMs: result.latencyMs,
            mode: decision.mode,
            degraded,
          },
        });
      });
    },

    async markFailed(messageId) {
      await db.message.updateMany({
        where: { id: messageId },
        data: { status: 'failed', needsReprocess: true },
      });
    },

    async markApplyFailed(messageId) {
      await db.message.updateMany({ where: { id: messageId }, data: { needsReprocess: true } });
    },

    async findLocator(messageId) {
      const row = await db.message.findUnique({
        where: { id: messageId },
        select: { id: true, conversationId: true, receivedAt: true },
      });
      return row && row.conversationId !== '' ? row : null;
    },

    async forget(messageId) {
      // Sin decisión se borra. Con decisión, lo normal es que el equipo lo haya archivado: al moverlo Graph le cambia el
      // id y ya no se puede volver a leer por él. Se conserva la decisión y deja de estar en
      // cola y marcado: reprocesarlo daría 404 siempre. Su carpeta la sigue la comprobación de
      // carpetas, que lo busca por su conversación.
      await db.$transaction([
        db.message.deleteMany({ where: { id: messageId, decisions: { none: {} } } }),
        db.message.updateMany({
          where: { id: messageId },
          data: { status: 'processed', needsReprocess: false },
        }),
      ]);
    },
  };
}
