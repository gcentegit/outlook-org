import { CATEGORIES } from '@clasificador/shared';
import type { ReactNode } from 'react';

import type { PanelFilter } from '@/server/filter-params';

import { buttonClass, inputClass, labelClass } from './ui';

/**
 * Formulario GET con rango de fechas y categoría: el filtro vive en la URL (se puede compartir).
 * `children` añade campos propios de una página antes del botón.
 */
export function FiltersForm({
  filter,
  action,
  children,
}: {
  filter: PanelFilter;
  action: string;
  children?: ReactNode;
}) {
  return (
    <form
      method="get"
      action={action}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div>
        <label htmlFor="desde" className={labelClass}>
          Desde
        </label>
        <input
          id="desde"
          name="desde"
          type="date"
          defaultValue={filter.range.fromDay}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="hasta" className={labelClass}>
          Hasta
        </label>
        <input
          id="hasta"
          name="hasta"
          type="date"
          defaultValue={filter.range.toDay}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="categoria" className={labelClass}>
          Categoría
        </label>
        <select
          id="categoria"
          name="categoria"
          defaultValue={filter.category ?? ''}
          className={inputClass}
        >
          <option value="">Todas</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {children}
      <button type="submit" className={buttonClass.primary}>
        Aplicar
      </button>
    </form>
  );
}
