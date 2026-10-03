'use client';

import { useActionState } from 'react';

import {
  addUserAction,
  removeUserAction,
  setCategoryModeAction,
} from '@/app/(panel)/configuracion/actions';
import { IDLE, type ActionState } from '@/lib/action-state';
import type { CategoryMode } from '@/server/category-modes';

import { Badge, buttonClass, inputClass, labelClass, Notice } from './ui';

function Feedback({ state }: { state: ActionState }) {
  return (
    <div aria-live="polite" className="mt-2">
      {state.status === 'ok' && <Notice tone="success">{state.message}</Notice>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
    </div>
  );
}

/** Una fila por categoría: modo actual y botón para cambiarlo (a live pide confirmar). */
export function CategoryModeRow({
  category,
  mode,
  disabled,
}: {
  category: string;
  mode: CategoryMode;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setCategoryModeAction,
    IDLE,
  );
  const target: CategoryMode = mode === 'live' ? 'shadow' : 'live';
  const checkboxId = `confirm-${category.replace(/\s+/g, '-')}`;

  return (
    <li className="rounded-md border border-border p-3">
      <form action={action} className="flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="mode" value={target} />
        <div className="flex items-center gap-3">
          <span className="font-medium">{category}</span>
          {mode === 'live' ? (
            <Badge tone="danger">Live</Badge>
          ) : (
            <Badge tone="success">Sombra</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {target === 'live' && (
            <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
              <input
                id={checkboxId}
                type="checkbox"
                name="confirmado"
                value="si"
                disabled={disabled}
              />
              Entiendo que se aplicará a los correos del equipo
            </label>
          )}
          <button
            type="submit"
            disabled={disabled || pending}
            className={target === 'live' ? buttonClass.danger : buttonClass.secondary}
          >
            {target === 'live' ? 'Pasar a live' : 'Volver a sombra'}
          </button>
        </div>
      </form>
      <Feedback state={state} />
    </li>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addUserAction, IDLE);
  return (
    <form action={action} noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="new-user-email" className={labelClass}>
            Email de la cuenta de Microsoft
          </label>
          <input
            id="new-user-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="nombre@ejemplo.com"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? 'Guardando...' : 'Dar de alta'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function RemoveUserButton({ id, email }: { id: string; email: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeUserAction, IDLE);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass.danger}
        aria-label={`Dar de baja a ${email}`}
      >
        Dar de baja
      </button>
      {state.status === 'error' && (
        <p role="alert" className="mt-1 max-w-56 text-xs text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
