import type { DecisionMode, ExtractedEmail } from '@clasificador/shared';

import type { ClassifyResult } from '../classify';
import { GraphError } from '../graph/client';

export interface SaveDecisionOptions {
  /** Motivo del fallo técnico si la decisión es degradada; null si es una decisión válida. */
  degradedReason: string | null;
}

export interface DecisionStore {
  /**
   * ¿Ya hay una decisión válida (no degradada) de este modo para el correo? Hace idempotente el
   * trabajo. Un correo marcado para reprocesar cuenta como no decidido aunque tenga una válida: así
   * se puede volver a decidir tras corregir una regla.
   */
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
  /**
   * El correo ya no se encuentra por su id (borrado, o archivado: moverlo cambia el id). Se olvida
   * si nunca llegó a decidirse; si ya tiene decisión, la conserva y deja de estar en cola y marcado.
   */
  forget(messageId: string): Promise<void>;
  /** No se pudieron escribir las categorías en el buzón: el correo queda marcado para reprocesar. */
  markApplyFailed(messageId: string): Promise<void>;
  /** Conversación y fecha de recepción guardadas, para buscarlo si cambió de id. Null si no hay. */
  findLocator(messageId: string): Promise<MessageLocator | null>;
}

/** Lo que no cambia al mover un correo: con ello se encuentra su id actual. */
export interface MessageLocator {
  id: string;
  conversationId: string;
  receivedAt: Date;
}

export interface ProcessMessageDeps {
  mode: DecisionMode;
  store: DecisionStore;
  extract: (messageId: string) => Promise<ExtractedEmail>;
  /**
   * Id actual de un correo que dio 404 por su id (archivado: moverlo cambia el id), o null si ya no
   * está en el buzón. Sin ella, un correo movido se da por desaparecido.
   */
  relocate?: (message: MessageLocator) => Promise<string | null>;
  availableCategories: () => Promise<string[]>;
  classify: (email: ExtractedEmail, availableCategories: string[]) => Promise<ClassifyResult>;
  /**
   * Escribe en el buzón las categorías de una decisión válida (solo en modo real; en sombra no se
   * pasa). Recibe la lista maestra con la que se clasificó.
   */
  apply?: (email: ExtractedEmail, result: ClassifyResult, masterNames: string[]) => Promise<void>;
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
 * una decisión válida del mismo modo no hace nada. Un correo que sigue sin existir en el buzón (404)
 * en el último intento se da por terminado.
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

    // `mailboxEmail` lleva el id con el que está hoy en el buzón (para escribir en él); `email`, el
    // id con el que lo conocemos, que es al que se asocia la decisión.
    const mailboxEmail = await extractOrRelocate(messageId, deps, log);
    if (!mailboxEmail) {
      // Un 404 puede ser pasajero (réplica de Exchange atrasada): solo el último intento lo da por
      // desaparecido, para no dejar como definitiva una decisión que había que repetir.
      if (!attempt.isLast)
        throw new GraphError(`el correo ${messageId} no aparece en el buzón`, 404);
      log(`el correo ${messageId} ya no está en el buzón; se omite`);
      await deps.store.forget(messageId);
      return 'gone';
    }
    const email: ExtractedEmail = { ...mailboxEmail, messageId };

    const masterNames = await deps.availableCategories();
    const result = await deps.classify(email, masterNames);
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
    if (deps.apply) {
      // La decisión ya está guardada: un fallo al escribir no la pierde. El correo queda marcado
      // y «Reprocesar» lo vuelve a decidir y a escribir (escribir es idempotente).
      try {
        await deps.apply(mailboxEmail, result, masterNames);
      } catch (err) {
        log(`no se pudieron escribir las categorías de ${messageId}: ${String(err)}`);
        await deps.store
          .markApplyFailed(messageId)
          .catch((markErr: unknown) =>
            log(`no se pudo marcar ${messageId} para reprocesar: ${String(markErr)}`),
          );
      }
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

const isNotFound = (err: unknown): boolean => err instanceof GraphError && err.status === 404;

/**
 * Lee el correo por su id y, si da 404, lo busca por su conversación y su fecha de recepción: así
 * un correo que el equipo ya archivó se puede volver a decidir. Null si ya no está en el buzón.
 */
async function extractOrRelocate(
  messageId: string,
  deps: ProcessMessageDeps,
  log: (message: string) => void,
): Promise<ExtractedEmail | null> {
  try {
    return await deps.extract(messageId);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  if (!deps.relocate) return null;
  const locator = await deps.store.findLocator(messageId);
  if (!locator) return null;
  const currentId = await deps.relocate(locator);
  if (!currentId || currentId === messageId) return null;
  log(`el correo ${messageId} cambió de id al moverlo; se lee con el actual`);
  try {
    return await deps.extract(currentId);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}
