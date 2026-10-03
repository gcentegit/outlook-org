'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

import { buttonClass } from './ui';

export function SignOutButton({ label = 'Salir' }: { label?: string }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      // Con o sin error de red, se vuelve al login: allí se vuelve a comprobar la sesión.
      window.location.assign('/login');
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={pending} className={buttonClass.secondary}>
      <LogOut size={16} aria-hidden />
      {label}
    </button>
  );
}
