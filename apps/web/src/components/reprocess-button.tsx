'use client';

import { useActionState } from 'react';

import { reprocessFlaggedAction } from '@/app/(panel)/actions';
import { IDLE, type ActionState } from '@/lib/action-state';

import { buttonClass, Notice } from './ui';

/** Vuelve a encolar los correos marcados para reprocesar y muestra cuántos eran. */
export function ReprocessButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    reprocessFlaggedAction,
    IDLE,
  );
  return (
    <form action={action} className="mt-3">
      <button type="submit" disabled={pending || count === 0} className={buttonClass.secondary}>
        {pending ? 'Pidiendo el reproceso...' : `Reprocesar los ${count} marcados`}
      </button>
      <div aria-live="polite" className="mt-2">
        {state.status === 'ok' && <Notice tone="success">{state.message}</Notice>}
        {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      </div>
    </form>
  );
}
