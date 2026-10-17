import { describe, expect, it, vi } from 'vitest';

import { countDecidedByRule, createRule, setRuleActive } from './rules';

const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`);

describe('countDecidedByRule', () => {
  it('cuenta solo la decisión vigente de cada correo, sin fallos técnicos y con origen regla', () => {
    const counts = countDecidedByRule([
      // Correo 1: la decisión antigua era de r1; la vigente, de r2.
      {
        messageId: 'm1',
        createdAt: at(1),
        degraded: false,
        decision: { source: 'rule', ruleId: 'r1' },
      },
      {
        messageId: 'm1',
        createdAt: at(2),
        degraded: false,
        decision: { source: 'rule', ruleId: 'r2' },
      },
      {
        messageId: 'm2',
        createdAt: at(1),
        degraded: false,
        decision: { source: 'rule', ruleId: 'r2' },
      },
      // Con fallo técnico no cuenta.
      {
        messageId: 'm3',
        createdAt: at(1),
        degraded: true,
        decision: { source: 'rule', ruleId: 'r1' },
      },
      // Decidido por el hilo o sin regla: no cuenta.
      {
        messageId: 'm4',
        createdAt: at(1),
        degraded: false,
        decision: { source: 'thread', ruleId: null },
      },
      { messageId: 'm5', createdAt: at(1), degraded: false, decision: null },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ r2: 2 });
  });
});

describe('createRule', () => {
  const rule = {
    category: 'LATERAL' as const,
    type: 'cif' as const,
    value: 'B12345678',
    weight: 'fuerte' as const,
  };

  function fakeDb(existing: { active: boolean } | null) {
    const create = vi.fn().mockResolvedValue({ id: 'nueva' });
    const findUnique = vi.fn().mockResolvedValue(existing);
    return { db: { rule: { create, findUnique } } as never, create, findUnique };
  }

  it('crea la regla activa si no existe', async () => {
    const { db, create, findUnique } = fakeDb(null);
    expect(await createRule(db, rule, 'ana@ejemplo.com')).toEqual({ ok: true, id: 'nueva' });
    expect(findUnique.mock.calls[0]?.[0].where).toEqual({
      type_value_category: { type: 'cif', value: 'B12345678', category: 'LATERAL' },
    });
    expect(create).toHaveBeenCalledWith({
      data: { ...rule, active: true, createdBy: 'ana@ejemplo.com', updatedBy: 'ana@ejemplo.com' },
      select: { id: true },
    });
  });

  it('no duplica: avisa si ya existe y, si está desactivada, que basta con activarla', async () => {
    const active = fakeDb({ active: true });
    expect(await createRule(active.db, rule, 'ana@ejemplo.com')).toEqual({
      ok: false,
      message: 'Esa regla ya existe.',
    });
    const inactive = fakeDb({ active: false });
    expect(await createRule(inactive.db, rule, 'ana@ejemplo.com')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Actívala/),
    });
    expect(active.create).not.toHaveBeenCalled();
    expect(inactive.create).not.toHaveBeenCalled();
  });
});

describe('setRuleActive', () => {
  it('cambia el estado y avisa si la regla ya no existe', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const db = { rule: { updateMany } } as never;
    expect(await setRuleActive(db, 'r1', false, 'ana@ejemplo.com')).toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { active: false, updatedBy: 'ana@ejemplo.com' },
    });
    expect(await setRuleActive(db, 'r9', true, 'ana@ejemplo.com')).toMatchObject({ ok: false });
  });
});
