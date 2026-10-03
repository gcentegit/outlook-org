import { describe, expect, it } from 'vitest';

import { applySeed } from './seed';

type RuleRow = { type: string; value: string; category: string; weight: string; active: boolean };

/** Doble en memoria con la parte del cliente de Prisma que usa la semilla. */
function fakeDb(initial: { rules?: RuleRow[]; users?: string[]; llms?: string[] } = {}) {
  const rules = [...(initial.rules ?? [])];
  const users = [...(initial.users ?? [])];
  const llms = [...(initial.llms ?? [])];
  const db = {
    rule: {
      findUnique: async ({
        where,
      }: {
        where: { type_value_category: { type: string; value: string; category: string } };
      }) => {
        const k = where.type_value_category;
        return (
          rules.find(
            (r) => r.type === k.type && r.value === k.value && r.category === k.category,
          ) ?? null
        );
      },
      create: async ({ data }: { data: RuleRow }) => {
        rules.push(data);
        return data;
      },
    },
    allowedUser: {
      count: async () => users.length,
      create: async ({ data }: { data: { email: string } }) => {
        users.push(data.email);
        return data;
      },
    },
    llmSetting: {
      count: async () => llms.length,
      create: async ({ data }: { data: { model: string } }) => {
        llms.push(data.model);
        return data;
      },
    },
  };
  return { db: db as unknown as Parameters<typeof applySeed>[0], rules, users, llms };
}

describe('applySeed', () => {
  it('en una base vacía crea las 14 reglas fuertes, el administrador y el modelo', async () => {
    const { db, rules, users, llms } = fakeDb();
    const result = await applySeed(db, { adminEmail: 'admin@ejemplo.com' });
    expect(result).toEqual({
      rulesCreated: 14,
      adminCreated: true,
      adminMissing: false,
      llmCreated: true,
    });
    expect(rules.every((r) => r.weight === 'fuerte' && r.active)).toBe(true);
    expect(users).toEqual(['admin@ejemplo.com']);
    expect(llms).toHaveLength(1);
  });

  it('es idempotente: una segunda ejecución no inserta nada', async () => {
    const { db } = fakeDb();
    await applySeed(db, { adminEmail: 'admin@ejemplo.com' });
    expect(await applySeed(db, { adminEmail: 'admin@ejemplo.com' })).toEqual({
      rulesCreated: 0,
      adminCreated: false,
      adminMissing: false,
      llmCreated: false,
    });
  });

  it('el administrador inicial viene de ADMIN_EMAIL, en minúsculas', async () => {
    const { db, users } = fakeDb();
    await applySeed(db, { adminEmail: ' Ana@ejemplo.com ' });
    expect(users).toEqual(['ana@ejemplo.com']);
  });

  it('sin ADMIN_EMAIL y sin usuarios no crea ningún administrador, pero siembra el resto', async () => {
    for (const adminEmail of [undefined, '', '   ']) {
      const { db, users, rules, llms } = fakeDb();
      const result = await applySeed(db, { adminEmail });
      expect(result).toMatchObject({ adminCreated: false, adminMissing: true, rulesCreated: 14 });
      expect(users).toEqual([]);
      expect(rules).toHaveLength(14);
      expect(llms).toHaveLength(1);
    }
  });

  it('sin ADMIN_EMAIL pero con usuarios ya autorizados no hay nada que avisar', async () => {
    const { db, users } = fakeDb({ users: ['otra@ejemplo.com'] });
    const result = await applySeed(db);
    expect(result).toMatchObject({ adminCreated: false, adminMissing: false });
    expect(users).toEqual(['otra@ejemplo.com']);
  });

  it('no sobrescribe reglas existentes (una regla desactivada sigue desactivada)', async () => {
    const existing: RuleRow = {
      type: 'cif',
      value: 'A87240420',
      category: 'FOOD BOX',
      weight: 'fuerte',
      active: false,
    };
    const { db, rules } = fakeDb({ rules: [existing] });
    const result = await applySeed(db);
    expect(result.rulesCreated).toBe(13);
    expect(rules.find((r) => r.value === 'A87240420')?.active).toBe(false);
  });

  it('no vuelve a dar de alta al administrador si ya hay otros usuarios ni toca el modelo elegido', async () => {
    const { db, users, llms } = fakeDb({ users: ['otra@ejemplo.com'], llms: ['otro-modelo'] });
    const result = await applySeed(db);
    expect(result.adminCreated).toBe(false);
    expect(result.llmCreated).toBe(false);
    expect(users).toEqual(['otra@ejemplo.com']);
    expect(llms).toEqual(['otro-modelo']);
  });
});
