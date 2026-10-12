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
      // El `oid` verificado del id_token viaja en la sesión (ver `auth.ts`). Una sesión anterior a
      // este campo no lo trae: no se entra y se pide volver a iniciar sesión.
      return { email: session.user.email, name: session.user.name, oid: session.user.oid ?? null };
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
