'use client';

import { useActionState, type ReactNode } from 'react';

import { IDLE, type ActionState } from '@/lib/action-state';

import { ActionFeedback, buttonClass } from './ui';

/** Botón que lanza una acción del servidor sin datos y muestra su resultado debajo. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  children,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  /** Texto al lado del botón. */
  children?: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, IDLE);
  return (
    <form action={run}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? pendingLabel : label}
        </button>
        {children}
      </div>
      <ActionFeedback state={state} className="mt-2" />
    </form>
  );
}
