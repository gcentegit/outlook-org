'use client';

import { useActionState } from 'react';

import { reprocessFlaggedAction } from '@/app/(panel)/actions';
import { IDLE, type ActionState } from '@/lib/action-state';

import { buttonClass, Notice } from './ui';

/**
 * Vuelve a encolar los correos marcados para reprocesar y muestra cuántos eran. Los que esperan al
 * modelo de lenguaje se cuentan aparte: sin él configurado, reprocesarlos los deja igual.
 */
export function ReprocessButton({ count, waitingLlm }: { count: number; waitingLlm: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    reprocessFlaggedAction,
    IDLE,
  );
  return (
    <form action={action} className="mt-3">
      <button type="submit" disabled={pending || count === 0} className={buttonClass.primary}>
        {pending ? 'Pidiendo el reproceso...' : `Reprocesar los ${count} marcados`}
      </button>
      {waitingLlm > 0 && (
        <p className="mt-2 text-sm text-muted">
          {waitingLlm === count ? 'Todos esperan' : `${waitingLlm} de ellos esperan`} al modelo de
          lenguaje, que está apagado: seguirán marcados hasta configurarlo en Modelos.
        </p>
      )}
      <div aria-live="polite" className="mt-2">
        {state.status === 'ok' && <Notice tone="success">{state.message}</Notice>}
        {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      </div>
    </form>
  );
}
