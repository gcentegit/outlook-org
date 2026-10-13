import { prisma } from '@clasificador/db';
import { FOLDERS_SYNC_ID, type MessageFolder } from '@clasificador/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FiltersForm } from '@/components/filters-form';
import { FolderCheckButton } from '@/components/folder-check-button';
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
import {
  appliedReasons,
  getMessageList,
  MESSAGE_STATES,
  type MessageState,
} from '@/server/metrics';

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

/** Dónde está el correo, tal como lo ve quien mira el panel. */
const FOLDER_LABELS: Record<MessageFolder, string> = {
  foodbox: 'Archivado en Foodbox',
  lateral: 'Archivado en Lateral',
  inbox: 'En la Bandeja de entrada',
  other: 'En otra carpeta',
  missing: 'Ya no está en el buzón',
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
  const db = prisma();
  const [result, folderCheck] = await Promise.all([
    getMessageList(
      db,
      { from: filter.range.from, to: filter.range.to, category: filter.category },
      state,
      filter.page,
    ),
    db.syncState.findUnique({ where: { id: FOLDERS_SYNC_ID }, select: { lastSyncAt: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Correos"
        description="Cada correo del periodo con lo que propone el clasificador y por qué. En modo sombra no se escribe nada en el buzón: esto es lo que habría etiquetado. «Equipo» es lo que hizo el equipo: la carpeta donde lo archivó (Foodbox → FOOD BOX, Lateral → LATERAL) y las categorías que le puso."
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
        <div className="mb-4">
          <FolderCheckButton lastCheck={formatDateTime(folderCheck?.lastSyncAt ?? null)} />
        </div>
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
            // Anchos fijos, pensados con «Ver motivo» abierto: así la tabla no salta al abrirlo.
            headers={[
              { label: 'Recibido', width: '12%' },
              { label: 'Correo', width: '21%' },
              { label: 'Estado', width: '15%' },
              { label: 'Propuesto', width: '12%' },
              { label: 'Equipo', width: '12%' },
              { label: 'Por qué', width: '28%' },
            ]}
          >
            {result.items.map((item) => (
              <tr key={item.id}>
                <td className={`${cellClass} whitespace-nowrap`}>
                  {formatDateTime(item.receivedAt)}
                </td>
                <td className={cellClass}>
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
                  <p className="mt-1 text-xs text-muted">
                    {item.folder ? FOLDER_LABELS[item.folder] : 'Carpeta sin comprobar'}
                  </p>
                </td>
                <td className={`${cellClass} text-muted`}>
                  {item.decision?.reason ? (
                    <details>
                      <summary className="cursor-pointer">Ver motivo</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {appliedReasons(item.decision.reason).map((line, i) => (
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
