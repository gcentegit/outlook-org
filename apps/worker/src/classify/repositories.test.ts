import { describe, expect, it, vi } from 'vitest';

import {
  createPrismaLlmSettingRepository,
  createPrismaRuleRepository,
  createPrismaThreadRepository,
  threadCategoriesOf,
  type ThreadMessageRow,
} from './repositories';

// Doble mínimo de las partes del cliente de Prisma que se usan.
const fakeDb = (parts: Record<string, unknown>) => parts as never;

describe('repositorios de Prisma', () => {
  it('lee solo las reglas activas', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: 'r', type: 'cif', value: 'B1', category: 'LATERAL', weight: 'fuerte' },
      ]);
    const repo = createPrismaRuleRepository(fakeDb({ rule: { findMany } }));
    expect(await repo.listActiveRules()).toHaveLength(1);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { active: true } });
  });

  it('lee el modelo activo en cada llamada', async () => {
    const findFirst = vi.fn().mockResolvedValue({ provider: 'anthropic', model: 'm' });
    const repo = createPrismaLlmSettingRepository(fakeDb({ llmSetting: { findFirst } }));
    await repo.getActive();
    await repo.getActive();
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { active: true } });
  });

  it('el hilo consulta los demás correos de la conversación con su última corrección y decisión', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a',
        seenCategories: ['lateral', 'ALQUILERES'],
        corrections: [],
        decisions: [{ categories: ['ARCOBETA'] }],
      },
      { id: 'b', seenCategories: [], corrections: [], decisions: [{ categories: ['FOOD BOX'] }] },
    ]);
    const repo = createPrismaThreadRepository(fakeDb({ message: { findMany } }));

    const found = await repo.findThreadCategories('c1', 'm1');

    const args = findMany.mock.calls[0]?.[0];
    expect(args).toMatchObject({ where: { conversationId: 'c1', id: { not: 'm1' } } });
    expect(args.select.decisions).toMatchObject({ orderBy: { createdAt: 'desc' }, take: 1 });
    expect(args.select.corrections).toMatchObject({ orderBy: { createdAt: 'desc' }, take: 1 });
    expect(found).toEqual([
      { category: 'LATERAL', messageId: 'a', origin: 'team' },
      { category: 'FOOD BOX', messageId: 'b', origin: 'decision' },
    ]);
  });
});

describe('threadCategoriesOf', () => {
  const row = (over: Partial<ThreadMessageRow>): ThreadMessageRow => ({
    id: 'a',
    seenCategories: [],
    correction: null,
    decision: null,
    ...over,
  });

  it('una decisión corregida por el equipo no se hereda: manda la corrección', () => {
    const found = threadCategoriesOf(
      row({
        seenCategories: ['LATERAL'],
        correction: { final: ['LATERAL'] },
        decision: { categories: ['FOOD BOX'] },
      }),
    );
    expect(found).toEqual([{ category: 'LATERAL', messageId: 'a', origin: 'team' }]);
  });

  it('si el equipo dejó el correo sin categorías, no se hereda la decisión', () => {
    expect(
      threadCategoriesOf(
        row({ correction: { final: [] }, decision: { categories: ['FOOD BOX'] } }),
      ),
    ).toEqual([]);
    // Solo categorías ajenas al clasificador: el correo está revisado y no aporta nada.
    expect(
      threadCategoriesOf(
        row({ seenCategories: ['ALQUILERES'], decision: { categories: ['FOOD BOX'] } }),
      ),
    ).toEqual([]);
  });

  it('la corrección más reciente manda sobre las categorías vistas', () => {
    expect(
      threadCategoriesOf(
        row({ seenCategories: ['FOOD BOX'], correction: { final: ['ARCOBETA'] } }),
      ),
    ).toEqual([{ category: 'ARCOBETA', messageId: 'a', origin: 'team' }]);
  });

  it('sin revisión del equipo se usa la última decisión', () => {
    expect(threadCategoriesOf(row({ decision: { categories: ['ARCOBETA'] } }))).toEqual([
      { category: 'ARCOBETA', messageId: 'a', origin: 'decision' },
    ]);
    expect(threadCategoriesOf(row({}))).toEqual([]);
  });
});
