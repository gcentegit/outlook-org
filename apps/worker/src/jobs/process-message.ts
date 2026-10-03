import type { DecisionMode, ExtractedEmail } from '@clasificador/shared';

import type { ClassifyResult } from '../classify';
import { GraphError } from '../graph/client';

export interface SaveDecisionOptions {
  /** Motivo del fallo técnico si la decisión es degradada; null si es una decisión válida. */
  degradedReason: string | null;
}

export interface DecisionStore {
  /** ¿Ya hay una decisión válida (no degradada) de este modo para el correo? Hace idempotente el trabajo. */
  hasDecision(messageId: string, mode: DecisionMode): Promise<boolean>;
  /**
   * Guarda la decisión y deja el correo como procesado, de forma atómica. Una decisión degradada
   * marca el correo para reprocesar; una válida lo desmarca.
   */
  saveDecision(
    email: ExtractedEmail,
    result: ClassifyResult,
    options: SaveDecisionOptions,
  ): Promise<void>;
  /** El trabajo agotó los reintentos sin decisión: el correo queda fallido y marcado para reprocesar. */
  markFailed(messageId: string): Promise<void>;
  /** El correo ya no está en el buzón: se olvida si nunca llegó a decidirse. */
  forget(messageId: string): Promise<void>;
}

export interface ProcessMessageDeps {
  mode: DecisionMode;
  store: DecisionStore;
  extract: (messageId: string) => Promise<ExtractedEmail>;
  availableCategories: () => Promise<string[]>;
  classify: (email: ExtractedEmail, availableCategories: string[]) => Promise<ClassifyResult>;
  log?: (message: string) => void;
}

export interface ProcessAttempt {
  /** Es el último intento: ya no habrá reintento de pg-boss. */
  isLast: boolean;
}

export type ProcessOutcome = 'processed' | 'degraded' | 'already-decided' | 'gone';

/** La decisión salió con un fallo técnico que puede arreglarse solo: el trabajo se reintenta. */
export class DegradedDecisionError extends Error {
  override name = 'DegradedDecisionError';
  constructor(readonly reasons: string[]) {
    super(`decisión degradada por un fallo técnico: ${reasons.join('; ')}`);
  }
}

/** Correos en curso: evita que un mismo mensaje se procese dos veces a la vez dentro del proceso. */
const inFlight = new Set<string>();

/**
 * Extrae, clasifica y guarda la decisión de un correo. Idempotente por `messageId`: si ya hay
 * una decisión válida del mismo modo no hace nada. Un correo que ya no existe en el buzón (404)
 * se da por terminado.
 *
 * Distingue una decisión válida de una degradada por un fallo técnico (docling caído, LLM fallido
 * o sin modelo disponible):
 * - fallo pasajero y quedan reintentos: lanza `DegradedDecisionError` sin guardar nada, para que
 *   pg-boss reintente con retroceso;
 * - último intento o fallo que no se arregla solo: guarda la decisión degradada y marca el correo
 *   para reprocesar (el panel y `pnpm reprocess` lo vuelven a encolar).
 * Cualquier otro error se propaga; si era el último intento el correo queda fallido.
 */
export async function processMessage(
  messageId: string,
  deps: ProcessMessageDeps,
  attempt: ProcessAttempt = { isLast: true },
): Promise<ProcessOutcome> {
  const log = deps.log ?? console.log;
  if (inFlight.has(messageId)) return 'already-decided';
  inFlight.add(messageId);
  try {
    if (await deps.store.hasDecision(messageId, deps.mode)) return 'already-decided';

    let email: ExtractedEmail;
    try {
      email = await deps.extract(messageId);
    } catch (err) {
      if (err instanceof GraphError && err.status === 404) {
        log(`el correo ${messageId} ya no está en el buzón; se omite`);
        await deps.store.forget(messageId);
        return 'gone';
      }
      throw err;
    }

    const result = await deps.classify(email, await deps.availableCategories());
    const extractionIssues = email.degradedReasons ?? [];
    const reasons = [...extractionIssues, ...(result.degraded ? [result.degraded.reason] : [])];
    const retryable = extractionIssues.length > 0 || (result.degraded?.transient ?? false);
    if (reasons.length > 0 && retryable && !attempt.isLast) {
      throw new DegradedDecisionError(reasons);
    }
    await deps.store.saveDecision(email, result, {
      degradedReason: reasons.length > 0 ? reasons.join('; ') : null,
    });
    if (reasons.length > 0) {
      log(
        `correo ${messageId} decidido con fallo técnico, queda para reprocesar: ${reasons.join('; ')}`,
      );
      return 'degraded';
    }
    return 'processed';
  } catch (err) {
    if (attempt.isLast) {
      await deps.store
        .markFailed(messageId)
        .catch((markErr: unknown) =>
          log(`no se pudo marcar ${messageId} como fallido: ${String(markErr)}`),
        );
    }
    throw err;
  } finally {
    inFlight.delete(messageId);
  }
}
