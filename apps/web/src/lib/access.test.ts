import { describe, expect, it, vi } from 'vitest';

import { resolveAccess, type AccessDeps, type SessionIdentity } from './access';

const identity = (over: Partial<SessionIdentity> = {}): SessionIdentity => ({
  email: 'admin@ejemplo.com',
  name: 'Marta',
  oid: 'oid-marta',
  ...over,
});

const deps = (over: Partial<AccessDeps> = {}): AccessDeps => ({
  devBypass: false,
  firstAllowedEmail: async () => 'admin@ejemplo.com',
  authorize: async ({ email }) => (email === 'admin@ejemplo.com' ? 'ok' : 'not-listed'),
  sessionUser: async () => null,
  ...over,
});

describe('resolveAccess', () => {
  it('sin sesión es anónimo', async () => {
    expect(await resolveAccess(deps())).toEqual({ status: 'anonymous' });
  });

  it('un usuario de la lista entra (el email se normaliza a minúsculas)', async () => {
    const access = await resolveAccess(
      deps({ sessionUser: async () => identity({ email: ' Admin@Ejemplo.com ' }) }),
    );
    expect(access).toEqual({
      status: 'ok',
      user: { email: 'admin@ejemplo.com', name: 'Marta', devBypass: false },
    });
  });

  it('una sesión de Microsoft fuera de la lista queda prohibida', async () => {
    const access = await resolveAccess(
      deps({ sessionUser: async () => identity({ email: 'otra@ejemplo.com' }) }),
    );
    expect(access).toEqual({
      status: 'forbidden',
      email: 'otra@ejemplo.com',
      reason: 'not-listed',
    });
  });

  it('una sesión sin oid no entra ni consulta la lista', async () => {
    const authorize = vi.fn(async () => 'ok' as const);
    const access = await resolveAccess(
      deps({ authorize, sessionUser: async () => identity({ oid: null }) }),
    );
    expect(access).toMatchObject({ status: 'forbidden', reason: 'identity' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('un email vinculado a otra cuenta de Microsoft queda prohibido', async () => {
    const access = await resolveAccess(
      deps({ authorize: async () => 'other-account', sessionUser: async () => identity() }),
    );
    expect(access).toEqual({
      status: 'forbidden',
      email: 'admin@ejemplo.com',
      reason: 'other-account',
    });
  });

  it('pasa el oid normalizado a la comprobación', async () => {
    const authorize = vi.fn(async () => 'ok' as const);
    await resolveAccess(
      deps({ authorize, sessionUser: async () => identity({ oid: ' OID-Marta ' }) }),
    );
    expect(authorize).toHaveBeenCalledWith({ email: 'admin@ejemplo.com', oid: 'oid-marta' });
  });

  it('el bypass entra como el primer usuario autorizado sin mirar la sesión', async () => {
    const access = await resolveAccess(
      deps({
        devBypass: true,
        sessionUser: async () => {
          throw new Error('no debería consultarse');
        },
      }),
    );
    expect(access).toEqual({
      status: 'ok',
      user: { email: 'admin@ejemplo.com', name: 'admin@ejemplo.com', devBypass: true },
    });
  });

  it('el bypass sin ningún usuario autorizado no da acceso', async () => {
    expect(
      await resolveAccess(deps({ devBypass: true, firstAllowedEmail: async () => null })),
    ).toEqual({ status: 'anonymous' });
  });
});
