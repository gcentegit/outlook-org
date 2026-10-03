import { describe, expect, it, vi } from 'vitest';

import { getCategoryModes, setCategoryMode } from './category-modes';

const missingTable = () => new Error('relation "CategorySetting" does not exist');

describe('getCategoryModes', () => {
  it('sin fila una categoría está en sombra', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ category: 'LATERAL', mode: 'live' }]) };
    expect(await getCategoryModes(db as never)).toEqual({
      available: true,
      modes: { 'FOOD BOX': 'shadow', LATERAL: 'live', ARCOBETA: 'shadow' },
    });
  });

  it('si la tabla no existe responde available false', async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(missingTable()) };
    expect(await getCategoryModes(db as never)).toEqual({ available: false });
  });

  it('propaga otros errores', async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')) };
    await expect(getCategoryModes(db as never)).rejects.toThrow('connection refused');
  });
});

describe('setCategoryMode', () => {
  it('guarda el modo', async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValue(1) };
    expect(await setCategoryMode(db as never, 'LATERAL', 'live', 'a@b.es')).toEqual({ ok: true });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('explica que falta la tabla en vez de fallar', async () => {
    const db = { $executeRaw: vi.fn().mockRejectedValue(missingTable()) };
    const result = await setCategoryMode(db as never, 'LATERAL', 'live', 'a@b.es');
    expect(result.ok).toBe(false);
  });
});
