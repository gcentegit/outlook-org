import { describe, expect, it, vi } from 'vitest';

import {
  addAllowedUser,
  authorizeUser,
  emailSchema,
  listAllowedUsers,
  removeAllowedUser,
} from './allowed-users';

function fakeDb(over: Record<string, unknown> = {}) {
  const db = {
    allowedUser: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ email: 'otra@ejemplo.com' }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...over,
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  return db;
}

describe('emailSchema', () => {
  it('normaliza a minúsculas y rechaza emails inválidos', () => {
    expect(emailSchema.parse('  Ana@ejemplo.com ')).toBe('ana@ejemplo.com');
    expect(emailSchema.safeParse('sin-arroba').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });
});

describe('addAllowedUser', () => {
  it('crea el usuario con el email normalizado', async () => {
    const db = fakeDb();
    // @ts-expect-error doble mínimo de PrismaClient
    expect(await addAllowedUser(db, 'Ana@ejemplo.com')).toEqual({ ok: true });
    expect(db.allowedUser.create).toHaveBeenCalledWith({ data: { email: 'ana@ejemplo.com' } });
  });

  it('no duplica ni acepta emails no válidos', async () => {
    const db = fakeDb({ count: vi.fn().mockResolvedValue(1) });
    // @ts-expect-error doble mínimo de PrismaClient
    expect(await addAllowedUser(db, 'ana@ejemplo.com')).toEqual({
      ok: false,
      message: 'ana@ejemplo.com ya tiene acceso.',
    });
    // @ts-expect-error doble mínimo de PrismaClient
    expect((await addAllowedUser(db, 'nope')).ok).toBe(false);
    expect(db.allowedUser.create).not.toHaveBeenCalled();
  });
});

describe('removeAllowedUser', () => {
  it('da de baja a otro usuario', async () => {
    const db = fakeDb({ count: vi.fn().mockResolvedValue(2) });
    // @ts-expect-error doble mínimo de PrismaClient
    expect(await removeAllowedUser(db, 'u1', 'admin@ejemplo.com')).toEqual({ ok: true });
    expect(db.allowedUser.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('no deja quitarse a uno mismo', async () => {
    const db = fakeDb({
      count: vi.fn().mockResolvedValue(2),
      findUnique: vi.fn().mockResolvedValue({ email: 'admin@ejemplo.com' }),
    });
    // @ts-expect-error doble mínimo de PrismaClient
    const result = await removeAllowedUser(db, 'u1', 'Admin@ejemplo.com');
    expect(result.ok).toBe(false);
    expect(db.allowedUser.delete).not.toHaveBeenCalled();
  });

  it('no deja vacía la lista', async () => {
    const db = fakeDb({ count: vi.fn().mockResolvedValue(1) });
    // @ts-expect-error doble mínimo de PrismaClient
    const result = await removeAllowedUser(db, 'u1', 'admin@ejemplo.com');
    expect(result).toEqual({ ok: false, message: 'Debe quedar al menos un usuario autorizado.' });
    expect(db.allowedUser.delete).not.toHaveBeenCalled();
  });

  it('comprueba y borra dentro de una transacción con el bloqueo de configuración', async () => {
    const db = fakeDb({ count: vi.fn().mockResolvedValue(2) });
    // @ts-expect-error doble mínimo de PrismaClient
    await removeAllowedUser(db, 'u1', 'admin@ejemplo.com');
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.allowedUser.count.mock.invocationCallOrder[0] as number,
    );
  });

  it('avisa si el usuario ya no existe', async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(null) });
    // @ts-expect-error doble mínimo de PrismaClient
    expect((await removeAllowedUser(db, 'zz', 'a@b.es')).ok).toBe(false);
  });
});

describe('addAllowedUser: alta simultánea', () => {
  it('si la unicidad del email salta, lo trata como ya dado de alta', async () => {
    const db = fakeDb({ create: vi.fn().mockRejectedValue({ code: 'P2002' }) });
    // @ts-expect-error doble mínimo de PrismaClient
    expect(await addAllowedUser(db, 'ana@ejemplo.com')).toEqual({
      ok: false,
      message: 'ana@ejemplo.com ya tiene acceso.',
    });
  });
});

describe('authorizeUser', () => {
  const asDb = (db: ReturnType<typeof fakeDb>) => db as never;

  it('un email que no está en la lista no entra', async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(null) });
    expect(await authorizeUser(asDb(db), 'x@ejemplo.com', 'oid-1')).toBe('not-listed');
  });

  it('en el primer acceso válido vincula el oid y deja entrar', async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue({ id: 'u1', oid: null }) });
    expect(await authorizeUser(asDb(db), 'ana@ejemplo.com', 'oid-1')).toBe('ok');
    expect(db.allowedUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', oid: null },
      data: { oid: 'oid-1' },
    });
  });

  it('con el oid ya guardado exige que coincida', async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue({ id: 'u1', oid: 'oid-1' }) });
    expect(await authorizeUser(asDb(db), 'ana@ejemplo.com', 'oid-1')).toBe('ok');
    expect(await authorizeUser(asDb(db), 'ana@ejemplo.com', 'oid-otro')).toBe('other-account');
    expect(db.allowedUser.updateMany).not.toHaveBeenCalled();
  });

  it('dos primeros accesos a la vez: gana uno y el otro solo entra si es la misma cuenta', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'u1', oid: null })
      .mockResolvedValueOnce({ oid: 'oid-ganador' });
    const db = fakeDb({ findUnique, updateMany: vi.fn().mockResolvedValue({ count: 0 }) });
    expect(await authorizeUser(asDb(db), 'ana@ejemplo.com', 'oid-perdedor')).toBe('other-account');
  });

  it('una cuenta ya vinculada a otro usuario de la lista (unicidad de oid) no entra', async () => {
    const db = fakeDb({
      findUnique: vi.fn().mockResolvedValue({ id: 'u2', oid: null }),
      updateMany: vi.fn().mockRejectedValue({ code: 'P2002' }),
    });
    expect(await authorizeUser(asDb(db), 'otro-alias@ejemplo.com', 'oid-1')).toBe('other-account');
  });
});

describe('listAllowedUsers', () => {
  it('indica si cada usuario ya está vinculado sin exponer el oid', async () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    const db = fakeDb({
      findMany: vi.fn().mockResolvedValue([
        { id: 'a', email: 'a@x.es', oid: 'o', createdAt },
        { id: 'b', email: 'b@x.es', oid: null, createdAt },
      ]),
    });
    expect(await listAllowedUsers(db as never)).toEqual([
      { id: 'a', email: 'a@x.es', linked: true, createdAt },
      { id: 'b', email: 'b@x.es', linked: false, createdAt },
    ]);
  });
});
