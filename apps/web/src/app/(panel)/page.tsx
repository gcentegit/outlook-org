import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';

import { FiltersForm } from '@/components/filters-form';
import { ReprocessButton } from '@/components/reprocess-button';
import {
  Badge,
  Card,
  cellClass,
  DataTable,
  Notice,
  numberCellClass,
  PageHeader,
  Stat,
} from '@/components/ui';
import {
  formatAge,
  formatDateTime,
  formatInt,
  formatLatency,
  formatPercent,
  formatUsd,
} from '@/lib/format';
import { readSyncStaleSeconds } from '@/lib/panel-env';
import { requireUser } from '@/lib/session';
import { parseFilter, type SearchParams } from '@/server/filter-params';
import {
  getMetrics,
  getServiceStatus,
  ORIGINS,
  type Origin,
  type ServiceStatus,
} from '@/server/metrics';

export const metadata: Metadata = { title: 'Resumen' };

const ORIGIN_LABELS: Record<Origin, string> = {
  thread: 'Hilo',
  rule: 'Regla',
  llm: 'LLM',
  none: 'Ninguno',
};

function ServiceCard({ status }: { status: ServiceStatus }) {
  const badge =
    status.state === 'ok' ? (
      <Badge tone="success">Al día</Badge>
    ) : status.state === 'stale' ? (
      <Badge tone="danger">Parado</Badge>
    ) : (
      <Badge tone="warning">Sin sincronizar</Badge>
    );
  return (
    <Card title="Estado del servicio">
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted">Sincronización</dt>
          <dd className="mt-1">{badge}</dd>
        </div>
        <div>
          <dt className="text-muted">Última sincronización</dt>
          <dd className="mt-1 font-medium">
            {formatDateTime(status.lastSyncAt)}
            {status.ageSeconds !== null && (
              <span className="font-normal text-muted"> (hace {formatAge(status.ageSeconds)})</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Pendientes (en cola)</dt>
          <dd className="mt-1 font-medium tabular-nums">{formatInt(status.pending)}</dd>
        </div>
        <div>
          <dt className="text-muted">Fallidos (sin decisión)</dt>
          <dd className="mt-1 font-medium tabular-nums">{formatInt(status.failed)}</dd>
        </div>
        <div>
          <dt className="text-muted">Última decisión</dt>
          <dd className="mt-1 font-medium">{formatDateTime(status.lastDecisionAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">Por reprocesar</dt>
          <dd className="mt-1 font-medium tabular-nums">{formatInt(status.needsReprocess)}</dd>
        </div>
      </dl>
      {status.needsReprocess > 0 && (
        <div className="mt-4">
          <Notice tone="warning" title="Hay correos decididos con un fallo técnico o sin decisión">
            Docling o el modelo de lenguaje no estaban disponibles (o el trabajo agotó los
            reintentos). Esos correos no cuentan en las métricas hasta que se reprocesen.
          </Notice>
          <ReprocessButton count={status.needsReprocess} />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Se considera parado tras {formatAge(status.staleSeconds)} sin sincronizar. Los errores del
        worker no se guardan en la base de datos: están en sus logs.
      </p>
    </Card>
  );
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const filter = parseFilter(await searchParams);
  const db = prisma();
  const [metrics, status] = await Promise.all([
    getMetrics(db, { from: filter.range.from, to: filter.range.to, category: filter.category }),
    getServiceStatus(db, readSyncStaleSeconds()),
  ]);
  const { summary } = metrics;
  const originTotal = ORIGINS.reduce((sum, origin) => sum + metrics.origin[origin], 0);

  return (
    <>
      <PageHeader
        title="Resumen"
        description="Cómo está clasificando el servicio frente a lo que deja el equipo en Outlook. Las fechas son las de recepción del correo (hora de Madrid)."
      />
      <FiltersForm filter={filter} action="/" />

      <div className="space-y-6">
        <ServiceCard status={status} />

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Correos leídos" value={formatInt(summary.read)} />
          <Stat
            label="Clasificados"
            value={formatInt(summary.classified)}
            hint={filter.category ? `con ${filter.category}` : 'con alguna categoría'}
          />
          <Stat
            label="Sin clasificar"
            value={formatInt(summary.doubtful)}
            hint="dudosos: decididos sin categoría"
          />
          <Stat
            label="Sin decisión"
            value={formatInt(summary.pending)}
            hint="en cola, fallidos o por detectar"
          />
          <Stat
            label="Pendientes de revisar"
            value={formatInt(summary.awaitingReview)}
            hint="con decisión, aún sin revisar por el equipo: no cuentan en el acierto"
          />
          <Stat
            label="Cobertura"
            value={formatPercent(summary.coverage)}
            hint="clasificados / (clasificados + dudosos)"
          />
        </dl>

        <Card
          title="Precisión y cobertura por categoría"
          description="Frente a las categorías finales del equipo (correcciones o categorías vistas en Outlook). Solo cuentan los correos que el equipo ya ha revisado (tienen alguna categoría en Outlook o una corrección); los demás no suman ni como acierto ni como fallo y se muestran aparte como «pendientes de revisar»."
        >
          <DataTable
            caption="Precisión y cobertura por categoría"
            headers={[
              { label: 'Categoría' },
              { label: 'Precisión', align: 'right' },
              { label: 'Cobertura', align: 'right' },
              { label: 'Aciertos', align: 'right' },
              { label: 'Falsos positivos', align: 'right' },
              { label: 'Falsos negativos', align: 'right' },
            ]}
          >
            {metrics.perCategory.map((row) => (
              <tr key={row.category}>
                <th scope="row" className={`${cellClass} font-medium`}>
                  {row.category}
                </th>
                <td className={numberCellClass}>{formatPercent(row.precision)}</td>
                <td className={numberCellClass}>{formatPercent(row.recall)}</td>
                <td className={numberCellClass}>{formatInt(row.tp)}</td>
                <td className={numberCellClass}>{formatInt(row.fp)}</td>
                <td className={numberCellClass}>{formatInt(row.fn)}</td>
              </tr>
            ))}
          </DataTable>
          <p className="mt-3 text-xs text-muted">
            Precisión = aciertos / (aciertos + falsos positivos). Cobertura = aciertos / (aciertos +
            falsos negativos). Objetivo de activación: precisión de al menos 95 % por categoría. Con
            pocos correos revisados las cifras no son fiables: mira cuántos hay pendientes de
            revisar antes de fiarte de ellas.
          </p>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Origen de la decisión"
            description="Quién decidió, en la decisión vigente de cada correo."
          >
            <ul className="space-y-3">
              {ORIGINS.map((origin) => {
                const count = metrics.origin[origin];
                const share = originTotal === 0 ? 0 : count / originTotal;
                return (
                  <li key={origin}>
                    <div className="flex justify-between text-sm">
                      <span>{ORIGIN_LABELS[origin]}</span>
                      <span className="tabular-nums">
                        {formatInt(count)} ({formatPercent(originTotal === 0 ? null : share)})
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted"
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(share * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card
            title="Por modelo"
            description="Todas las decisiones con LLM del periodo (no se filtra por categoría; no cuentan las degradadas por un fallo técnico). Acierto: categorías idénticas a las del equipo, sobre las decisiones ya revisadas por el equipo."
          >
            {metrics.perModel.length === 0 ? (
              <p className="text-sm text-muted">Todavía no hay decisiones tomadas por un modelo.</p>
            ) : (
              <DataTable
                caption="Decisiones, acierto, coste y latencia por modelo"
                headers={[
                  { label: 'Modelo' },
                  { label: 'Decisiones', align: 'right' },
                  { label: 'Revisadas', align: 'right' },
                  { label: 'Acierto', align: 'right' },
                  { label: 'Coste', align: 'right' },
                  { label: 'Latencia', align: 'right' },
                ]}
              >
                {metrics.perModel.map((row) => (
                  <tr key={row.model}>
                    <th scope="row" className={`${cellClass} break-all font-medium`}>
                      {row.model}
                    </th>
                    <td className={numberCellClass}>{formatInt(row.decisions)}</td>
                    <td className={numberCellClass}>{formatInt(row.reviewed)}</td>
                    <td className={numberCellClass}>{formatPercent(row.accuracy)}</td>
                    <td className={numberCellClass}>{formatUsd(row.costUsd)}</td>
                    <td className={numberCellClass}>{formatLatency(row.avgLatencyMs)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
            {metrics.perModel.length > 0 &&
              metrics.perModel.every((m) => m.avgLatencyMs === null) && (
                <div className="mt-3">
                  <Notice>
                    La latencia no se registra todavía (falta la columna{' '}
                    <code>Decision.latencyMs</code>).
                  </Notice>
                </div>
              )}
          </Card>
        </div>
      </div>
    </>
  );
}
