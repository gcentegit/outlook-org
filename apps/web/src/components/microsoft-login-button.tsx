'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

import { buttonClass, Notice } from './ui';

export function MicrosoftLoginButton({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      // Redirige al navegador a Microsoft; solo vuelve aquí si algo falla antes.
      const result = await authClient.signIn.social({ provider: 'microsoft', callbackURL: '/' });
      if (result.error) {
        setError(result.error.message ?? 'No se pudo iniciar el acceso con Microsoft.');
        setPending(false);
      }
    } catch {
      setError('No se pudo contactar con el servidor. Inténtalo de nuevo.');
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signIn}
        disabled={disabled || pending}
        className={`${buttonClass.primary} w-full`}
      >
        {pending ? 'Redirigiendo a Microsoft...' : 'Entrar con Microsoft'}
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
