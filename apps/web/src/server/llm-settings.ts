import type { PrismaClient } from '@clasificador/db';

import type { LlmSelection } from '@/lib/llm-providers';

import { lockSettings } from './settings-lock';

export interface ActiveLlm {
  provider: string;
  model: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Selección activa (la más reciente si hubiera más de una), o null si no hay ninguna. */
export async function getActiveLlm(
  db: Pick<PrismaClient, 'llmSetting'>,
): Promise<ActiveLlm | null> {
  return db.llmSetting.findFirst({
    where: { active: true },
    orderBy: { updatedAt: 'desc' },
    select: { provider: true, model: true, updatedAt: true, updatedBy: true },
  });
}

/**
 * Deja activa la selección y desactiva las demás en una sola transacción: el worker lee la tabla
 * en cada trabajo y nunca debe ver dos activas (ni ninguna) a mitad de cambio. El bloqueo de la
 * transacción serializa dos cambios simultáneos, que de otro modo podrían dejar dos activas.
 */
export async function setActiveLlm(
  db: Pick<PrismaClient, '$transaction'>,
  selection: LlmSelection,
  updatedBy: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockSettings(tx);
    await tx.llmSetting.updateMany({
      where: {
        active: true,
        NOT: { provider: selection.provider, model: selection.model },
      },
      data: { active: false, updatedBy },
    });
    await tx.llmSetting.upsert({
      where: { provider_model: { provider: selection.provider, model: selection.model } },
      create: { ...selection, active: true, updatedBy },
      update: { active: true, updatedBy },
    });
  });
}

/**
 * Deja sin modelo activo: el clasificador decide solo con reglas y lo que no resuelvan queda en
 * duda, no como fallo técnico pendiente de reprocesar. Con el mismo bloqueo que `setActiveLlm`.
 */
export async function deactivateLlm(
  db: Pick<PrismaClient, '$transaction'>,
  updatedBy: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockSettings(tx);
    await tx.llmSetting.updateMany({ where: { active: true }, data: { active: false, updatedBy } });
  });
}

/** Selecciones usadas alguna vez (para sugerirlas en el formulario). */
export async function listKnownLlms(
  db: Pick<PrismaClient, 'llmSetting'>,
): Promise<{ provider: string; model: string; active: boolean }[]> {
  return db.llmSetting.findMany({
    orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
    select: { provider: true, model: true, active: true },
  });
}
