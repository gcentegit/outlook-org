import type { ReactNode } from 'react';

import { NavLinks } from '@/components/nav-links';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Notice } from '@/components/ui';
import { requireUser } from '@/lib/session';

// Todo el panel depende de la sesión y de la base de datos: nada se prerenderiza al compilar.
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  // Sin sesión redirige a /login; con sesión no autorizada, a /login con el motivo.
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-lg font-semibold">Clasificador de Proveedores</p>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          <ThemeToggle />
          {!user.devBypass && <SignOutButton />}
        </div>
      </header>
      <div className="mb-6 border-b border-border pb-3">
        <NavLinks />
      </div>
      {user.devBypass && (
        <div className="mb-6">
          <Notice tone="warning" title="Modo desarrollo sin login">
            AUTH_DEV_BYPASS está activo: entras como {user.email} sin pasar por Microsoft. Solo
            funciona con <code>next dev</code>.
          </Notice>
        </div>
      )}
      <main id="contenido" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
