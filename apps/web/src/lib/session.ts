import 'server-only';

import { prisma } from '@clasificador/db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { resolveAccess, type Access, type PanelUser } from './access';
import { getAuth } from './auth';
import { authorizeUser } from '@/server/allowed-users';

import { isDevBypassActive, readMicrosoftLogin } from './panel-env';

/** Acceso de la petición en curso; `cache` lo calcula una sola vez por render. */
export const getAccess = cache((): Promise<Access> =>
  resolveAccess({
    devBypass: isDevBypassActive(),
    firstAllowedEmail: async () => {
      const first = await prisma().allowedUser.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { email: true },
      });
      return first?.email ?? null;
    },
    authorize: ({ email, oid }) => authorizeUser(prisma(), email, oid),
    sessionUser: async () => {
      // Sin credenciales de Microsoft no puede haber sesión: no se arranca better-auth.
      if (!readMicrosoftLogin().configured) return null;
      const session = await getAuth().api.getSession({ headers: await headers() });
      if (!session?.user.email) return null;
      // better-auth guarda como `accountId` el `oid` verificado del id_token de Microsoft; sale de
      // la cookie de cuenta, sin base de datos.
      // Si la cookie de cuenta falta o caducó, no hay `oid` y no se entra (se pide volver a iniciar sesión).
      const accounts = await getAuth()
        .api.listUserAccounts({ headers: await headers() })
        .catch(() => []);
      const oid = accounts.find((account) => account.providerId === 'microsoft')?.accountId;
      return { email: session.user.email, name: session.user.name, oid: oid ?? null };
    },
  }),
);

/**
 * Exige un usuario autorizado: las páginas del panel y todas las acciones del servidor la
 * llaman. Sin sesión redirige a /login; con sesión no autorizada, a /login con el motivo.
 */
export async function requireUser(): Promise<PanelUser> {
  const access = await getAccess();
  if (access.status === 'ok') return access.user;
  redirect(access.status === 'forbidden' ? '/login?error=no-autorizado' : '/login');
}
