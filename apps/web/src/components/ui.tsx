import type { ReactNode } from 'react';

import type { ActionState } from '@/lib/action-state';

/** Une clases ignorando los valores vacíos. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export const buttonClass = {
  primary: cn(BUTTON_BASE, 'bg-primary text-primary-foreground hover:opacity-90'),
  secondary: cn(
    BUTTON_BASE,
    'border border-border bg-surface text-foreground hover:bg-surface-muted',
  ),
  danger: cn(BUTTON_BASE, 'border border-danger text-danger hover:bg-danger-soft'),
};

export const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted disabled:opacity-60';

export const labelClass = 'mb-1 block text-sm font-medium';

export function Card({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface p-4 sm:p-5', className)}>
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className={title || description ? 'mt-4' : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
    </header>
  );
}

const NOTICE_STYLES = {
  info: 'border-border bg-surface-muted text-foreground',
  warning: 'border-warning bg-warning-soft text-warning',
  error: 'border-danger bg-danger-soft text-danger',
  success: 'border-success bg-success-soft text-success',
} as const;

/** Aviso en línea. Los de error se anuncian de inmediato a los lectores de pantalla. */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof NOTICE_STYLES;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3 text-sm', NOTICE_STYLES[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  );
}

/** Resultado de una acción del servidor (`useActionState`), anunciado a los lectores de pantalla. */
export function ActionFeedback({ state, className }: { state: ActionState; className?: string }) {
  return (
    <div aria-live="polite" className={className}>
      {state.status === 'ok' && <Notice tone="success">{state.message}</Notice>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** Tabla con desplazamiento horizontal en pantallas estrechas y cabeceras asociadas. */
export function DataTable({
  caption,
  headers,
  children,
}: {
  caption: string;
  /** `width` (p. ej. '20%') fija el ancho de la columna: la tabla deja de recolocarse al abrir un detalle. */
  headers: { label: string; align?: 'right'; width?: string }[];
  children: ReactNode;
}) {
  const fixed = headers.some((h) => h.width);
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-left text-sm', fixed && 'min-w-[60rem] table-fixed')}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-muted">
            {headers.map((h) => (
              <th
                key={h.label}
                scope="col"
                style={h.width ? { width: h.width } : undefined}
                className={cn('px-3 py-2 font-medium', h.align === 'right' && 'text-right')}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export const cellClass = 'px-3 py-2 align-top';
export const numberCellClass = 'px-3 py-2 text-right tabular-nums';

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'border-border bg-surface-muted text-foreground',
    success: 'border-success bg-success-soft text-success',
    warning: 'border-warning bg-warning-soft text-warning',
    danger: 'border-danger bg-danger-soft text-danger',
  };
  return (
    <span
      className={cn(
        'inline-block rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
