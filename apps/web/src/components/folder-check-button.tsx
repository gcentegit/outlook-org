'use client';

import { useActionState } from 'react';

import { checkFoldersAction } from '@/app/(panel)/actions';
import { IDLE, type ActionState } from '@/lib/action-state';

import { buttonClass, Notice } from './ui';

/** Pide al worker que compare ya con las carpetas donde el equipo archiva cada correo. */
export function FolderCheckButton({ lastCheck }: { lastCheck: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkFoldersAction, IDLE);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? 'Pidiendo la comparación...' : 'Comparar con las carpetas'}
        </button>
        <span className="text-sm text-muted">
          Última comparación: {lastCheck}. Se repite sola cada hora.
        </span>
      </div>
      <div aria-live="polite" className="mt-2">
        {state.status === 'ok' && <Notice tone="success">{state.message}</Notice>}
        {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      </div>
    </form>
  );
}
