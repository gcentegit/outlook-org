import { SOCIEDADES, normalizeCif } from '@clasificador/shared';

import type { PrismaClient } from './generated/client';

export const DEFAULT_LLM = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } as const;

type SeedDb = Pick<PrismaClient, 'rule' | 'allowedUser' | 'llmSetting'>;

export interface SeedResult {
  rulesCreated: number;
  adminCreated: boolean;
  /** No había usuarios autorizados y tampoco `ADMIN_EMAIL`: no se creó ningún administrador. */
  adminMissing: boolean;
  llmCreated: boolean;
}

/**
 * Datos mínimos para que el servicio funcione. Idempotente y no destructiva: solo inserta lo que
 * falta y nunca modifica lo que ya existe (una regla desactivada sigue desactivada).
 *
 * - Reglas fuertes: CIF y razón social de cada sociedad, una a una por su clave natural.
 * - Administrador: solo si no hay ningún usuario autorizado y hay `adminEmail` (sin valor por
 *   defecto). Si alguien quitó al administrador inicial a propósito, un arranque posterior no lo
 *   vuelve a dar de alta.
 * - Modelo de LLM: solo si la tabla está vacía; el elegido en el panel no se toca.
 */
export async function applySeed(
  db: SeedDb,
  options: { adminEmail?: string | undefined } = {},
): Promise<SeedResult> {
  const adminEmail = options.adminEmail?.trim().toLowerCase();
  const result: SeedResult = {
    rulesCreated: 0,
    adminCreated: false,
    adminMissing: false,
    llmCreated: false,
  };

  for (const s of SOCIEDADES) {
    const rules = [
      { type: 'cif', value: normalizeCif(s.cif) },
      { type: 'razon_social', value: s.razonSocial },
    ] as const;
    for (const { type, value } of rules) {
      const key = { type_value_category: { type, value, category: s.category } };
      if (await db.rule.findUnique({ where: key, select: { id: true } })) continue;
      await db.rule.create({
        data: { type, value, category: s.category, weight: 'fuerte', active: true },
      });
      result.rulesCreated++;
    }
  }

  if ((await db.allowedUser.count()) === 0) {
    if (adminEmail) {
      await db.allowedUser.create({ data: { email: adminEmail } });
      result.adminCreated = true;
    } else {
      result.adminMissing = true;
    }
  }

  if ((await db.llmSetting.count()) === 0) {
    await db.llmSetting.create({ data: { ...DEFAULT_LLM, active: true } });
    result.llmCreated = true;
  }
  return result;
}
