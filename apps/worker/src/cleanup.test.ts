import { describe, expect, it, vi } from 'vitest';

import {
  deleteExpiredAttachmentTexts,
  deleteExpiredMessages,
  messageRetentionCutoff,
} from './cleanup';

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

describe('deleteExpiredMessages', () => {
  const now = new Date('2026-10-15T03:30:00Z');
  const where = { receivedAt: { lt: new Date('2025-10-15T03:30:00Z') } };

  it('calcula el corte exacto a 12 meses', () => {
    expect(messageRetentionCutoff(now)).toEqual(new Date('2025-10-15T03:30:00Z'));
  });

  it('activado borra los anteriores al corte y devuelve cuántos', async () => {
    const message = {
      count: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
    };

    const result = await deleteExpiredMessages({ message }, { enabled: true, now });

    expect(result).toEqual({ count: 4, deleted: true });
    expect(message.deleteMany).toHaveBeenCalledWith({ where });
    expect(message.count).not.toHaveBeenCalled();
  });

  it('desactivado no borra, solo cuenta cuántos borraría', async () => {
    const message = {
      count: vi.fn().mockResolvedValue(7),
      deleteMany: vi.fn(),
    };

    const result = await deleteExpiredMessages({ message }, { enabled: false, now });

    expect(result).toEqual({ count: 7, deleted: false });
    expect(message.count).toHaveBeenCalledWith({ where });
    expect(message.deleteMany).not.toHaveBeenCalled();
  });
});
