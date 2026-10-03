import type { PrismaClient } from '@clasificador/db';

import type { MessageStatus } from '@clasificador/db';

import type { KnownMessage } from '../corrections';
import { INBOX_SYNC_ID, type SyncStore } from './delta';

type Db = Pick<PrismaClient, 'syncState' | 'message' | 'correction' | '$transaction'>;

export function createPrismaSyncStore(db: Db): SyncStore {
  return {
    async getState() {
      const row = await db.syncState.findUnique({ where: { id: INBOX_SYNC_ID } });
      return row ? { deltaLink: row.deltaLink, lastSyncAt: row.lastSyncAt } : null;
    },

    async saveState(deltaLink, syncedAt) {
      await db.syncState.upsert({
        where: { id: INBOX_SYNC_ID },
        create: { id: INBOX_SYNC_ID, deltaLink, lastSyncAt: syncedAt },
        update: { deltaLink, lastSyncAt: syncedAt },
      });
    },

    async clearDeltaLink() {
      await db.syncState.upsert({
        where: { id: INBOX_SYNC_ID },
        create: { id: INBOX_SYNC_ID, deltaLink: null },
        update: { deltaLink: null },
      });
    },

    async earliestReceivedAt() {
      const { _min } = await db.message.aggregate({ _min: { receivedAt: true } });
      return _min.receivedAt;
    },

    async registerNew({ id, conversationId, receivedAt, seenCategories }) {
      // Remitente y asunto se rellenan al procesarlo; la delta no los pide.
      await db.message.createMany({
        data: [{ id, conversationId, sender: '', subject: '', receivedAt, seenCategories }],
        skipDuplicates: true,
      });
    },

    async findKnown(ids) {
      const rows = await db.message.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          seenCategories: true,
          decisions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, categories: true, mode: true },
          },
          corrections: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { decisionId: true, final: true },
          },
        },
      });
      const known = new Map<string, KnownMessage & { status: MessageStatus }>();
      for (const row of rows) {
        known.set(row.id, {
          id: row.id,
          status: row.status,
          seenCategories: row.seenCategories,
          latestDecision: row.decisions[0] ?? null,
          latestCorrection: row.corrections[0] ?? null,
        });
      }
      return known;
    },

    async recordChange({ messageId, seenCategories, correction }) {
      await db.$transaction(async (tx) => {
        await tx.message.update({ where: { id: messageId }, data: { seenCategories } });
        if (correction) {
          await tx.correction.create({
            data: {
              messageId,
              decisionId: correction.decisionId,
              proposed: correction.proposed,
              final: correction.final,
            },
          });
        }
      });
    },
  };
}
