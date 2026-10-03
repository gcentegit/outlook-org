import { CATEGORIES, canonicalCategory, type DecisionMode } from '@clasificador/shared';

/** Lo que se sabe de un correo ya registrado: sus categorías vistas y su última decisión y corrección. */
export interface KnownMessage {
  id: string;
  /** Categorías que tenía en Outlook la última vez que se leyó (todas, no solo las tres). */
  seenCategories: string[];
  latestDecision: { id: string; categories: string[]; mode: DecisionMode } | null;
  latestCorrection: { decisionId: string | null; final: string[] } | null;
}

export type CategoryChange =
  /** Las categorías no han cambiado desde la última lectura. */
  | { kind: 'unchanged' }
  /** Cambió algo, pero no hay corrección que registrar: solo se actualiza lo visto. */
  | { kind: 'seen-only' }
  | { kind: 'correction'; decisionId: string; proposed: string[]; final: string[] };

/** Solo FOOD BOX, LATERAL y ARCOBETA, con su nombre canónico y ordenadas. */
export function relevantCategories(names: readonly string[]): string[] {
  const found = new Set<string>();
  for (const name of names) {
    const canonical = canonicalCategory(name);
    if (canonical) found.add(canonical);
  }
  return CATEGORIES.filter((c) => found.has(c));
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Decide qué hacer cuando Outlook informa de un cambio en un correo ya registrado.
 *
 * - En modo sombra el servicio nunca toca el buzón, así que todo cambio es del equipo.
 * - En modo live, un cambio que solo añade lo decidido por el servicio (sobre lo que ya había)
 *   es propio y se ignora; cualquier otro es del equipo.
 * - Si el equipo vuelve a dejar lo propuesto después de haberlo corregido, también se registra
 *   (con `proposed` igual a `final`), para que la última corrección de cada correo sea la vigente.
 */
export function evaluateCategoryChange(
  known: KnownMessage,
  observedCategories: readonly string[],
): CategoryChange {
  const seen = relevantCategories(known.seenCategories);
  const observed = relevantCategories(observedCategories);
  const fullySame =
    known.seenCategories.length === observedCategories.length &&
    known.seenCategories.every((c) => observedCategories.includes(c));
  if (fullySame) return { kind: 'unchanged' };
  if (sameSet(seen, observed)) return { kind: 'seen-only' };

  const decision = known.latestDecision;
  if (!decision) return { kind: 'seen-only' };
  const proposed = relevantCategories(decision.categories);

  if (decision.mode === 'live') {
    const appliedByUs =
      proposed.every((c) => observed.includes(c)) &&
      observed.every((c) => seen.includes(c) || proposed.includes(c));
    if (appliedByUs) return { kind: 'seen-only' };
  }

  const previous = known.latestCorrection;
  const previousForThisDecision = previous?.decisionId === decision.id ? previous : null;
  if (sameSet(observed, proposed)) {
    // De acuerdo con la propuesta: solo interesa si antes se había registrado una discrepancia.
    return previousForThisDecision && !sameSet(previousForThisDecision.final, observed)
      ? { kind: 'correction', decisionId: decision.id, proposed, final: observed }
      : { kind: 'seen-only' };
  }
  if (previousForThisDecision && sameSet(previousForThisDecision.final, observed)) {
    return { kind: 'seen-only' };
  }
  return { kind: 'correction', decisionId: decision.id, proposed, final: observed };
}
