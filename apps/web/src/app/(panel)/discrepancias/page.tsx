import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FiltersForm } from '@/components/filters-form';
import { Badge, buttonClass, Card, cellClass, DataTable, PageHeader } from '@/components/ui';
import { formatDateTime, formatInt, formatPercent } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { parseFilter, type PanelFilter, type SearchParams } from '@/server/filter-params';
import { getDiscrepancies } from '@/server/metrics';

export const metadata: Metadata = { title: 'Discrepancias' };

const ORIGIN_LABELS = { thread: 'Hilo', rule: 'Regla', llm: 'LLM', none: 'Ninguno' } as const;

function pageHref(filter: PanelFilter, page: number): string {
  const params = new URLSearchParams({
    desde: filter.range.fromDay,
    hasta: filter.range.toDay,
    pagina: String(page),
  });
  if (filter.category) params.set('categoria', filter.category);
  return `/discrepancias?${params.toString()}`;
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

export default async function DiscrepanciesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const filter = parseFilter(await searchParams);
  const result = await getDiscrepancies(
    prisma(),
    { from: filter.range.from, to: filter.range.to, category: filter.category },
    filter.page,
  );

  return (
    <>
      <PageHeader
        title="Discrepancias"
        description="Correos revisados por el equipo donde dejó categorías distintas de las que decidió el clasificador (la decisión más reciente de cada correo). Los correos aún sin revisar no aparecen: no hay con qué compararlos."
      />
      <FiltersForm filter={filter} action="/discrepancias" />
      <Card>
        <p className="mb-3 text-sm text-muted" aria-live="polite">
          {formatInt(result.total)} discrepancias en el periodo. Página {result.page} de{' '}
          {result.pages}.
        </p>
        {result.items.length === 0 ? (
          <p className="text-sm">No hay discrepancias con este filtro.</p>
        ) : (
          <DataTable
            caption="Discrepancias entre el clasificador y el equipo"
            headers={[
              { label: 'Recibido' },
              { label: 'Correo' },
              { label: 'Propuesto' },
              { label: 'Equipo' },
              { label: 'Origen' },
              { label: 'Motivo' },
            ]}
          >
            {result.items.map((item) => (
              <tr key={item.id}>
                <td className={`${cellClass} whitespace-nowrap`}>
                  {formatDateTime(item.receivedAt)}
                </td>
                <td className={`${cellClass} max-w-xs`}>
                  <p className="break-words font-medium">{item.subject || '(sin asunto)'}</p>
                  <p className="break-all text-xs text-muted">{item.sender}</p>
                </td>
                <td className={cellClass}>
                  <Categories names={item.decision.proposed} />
                  <p className="mt-1 text-xs text-muted">
                    {item.decision.mode === 'live' ? 'live' : 'sombra'}
                    {item.decision.confidence !== null &&
                      ` · confianza ${formatPercent(item.decision.confidence)}`}
                  </p>
                </td>
                <td className={cellClass}>
                  <Categories names={item.team} />
                </td>
                <td className={cellClass}>
                  {ORIGIN_LABELS[item.decision.source]}
                  {item.decision.model && (
                    <p className="break-all text-xs text-muted">{item.decision.model}</p>
                  )}
                </td>
                <td className={`${cellClass} max-w-sm text-muted`}>{item.decision.reason ?? ''}</td>
              </tr>
            ))}
          </DataTable>
        )}

        {result.pages > 1 && (
          <nav aria-label="Paginación" className="mt-4 flex items-center justify-between">
            {result.page > 1 ? (
              <Link href={pageHref(filter, result.page - 1)} className={buttonClass.secondary}>
                Anterior
              </Link>
            ) : (
              <span />
            )}
            {result.page < result.pages ? (
              <Link href={pageHref(filter, result.page + 1)} className={buttonClass.secondary}>
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
