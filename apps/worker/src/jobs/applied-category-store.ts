import type { PrismaClient } from '@clasificador/db';

import type { AppliedCategoryStore } from '../graph/apply-categories';

export function createPrismaAppliedCategoryStore(
  db: Pick<PrismaClient, 'appliedCategory'>,
): AppliedCategoryStore {
  return {
    async listApplied(messageId) {
      const rows = await db.appliedCategory.findMany({
        where: { messageId },
        select: { category: true },
      });
      return rows.map((r) => r.category);
    },

    async recordApplied(messageId, categories) {
      await db.appliedCategory.createMany({
        data: categories.map((category) => ({ messageId, category })),
        skipDuplicates: true,
      });
    },

    async forgetApplied(messageId, categories) {
      await db.appliedCategory.deleteMany({
        where: { messageId, category: { in: [...categories] } },
      });
    },
  };
}
