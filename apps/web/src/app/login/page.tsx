import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { MicrosoftLoginButton } from '@/components/microsoft-login-button';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card, Notice } from '@/components/ui';
import { isDevBypassActive, readMicrosoftLogin } from '@/lib/panel-env';
import { getAccess } from '@/lib/session';

export const metadata: Metadata = { title: 'Acceso' };
export const dynamic = 'force-dynamic';

/** Mensaje para el código `error` que better-auth o el panel dejan en la URL. */
function describeError(code: string | undefined): string | null {
  if (!code) return null;
  if (code === 'no-autorizado') return null; // se explica con el email más abajo
  if (code === 'access_denied') return 'Se canceló el acceso con Microsoft.';
  // Lo que deja el login cuando el token no es del tenant configurado (ver `lib/auth.ts`).
  if (code === 'email_not_found') {
    return 'Esa cuenta de Microsoft no pertenece a la organización de este panel o no trae email.';
  }
  const safe = /^[\w-]{1,60}$/.test(code) ? ` (código: ${code})` : '';
  return `No se pudo completar el acceso con Microsoft${safe}. Inténtalo de nuevo.`;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;

  const access = await getAccess();
  if (access.status === 'ok') redirect('/');

  const microsoft = readMicrosoftLogin();
  const errorMessage = describeError(code);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Clasificador de Proveedores</h1>
        <ThemeToggle />
      </div>

      {access.status === 'forbidden' ? (
        <Card title="Sin acceso">
          <p className="text-sm">
            {access.reason === 'other-account' ? (
              <>
                El email <strong>{access.email}</strong> está dado de alta, pero vinculado a otra
                cuenta de Microsoft. Pide a un administrador del panel que te dé de baja y de alta
                de nuevo.
              </>
            ) : access.reason === 'identity' ? (
              <>
                No se pudo verificar la identidad de la cuenta <strong>{access.email}</strong>.
                Cierra la sesión y vuelve a entrar.
              </>
            ) : (
              <>
                La cuenta <strong>{access.email}</strong> no está en la lista de usuarios
                autorizados. Pide a un administrador del panel que te dé de alta.
              </>
            )}
          </p>
          <div className="mt-4">
            <SignOutButton label="Cerrar sesión" />
          </div>
        </Card>
      ) : (
        <Card
          title="Acceso al panel"
          description="Entra con tu cuenta de Microsoft de la empresa. Solo pueden acceder los usuarios autorizados."
        >
          <div className="space-y-4">
            {!microsoft.configured && (
              <Notice tone="warning" title="Falta configurar el login de Microsoft">
                Define {microsoft.missing.map((name) => name).join(', ')} en el entorno del panel
                (app de login de Entra ID, parte C de la guía de Entra ID). Hasta entonces nadie
                puede entrar.
              </Notice>
            )}
            {isDevBypassActive() && (
              <Notice tone="warning" title="Modo desarrollo">
                AUTH_DEV_BYPASS está activo pero no hay ningún usuario autorizado: ejecuta{' '}
                <code>pnpm db:seed</code> para dar de alta el primero.
              </Notice>
            )}
            {errorMessage && <Notice tone="error">{errorMessage}</Notice>}
            <MicrosoftLoginButton disabled={!microsoft.configured} />
          </div>
        </Card>
      )}
    </div>
  );
}
