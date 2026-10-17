'use client';

import { CATEGORIES, type Category } from '@clasificador/shared';
import { useActionState, useEffect, useState } from 'react';

import {
  createRuleAction,
  reviewInboxAction,
  setRuleActiveAction,
  type CreateRuleState,
} from '@/app/(panel)/reglas/actions';
import { IDLE, type ActionState } from '@/lib/action-state';
import { normalizeRuleValue, RULE_TYPES, type RuleType } from '@/lib/rule-form';

import { ActionFeedback, buttonClass, inputClass, labelClass, Notice } from './ui';

const PLACEHOLDERS: Record<RuleType, string> = {
  cif: 'B12345678',
  razon_social: 'Ejemplo Distribución S.L.',
  remitente: 'facturas@ejemplo.com',
  dominio: 'ejemplo.com',
  palabra_clave: 'pedido semanal',
};

/**
 * Alta de una regla: categoría, tipo y valor. El peso sale del tipo. Los campos son controlados:
 * React vacía el formulario tras cada envío y, si no, un error dejaría la categoría en la primera.
 * Creada la regla, pregunta si revisar ya la Bandeja de entrada con ella.
 */
export function NewRuleForm({ liveCategories }: { liveCategories: readonly string[] }) {
  const [state, action, pending] = useActionState<CreateRuleState, FormData>(
    createRuleAction,
    IDLE,
  );
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [type, setType] = useState<RuleType>('cif');
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === 'created') {
      setValue('');
      setAskedFor(state.ruleId);
    }
  }, [state]);

  const weight = RULE_TYPES.find((t) => t.type === type)?.weight;

  return (
    <>
      <form
        action={action}
        onSubmit={(e) => {
          const checked = normalizeRuleValue(type, value);
          setFieldError(checked.ok ? null : checked.message);
          if (!checked.ok) e.preventDefault();
        }}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="rule-category" className={labelClass}>
              Categoría
            </label>
            <select
              id="rule-category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rule-type" className={labelClass}>
              Tipo
            </label>
            <select
              id="rule-type"
              name="type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as RuleType);
                setFieldError(null);
              }}
              className={inputClass}
            >
              {RULE_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label} ({t.weight === 'fuerte' ? 'fuerte' : 'media'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rule-value" className={labelClass}>
              Valor
            </label>
            <input
              id="rule-value"
              name="value"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(null);
              }}
              placeholder={PLACEHOLDERS[type]}
              maxLength={254}
              required
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'rule-error' : 'rule-hint'}
              className={inputClass}
            />
          </div>
        </div>

        {fieldError ? (
          <p id="rule-error" role="alert" className="text-sm text-danger">
            {fieldError}
          </p>
        ) : (
          <p id="rule-hint" className="text-xs text-muted">
            {weight === 'fuerte'
              ? 'Regla fuerte: si aparece en el correo, decide la categoría sola.'
              : 'Regla media: decide solo si ninguna regla fuerte ni el hilo responden.'}{' '}
            Se aplica a los correos que lleguen desde ahora; los ya decididos solo cambian si
            revisas la Bandeja de entrada con ella.
          </p>
        )}

        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? 'Creando...' : 'Crear regla'}
        </button>

        {state.status === 'created' ? (
          <Notice tone="success">{state.message}</Notice>
        ) : (
          <ActionFeedback state={state} />
        )}
      </form>
      {state.status === 'created' && askedFor === state.ruleId && (
        <div className="mt-4 space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium">
            ¿Quieres revisar ahora los correos de la Bandeja de entrada con esta regla?
          </p>
          <ReviewInbox
            ruleId={state.ruleId}
            live={liveCategories.includes(state.category)}
            category={state.category}
            confirmed
            onDismiss={() => setAskedFor(null)}
          />
        </div>
      )}
    </>
  );
}

/**
 * Pide al worker revisar la Bandeja de entrada con una regla: vuelve a decidir los correos que
 * coinciden y que el equipo no ha revisado. Pide confirmar antes, salvo que ya se haya preguntado
 * (`confirmed`). Si la categoría está en live, avisa de que puede escribir en el buzón.
 */
export function ReviewInbox({
  ruleId,
  category,
  live,
  label,
  confirmed = false,
  onDismiss,
}: {
  ruleId: string;
  category: string;
  live: boolean;
  /** Descripción de la regla para lectores de pantalla (en la tabla). */
  label?: string;
  confirmed?: boolean;
  onDismiss?: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewInboxAction, IDLE);
  const [confirming, setConfirming] = useState(confirmed);

  if (state.status === 'ok') return <ActionFeedback state={state} />;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="ruleId" value={ruleId} />
      {confirming ? (
        <>
          <p className="text-xs text-muted">
            El worker relee los correos que siguen en la Bandeja de entrada y vuelve a decidir los
            que coinciden con la regla. Los que ya revisó el equipo no se tocan.
            {live &&
              ` ${category} está en live: si el worker está en modo real, escribirá la categoría en esos correos del buzón.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonClass.primary}>
              {pending ? 'Pidiendo...' : 'Sí, revisar la Bandeja'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => (onDismiss ? onDismiss() : setConfirming(false))}
              className={buttonClass.secondary}
            >
              {onDismiss ? 'Ahora no' : 'Cancelar'}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={label ? `Revisar la Bandeja de entrada con la regla ${label}` : undefined}
          className={buttonClass.secondary}
        >
          Revisar Bandeja
        </button>
      )}
      <ActionFeedback state={state} />
    </form>
  );
}

/**
 * Acciones de una fila de la tabla: activar o desactivar y, si está activa, revisar la Bandeja de
 * entrada con ella. Al activarla se pregunta directamente si revisar la Bandeja.
 */
export function RuleActions({
  id,
  active,
  label,
  category,
  live,
}: {
  id: string;
  active: boolean;
  label: string;
  category: string;
  live: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setRuleActiveAction, IDLE);
  const [askedAt, setAskedAt] = useState<ActionState | null>(null);
  useEffect(() => {
    if (state.status === 'ok' && state.message === 'Regla activada.') setAskedAt(state);
  }, [state]);
  const asking = active && askedAt === state;

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? 'false' : 'true'} />
        <button
          type="submit"
          disabled={pending}
          aria-label={`${active ? 'Desactivar' : 'Activar'} la regla ${label}`}
          className={active ? buttonClass.secondary : buttonClass.primary}
        >
          {pending ? 'Guardando...' : active ? 'Desactivar' : 'Activar'}
        </button>
        {state.status === 'error' && <ActionFeedback state={state} className="mt-1" />}
      </form>
      {active &&
        (asking ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">¿Revisar ahora la Bandeja de entrada con ella?</p>
            <ReviewInbox
              ruleId={id}
              category={category}
              live={live}
              confirmed
              onDismiss={() => setAskedAt(null)}
            />
          </div>
        ) : (
          <ReviewInbox ruleId={id} category={category} live={live} label={label} />
        ))}
    </div>
  );
}
