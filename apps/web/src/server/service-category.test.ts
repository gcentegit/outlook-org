import { describe, expect, it, vi } from 'vitest';

import { getServiceCategory, setServiceCategory } from './service-category';

function fakeDb(row: unknown = null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const upsert = vi.fn().mockResolvedValue({});
  return { db: { serviceCategorySetting: { findUnique, upsert } } as never, findUnique, upsert };
}

describe('getServiceCategory', () => {
  it('lee la única fila del ajuste', async () => {
    const row = { name: '🤖', updatedAt: new Date(), updatedBy: 'admin@ejemplo.com' };
    const { db, findUnique } = fakeDb(row);
    expect(await getServiceCategory(db)).toEqual(row);
    expect(findUnique.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'service' } });
  });
});

describe('setServiceCategory', () => {
  const master = ['FOOD BOX', 'LATERAL', '🤖'];

  it('guarda una categoría de la lista maestra con quién la cambió', async () => {
    const { db, upsert } = fakeDb();
    expect(await setServiceCategory(db, '🤖', master, 'admin@ejemplo.com')).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'service' },
      create: { id: 'service', name: '🤖', updatedBy: 'admin@ejemplo.com' },
      update: { name: '🤖', updatedBy: 'admin@ejemplo.com' },
    });
  });

  it('permite quitarla (ninguna)', async () => {
    const { db, upsert } = fakeDb();
    expect(await setServiceCategory(db, null, master, 'admin@ejemplo.com')).toEqual({ ok: true });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ update: { name: null } });
  });

  it('rechaza una categoría que no está en el buzón y no guarda nada', async () => {
    const { db, upsert } = fakeDb();
    const result = await setServiceCategory(db, 'Otra', master, 'admin@ejemplo.com');
    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rechaza una categoría del clasificador como marca y no guarda nada', async () => {
    const { db, upsert } = fakeDb();
    const result = await setServiceCategory(db, 'FOOD BOX', master, 'admin@ejemplo.com');
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/no puede ser la marca/),
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});
