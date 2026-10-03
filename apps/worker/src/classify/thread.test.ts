import { describe, expect, it, vi } from 'vitest';

import { inheritFromThread, type ThreadRepository } from './thread';

describe('inheritFromThread', () => {
  it('no consulta nada si el correo no tiene conversationId', async () => {
    const repo: ThreadRepository = { findThreadCategories: vi.fn() };
    const map = await inheritFromThread({ messageId: 'm1', conversationId: null }, repo);
    expect(map.size).toBe(0);
    expect(repo.findThreadCategories).not.toHaveBeenCalled();
  });

  it('excluye el propio correo y prefiere la etiqueta del equipo a una decisión previa', async () => {
    const find = vi.fn().mockResolvedValue([
      { category: 'LATERAL', messageId: 'a', origin: 'decision' },
      { category: 'LATERAL', messageId: 'b', origin: 'team' },
      { category: 'ARCOBETA', messageId: 'a', origin: 'decision' },
    ]);
    const map = await inheritFromThread(
      { messageId: 'm1', conversationId: 'c1' },
      {
        findThreadCategories: find,
      },
    );
    expect(find).toHaveBeenCalledWith('c1', 'm1');
    expect(map.get('LATERAL')).toMatchObject({ messageId: 'b', origin: 'team' });
    expect(map.get('ARCOBETA')).toMatchObject({ messageId: 'a', origin: 'decision' });
    expect(map.has('FOOD BOX')).toBe(false);
  });
});
