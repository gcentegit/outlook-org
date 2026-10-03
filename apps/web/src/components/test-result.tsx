import type { TestClassifyResult } from '@clasificador/shared';

import { formatInt, formatLatency, formatPercent, formatUsd, NOT_AVAILABLE } from '@/lib/format';

import { Notice } from './ui';

/** Resultado de «Probar»: decisión del modelo, tokens, coste y latencia, o el motivo del fallo. */
export function TestResultView({ result }: { result: TestClassifyResult }) {
  if (result.status !== 'ok' || !result.decision) {
    return (
      <Notice
        tone="error"
        title={
          result.status === 'unavailable' ? 'Proveedor no disponible' : 'La llamada al modelo falló'
        }
      >
        {result.message ?? 'Sin detalle.'}
        {result.latencyMs !== null && (
          <span className="block text-xs">Tardó {formatLatency(result.latencyMs)}.</span>
        )}
      </Notice>
    );
  }
  const { decision, usage } = result;
  return (
    <Notice tone="success" title="Prueba correcta">
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="font-medium">Categorías propuestas</dt>
        <dd>{decision.categories.length > 0 ? decision.categories.join(', ') : 'ninguna'}</dd>
        <dt className="font-medium">Confianza mínima</dt>
        <dd>{formatPercent(decision.confidence)}</dd>
        <dt className="font-medium">Necesita revisión</dt>
        <dd>{decision.needsReview ? 'sí' : 'no'}</dd>
        <dt className="font-medium">Tokens (entrada / salida)</dt>
        <dd>
          {usage?.inputTokens != null ? formatInt(usage.inputTokens) : NOT_AVAILABLE} /{' '}
          {usage?.outputTokens != null ? formatInt(usage.outputTokens) : NOT_AVAILABLE}
        </dd>
        <dt className="font-medium">Coste estimado</dt>
        <dd>{usage?.costUsd != null ? formatUsd(usage.costUsd) : NOT_AVAILABLE}</dd>
        <dt className="font-medium">Latencia</dt>
        <dd>{formatLatency(result.latencyMs)}</dd>
      </dl>
      <p className="mt-2 text-sm">
        <span className="font-medium">Motivo:</span> {decision.reason}
      </p>
    </Notice>
  );
}
