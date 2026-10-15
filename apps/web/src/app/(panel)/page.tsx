import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FiltersForm } from '@/components/filters-form';
import { FolderCheckButton } from '@/components/folder-check-button';
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
  formatDay,
  formatInt,
  formatLatency,
  formatPercent,
  formatUsd,
} from '@/lib/format';
import { readClientSecretExpiry, readSyncStaleSeconds } from '@/lib/panel-env';
import { requireUser } from '@/lib/session';
import { credentialWarnings } from '@/server/credential-expiry';
import { parseFilter, type SearchParams } from '@/server/filter-params';
import {
  getMetrics,
  getReprocessCauses,
  getServiceStatus,
  REPROCESS_CAUSES,
  type ReprocessCause,
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

/** Qué le pasó a cada grupo de correos pendientes y qué hacer con ellos. */
const CAUSE_TEXT: Record<ReprocessCause, (n: string) => string> = {
  'llm-unavailable': (n) =>
    `${n}: necesitan el modelo de lenguaje, que no está configurado (falta la clave o el proveedor). Reprocesarlos no servirá hasta configurarlo en Modelos.`,
  'llm-failed': (n) =>
    `${n}: el modelo de lenguaje no respondió (fallo pasajero). Se pueden reprocesar ya.`,
  extraction: (n) =>
    `${n}: no se pudieron leer sus adjuntos (docling o la descarga fallaron). Se pueden reprocesar ya.`,
  retries: (n) =>
    `${n}: el worker agotó los reintentos sin decidir. Revisa sus registros antes de reprocesar.`,
};

function ServiceCard({
  status,
  causes,
}: {
  status: ServiceStatus;
  causes: Record<ReprocessCause, number>;
}) {
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
          <Notice
            tone="warning"
            title={
              status.needsReprocess === 1
                ? '1 correo pendiente de reprocesar'
                : `${formatInt(status.needsReprocess)} correos pendientes de reprocesar`
            }
          >
            <ul className="list-disc space-y-1 pl-4">
              {REPROCESS_CAUSES.filter((cause) => causes[cause] > 0).map((cause) => (
                <li key={cause}>{CAUSE_TEXT[cause](formatInt(causes[cause]))}</li>
              ))}
            </ul>
            <p className="mt-2">
              No cuentan en las métricas hasta que se reprocesen.{' '}
              <Link href="/correos?estado=reprocess" className="font-medium underline">
                Ver cuáles son
              </Link>
            </p>
          </Notice>
          <div className="mt-3">
            <ReprocessButton count={status.needsReprocess} waitingLlm={causes['llm-unavailable']} />
          </div>
        </div>
      )}
      <h3 className="mt-6 text-sm font-medium">Historial de caídas</h3>
      {status.outages.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No se ha registrado ninguna caída.</p>
      ) : (
        <DataTable
          caption="Últimas caídas de la sincronización"
          headers={[
            { label: 'Inicio' },
            { label: 'Fin' },
            { label: 'Duración', align: 'right' },
            { label: 'Causa' },
          ]}
        >
          {status.outages.map((outage) => (
            <tr key={outage.id}>
              <th scope="row" className={`${cellClass} whitespace-nowrap font-medium`}>
                {formatDateTime(outage.startedAt)}
              </th>
              <td className={cellClass}>
                {outage.endedAt ? (
                  formatDateTime(outage.endedAt)
                ) : (
                  <Badge tone="danger">En curso</Badge>
                )}
              </td>
              <td className={numberCellClass}>{formatAge(outage.durationSeconds)}</td>
              <td className={`${cellClass} break-words`}>{outage.cause}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <p className="mt-3 text-xs text-muted">
        Se considera parado tras {formatAge(status.staleSeconds)} sin sincronizar. Las caídas se
        registran aquí; el detalle de los errores está en los logs del worker y los avisos, en
        Uptime Kuma.
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
  const [metrics, status, causes] = await Promise.all([
    getMetrics(db, { from: filter.range.from, to: filter.range.to, category: filter.category }),
    getServiceStatus(db, readSyncStaleSeconds()),
    getReprocessCauses(db),
  ]);
  const { summary } = metrics;
  const expiring = credentialWarnings({
    certificate: status.certExpiresAt,
    loginSecret: readClientSecretExpiry(),
  });
  const originTotal = ORIGINS.reduce((sum, origin) => sum + metrics.origin[origin], 0);

  return (
    <>
      <PageHeader
        title="Resumen"
        description="Cómo está clasificando el servicio frente a lo que hace el equipo en Outlook: dónde archiva cada correo y qué categorías le pone. Las fechas son las de recepción del correo (hora de Madrid)."
      />
      <FiltersForm filter={filter} action="/" />

      <div className="space-y-6">
        {expiring.map((w) => (
          <Notice
            key={w.name}
            tone={w.days < 0 ? 'error' : 'warning'}
            title={
              w.days < 0
                ? `${w.name} ha caducado`
                : `${w.name} caduca en ${w.days === 1 ? '1 día' : `${w.days} días`}`
            }
          >
            Si caduca, {w.consequence}. Renuévalo según{' '}
            <code>docs/operacion/credenciales-y-caducidades.md</code>.
          </Notice>
        ))}
        <ServiceCard status={status} causes={causes} />

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            label="Sin contrastar con el equipo"
            value={formatInt(summary.awaitingReview)}
            hint="decididos, pero el equipo aún no los ha archivado en Foodbox o Lateral ni les ha puesto categoría: no cuentan en el acierto"
          />
          <Stat
            label="Cobertura"
            value={formatPercent(summary.coverage)}
            hint="clasificados / (clasificados + dudosos)"
          />
          <Stat
            label="Eliminados por el equipo"
            value={formatInt(summary.deleted)}
            hint={`${formatInt(summary.deletedUnclassified)} sin categoría propuesta; no cuentan en las demás cifras ni en el acierto`}
          />
        </dl>

        <Card
          title="Precisión y cobertura por categoría"
          description="Frente a lo que hizo el equipo: la carpeta donde archivó el correo (árbol Foodbox → FOOD BOX, árbol Lateral → LATERAL) y las categorías que le puso en Outlook. Solo cuentan los correos ya archivados o etiquetados; los demás no suman ni como acierto ni como fallo y se cuentan aparte como «sin contrastar». Los que el equipo eliminó tampoco cuentan. La carpeta no dice nada de ARCOBETA, que se archiva en Lateral: ARCOBETA solo se compara cuando el equipo pone la categoría."
        >
          <div className="mb-4">
            <FolderCheckButton lastCheck={status.lastFolderCheckAt} />
          </div>
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

        <Card
          title="Evolución por semana"
          description="Las mismas cifras por semana de recepción del correo, la más reciente arriba: muestra si el clasificador va acertando más con el tiempo. Una semana reciente tiene pocos correos contrastados hasta que el equipo los archiva."
        >
          {metrics.perWeek.length === 0 ? (
            <p className="text-sm text-muted">
              Aún no hay correos contrastados con el equipo en este periodo.
            </p>
          ) : (
            <DataTable
              caption="Precisión y cobertura por semana"
              headers={[
                { label: 'Semana del' },
                { label: 'Contrastados', align: 'right' },
                ...metrics.perCategory.flatMap((row) => [
                  { label: `${row.category} precisión`, align: 'right' as const },
                  { label: `${row.category} cobertura`, align: 'right' as const },
                ]),
              ]}
            >
              {metrics.perWeek.map((week) => (
                <tr key={week.week}>
                  <th scope="row" className={`${cellClass} whitespace-nowrap font-medium`}>
                    {formatDay(week.week)}
                  </th>
                  <td className={numberCellClass}>{formatInt(week.reviewed)}</td>
                  {week.perCategory.flatMap((row) => [
                    <td key={`${row.category}-p`} className={numberCellClass}>
                      {formatPercent(row.precision)}
                    </td>,
                    <td key={`${row.category}-r`} className={numberCellClass}>
                      {formatPercent(row.recall)}
                    </td>,
                  ])}
                </tr>
              ))}
            </DataTable>
          )}
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
            description="Todas las decisiones con LLM del periodo (no se filtra por categoría; no cuentan las degradadas por un fallo técnico). Acierto: mismas categorías que el equipo en todo lo que se puede comparar, sobre las decisiones ya contrastadas."
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
