import { describe, expect, it } from 'vitest';

import {
  createMasterCategoryResultSchema,
  listMasterCategoriesResultSchema,
  newCategorySchema,
} from './master-categories';

describe('newCategorySchema', () => {
  it('recorta el nombre y acepta los colores preset0 a preset24', () => {
    expect(newCategorySchema.parse({ name: '  Pagado ', color: 'preset24' })).toEqual({
      name: 'Pagado',
      color: 'preset24',
    });
  });

  it('rechaza nombre vacío, demasiado largo y colores fuera de la paleta', () => {
    expect(newCategorySchema.safeParse({ name: '  ', color: 'preset1' }).success).toBe(false);
    expect(newCategorySchema.safeParse({ name: 'x'.repeat(256), color: 'preset1' }).success).toBe(
      false,
    );
    for (const color of ['preset25', 'preset-1', 'none', 'red', '']) {
      expect(newCategorySchema.safeParse({ name: 'a', color }).success).toBe(false);
    }
  });
});

describe('resultados de los trabajos de categorías', () => {
  it('distinguen cada estado', () => {
    expect(
      listMasterCategoriesResultSchema.safeParse({
        status: 'ok',
        mailbox: 'p@x.es',
        categories: [{ id: '1', displayName: 'A', color: 'preset1' }],
      }).success,
    ).toBe(true);
    expect(
      listMasterCategoriesResultSchema.safeParse({ status: 'unconfigured', message: 'faltan' })
        .success,
    ).toBe(true);
    expect(listMasterCategoriesResultSchema.safeParse({ status: 'ok' }).success).toBe(false);
    expect(
      createMasterCategoryResultSchema.safeParse({ status: 'exists', message: 'ya está' }).success,
    ).toBe(true);
  });
});
