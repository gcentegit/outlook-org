import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FiltersForm } from '@/components/filters-form';
import {
  Badge,
  buttonClass,
  Card,
  cellClass,
  DataTable,
  inputClass,
  labelClass,
  PageHeader,
} from '@/components/ui';
import { formatDateTime, formatInt, formatPercent } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { parseFilter, type PanelFilter, type SearchParams } from '@/server/filter-params';
import { getMessageList, MESSAGE_STATES, type MessageState } from '@/server/metrics';

export const metadata: Metadata = { title: 'Correos' };

const ORIGIN_LABELS = { thread: 'Hilo', rule: 'Regla', llm: 'LLM', none: 'Ninguno' } as const;

const STATES: Record<
  MessageState,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  classified: { label: 'Clasificado', tone: 'success' },
  none: { label: 'Sin categoría', tone: 'neutral' },
  doubt: { label: 'En duda', tone: 'warning' },
  reprocess: { label: 'Pendiente de reprocesar', tone: 'warning' },
  queued: { label: 'En cola', tone: 'neutral' },
};

function parseState(params: SearchParams): MessageState | null {
  const raw = Array.isArray(params.estado) ? params.estado[0] : params.estado;
  return MESSAGE_STATES.find((s) => s === raw) ?? null;
}

function pageHref(filter: PanelFilter, state: MessageState | null, page: number): string {
  const params = new URLSearchParams({
    desde: filter.range.fromDay,
    hasta: filter.range.toDay,
    pagina: String(page),
  });
  if (filter.category) params.set('categoria', filter.category);
  if (state) params.set('estado', state);
  return `/correos?${params.toString()}`;
}

function Categories({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <span className="text-muted">Ninguna</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <Badge key={name}>{name}</Badge>
      ))}
    </span>
  );
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const params = await searchParams;
  const filter = parseFilter(params);
  const state = parseState(params);
  const result = await getMessageList(
    prisma(),
    { from: filter.range.from, to: filter.range.to, category: filter.category },
    state,
    filter.page,
  );

  return (
    <>
      <PageHeader
        title="Correos"
        description="Cada correo del periodo con lo que propone el clasificador y por qué. En modo sombra no se escribe nada en el buzón: esto es lo que habría etiquetado."
      />
      <FiltersForm filter={filter} action="/correos">
        <div>
          <label htmlFor="estado" className={labelClass}>
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={state ?? ''} className={inputClass}>
            <option value="">Todos</option>
            {MESSAGE_STATES.map((s) => (
              <option key={s} value={s}>
                {STATES[s].label}
              </option>
            ))}
          </select>
        </div>
      </FiltersForm>

      <Card>
        <ul className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Correos por estado">
          {MESSAGE_STATES.map((s) => (
            <li key={s}>
              <Link href={pageHref(filter, s, 1)} className="hover:underline">
                <Badge tone={STATES[s].tone}>
                  {STATES[s].label}: {formatInt(result.counts[s])}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mb-3 text-sm text-muted" aria-live="polite">
          {formatInt(result.total)} correos con este filtro. Página {result.page} de {result.pages}.
        </p>
        {result.items.length === 0 ? (
          <p className="text-sm">No hay correos con este filtro.</p>
        ) : (
          <DataTable
            caption="Correos y decisión del clasificador"
            headers={[
              { label: 'Recibido' },
              { label: 'Correo' },
              { label: 'Estado' },
              { label: 'Propuesto' },
              { label: 'Equipo' },
              { label: 'Por qué' },
            ]}
          >
            {result.items.map((item) => (
              <tr key={item.id}>
                <td className={`${cellClass} whitespace-nowrap`}>
                  {formatDateTime(item.receivedAt)}
                </td>
                <td className={`${cellClass} max-w-xs`}>
                  <p className="break-words font-medium">{item.subject || '(sin asunto)'}</p>
                  <p className="break-all text-xs text-muted">{item.sender || '(pendiente)'}</p>
                </td>
                <td className={`${cellClass} whitespace-nowrap`}>
                  <Badge tone={STATES[item.state].tone}>{STATES[item.state].label}</Badge>
                </td>
                <td className={cellClass}>
                  {item.decision && !item.decision.degraded ? (
                    <>
                      <Categories names={item.decision.proposed} />
                      <p className="mt-1 text-xs text-muted">
                        {ORIGIN_LABELS[item.decision.source]}
                        {item.decision.confidence !== null &&
                          ` · confianza ${formatPercent(item.decision.confidence)}`}
                      </p>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className={cellClass}>
                  <Categories names={item.team} />
                </td>
                <td className={`${cellClass} max-w-sm text-muted`}>
                  {item.decision?.reason ? (
                    <details>
                      <summary className="cursor-pointer">Ver motivo</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {item.decision.reason.split('; ').map((line, i) => (
                          <li key={i} className="break-words">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    ''
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        {result.pages > 1 && (
          <nav aria-label="Paginación" className="mt-4 flex items-center justify-between">
            {result.page > 1 ? (
              <Link
                href={pageHref(filter, state, result.page - 1)}
                className={buttonClass.secondary}
              >
                Anterior
              </Link>
            ) : (
              <span />
            )}
            {result.page < result.pages ? (
              <Link
                href={pageHref(filter, state, result.page + 1)}
                className={buttonClass.secondary}
              >
                Siguiente
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </>
  );
}
