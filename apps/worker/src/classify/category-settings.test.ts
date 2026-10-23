import { describe, expect, it, vi } from 'vitest';

import {
  createLiveModeWarner,
  createMissingServiceCategoryWarner,
  liveCategories,
  readCategoryModes,
  readServiceCategory,
  type CategoryModes,
} from './category-settings';

describe('readCategoryModes', () => {
  it('sin filas todo está en sombra y se ignoran las categorías ajenas', async () => {
    const findMany = vi.fn().mockResolvedValue([{ category: 'ALQUILERES', mode: 'live' }]);
    const modes = await readCategoryModes({ categorySetting: { findMany } } as never);
    expect(modes).toEqual({ 'FOOD BOX': 'shadow', LATERAL: 'shadow', ARCOBETA: 'shadow' });
  });

  it('refleja las categorías en live', async () => {
    const findMany = vi.fn().mockResolvedValue([{ category: 'LATERAL', mode: 'live' }]);
    const modes = await readCategoryModes({ categorySetting: { findMany } } as never);
    expect(liveCategories(modes)).toEqual(['LATERAL']);
  });
});

describe('createLiveModeWarner', () => {
  const shadow: CategoryModes = { 'FOOD BOX': 'shadow', LATERAL: 'shadow', ARCOBETA: 'shadow' };

  it('avisa una vez por conjunto de categorías en live y no avisa si todo está en sombra', () => {
    const warn = vi.fn();
    const check = createLiveModeWarner(warn);
    check(shadow);
    expect(warn).not.toHaveBeenCalled();
    check({ ...shadow, LATERAL: 'live' });
    check({ ...shadow, LATERAL: 'live' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('LATERAL');
    check({ ...shadow, LATERAL: 'live', ARCOBETA: 'live' });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('readServiceCategory', () => {
  it('devuelve la categoría elegida en el panel', async () => {
    const findUnique = vi.fn().mockResolvedValue({ name: '🤖' });
    const name = await readServiceCategory({ serviceCategorySetting: { findUnique } } as never);
    expect(name).toBe('🤖');
    expect(findUnique.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'service' } });
  });

  it('sin fila o sin nombre no hay ninguna', async () => {
    for (const row of [null, { name: null }]) {
      const findUnique = vi.fn().mockResolvedValue(row);
      expect(
        await readServiceCategory({ serviceCategorySetting: { findUnique } } as never),
      ).toBeNull();
    }
  });
});

describe('createMissingServiceCategoryWarner', () => {
  it('avisa una vez por nombre', () => {
    const warn = vi.fn();
    const check = createMissingServiceCategoryWarner(warn);
    check('🤖');
    check('🤖');
    expect(warn).toHaveBeenCalledTimes(1);
    check('Otra');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('explica que una categoría del clasificador no sirve de marca', () => {
    const warn = vi.fn();
    createMissingServiceCategoryWarner(warn)('FOOD BOX');
    expect(warn.mock.calls[0]?.[0]).toMatch(/una de las del clasificador/);
  });
});
