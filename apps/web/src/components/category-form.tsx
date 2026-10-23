'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { createCategoryAction, setServiceCategoryAction } from '@/app/(panel)/categorias/actions';
import { IDLE, type ActionState } from '@/lib/action-state';
import { OUTLOOK_COLORS, newCategorySchema } from '@/lib/outlook-colors';

import { ActionFeedback, buttonClass, inputClass, labelClass, Notice } from './ui';

/** Crear una categoría es visible para todo el equipo: se pide confirmar en un segundo paso. */
export function CategoryForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createCategoryAction,
    IDLE,
  );
  const [name, setName] = useState('');
  const [color, setColor] = useState('preset7');
  const [confirming, setConfirming] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.status === 'ok') setName('');
    if (state.status !== 'idle') setConfirming(false);
  }, [state]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function askConfirmation() {
    const parsed = newCategorySchema.safeParse({ name, color });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Datos no válidos.');
      return;
    }
    setFieldError(null);
    setConfirming(true);
  }

  const swatch = OUTLOOK_COLORS.find((c) => c.preset === color);

  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="category-name" className={labelClass}>
            Nombre
          </label>
          <input
            id="category-name"
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setConfirming(false);
            }}
            maxLength={255}
            required
            disabled={disabled}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'category-error' : undefined}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="category-color" className={labelClass}>
            Color
          </label>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-6 w-6 shrink-0 rounded border border-border"
              style={{ backgroundColor: swatch?.hex }}
            />
            <select
              id="category-color"
              name="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setConfirming(false);
              }}
              disabled={disabled}
              className={inputClass}
            >
              {OUTLOOK_COLORS.map((c) => (
                <option key={c.preset} value={c.preset}>
                  {c.name} ({c.preset})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {fieldError && (
        <p id="category-error" role="alert" className="text-sm text-danger">
          {fieldError}
        </p>
      )}

      {confirming ? (
        <div className="space-y-3">
          <Notice tone="warning" title="Confirma la creación">
            Vas a crear la categoría <strong>«{name.trim()}»</strong> en el buzón compartido de
            Proveedores. La verá todo el equipo y no se puede renombrar ni borrar desde este panel.
          </Notice>
          <input type="hidden" name="confirmado" value="si" />
          <div className="flex gap-3">
            <button
              ref={confirmRef}
              type="submit"
              disabled={pending}
              className={buttonClass.primary}
            >
              {pending ? 'Creando...' : 'Sí, crear categoría'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={buttonClass.secondary}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={askConfirmation}
          disabled={disabled}
          className={buttonClass.primary}
        >
          Crear categoría
        </button>
      )}

      <ActionFeedback state={state} />
    </form>
  );
}

/**
 * Categoría que el clasificador añade a los correos en los que escribe. Solo ofrece las de la lista
 * maestra del buzón; si la guardada ya no está, se muestra igualmente para poder cambiarla.
 */
export function ServiceCategoryForm({
  options,
  current,
  disabled,
}: {
  options: readonly string[];
  current: string | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setServiceCategoryAction,
    IDLE,
  );
  const [name, setName] = useState(current ?? '');
  const choices = current && !options.includes(current) ? [current, ...options] : options;

  return (
    <form action={action} className="space-y-4">
      <div className="max-w-sm">
        <label htmlFor="service-category" className={labelClass}>
          Categoría del clasificador
        </label>
        <select
          id="service-category"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          className={inputClass}
        >
          <option value="">Ninguna</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={disabled || pending || name === (current ?? '')}
        className={buttonClass.primary}
      >
        {pending ? 'Guardando...' : 'Guardar'}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}
