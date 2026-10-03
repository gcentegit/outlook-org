import { describe, expect, it, vi } from 'vitest';

import { deleteExpiredAttachmentTexts } from './cleanup';

describe('deleteExpiredAttachmentTexts', () => {
  it('borra solo lo caducado antes de ahora y devuelve cuántos', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const now = new Date('2026-10-02T03:00:00Z');

    const n = await deleteExpiredAttachmentTexts({ attachmentText: { deleteMany } }, now);

    expect(n).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });
  });

  it('propaga el error de la base de datos', async () => {
    const deleteMany = vi.fn().mockRejectedValue(new Error('sin conexión'));
    await expect(deleteExpiredAttachmentTexts({ attachmentText: { deleteMany } })).rejects.toThrow(
      'sin conexión',
    );
  });
});
