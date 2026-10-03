import { describe, expect, it } from 'vitest';

import { evaluateCategoryChange, relevantCategories, type KnownMessage } from './corrections';

function known(over: Partial<KnownMessage> = {}): KnownMessage {
  return {
    id: 'm1',
    seenCategories: [],
    latestDecision: { id: 'd1', categories: ['LATERAL'], mode: 'shadow' },
    latestCorrection: null,
    ...over,
  };
}

describe('relevantCategories', () => {
  it('se queda con las tres categorías, canónicas y en orden', () => {
    expect(relevantCategories(['pagado', 'arcobeta', 'Food Box', 'lateral'])).toEqual([
      'FOOD BOX',
      'LATERAL',
      'ARCOBETA',
    ]);
  });
});

describe('evaluateCategoryChange', () => {
  it('no hace nada si las categorías no cambian, aunque cambie el orden', () => {
    const k = known({ seenCategories: ['A', 'LATERAL'] });
    expect(evaluateCategoryChange(k, ['LATERAL', 'A'])).toEqual({ kind: 'unchanged' });
  });

  it('solo actualiza lo visto si cambia una categoría ajena a las tres', () => {
    expect(evaluateCategoryChange(known({ seenCategories: [] }), ['Pagado'])).toEqual({
      kind: 'seen-only',
    });
  });

  it('registra como corrección la categoría que difiere de la decisión', () => {
    expect(evaluateCategoryChange(known(), ['FOOD BOX'])).toEqual({
      kind: 'correction',
      decisionId: 'd1',
      proposed: ['LATERAL'],
      final: ['FOOD BOX'],
    });
  });

  it('registra la corrección cuando el equipo quita lo propuesto', () => {
    const k = known({ seenCategories: ['LATERAL'] });
    expect(evaluateCategoryChange(k, [])).toMatchObject({
      kind: 'correction',
      proposed: ['LATERAL'],
      final: [],
    });
  });

  it('no registra nada si el equipo coincide con la propuesta', () => {
    expect(evaluateCategoryChange(known(), ['lateral'])).toEqual({ kind: 'seen-only' });
  });

  it('registra la vuelta a lo propuesto si antes había una corrección distinta', () => {
    const k = known({
      seenCategories: ['FOOD BOX'],
      latestCorrection: { decisionId: 'd1', final: ['FOOD BOX'] },
    });
    expect(evaluateCategoryChange(k, ['LATERAL'])).toEqual({
      kind: 'correction',
      decisionId: 'd1',
      proposed: ['LATERAL'],
      final: ['LATERAL'],
    });
  });

  it('no duplica una corrección ya registrada con el mismo resultado final', () => {
    const k = known({
      seenCategories: [],
      latestCorrection: { decisionId: 'd1', final: ['FOOD BOX'] },
    });
    expect(evaluateCategoryChange(k, ['FOOD BOX'])).toEqual({ kind: 'seen-only' });
  });

  it('sin decisión no hay con qué comparar', () => {
    expect(evaluateCategoryChange(known({ latestDecision: null }), ['FOOD BOX'])).toEqual({
      kind: 'seen-only',
    });
  });

  it('en modo live ignora el cambio que solo añade lo decidido por el servicio', () => {
    const k = known({
      seenCategories: ['ARCOBETA'],
      latestDecision: { id: 'd1', categories: ['LATERAL'], mode: 'live' },
    });
    expect(evaluateCategoryChange(k, ['ARCOBETA', 'LATERAL'])).toEqual({ kind: 'seen-only' });
  });

  it('en modo live un cambio distinto de lo aplicado es del equipo', () => {
    const k = known({
      seenCategories: ['LATERAL'],
      latestDecision: { id: 'd1', categories: ['LATERAL'], mode: 'live' },
    });
    expect(evaluateCategoryChange(k, ['FOOD BOX'])).toMatchObject({
      kind: 'correction',
      final: ['FOOD BOX'],
    });
  });

  it('en modo sombra todo cambio es del equipo aunque incluya lo propuesto', () => {
    const k = known({ seenCategories: [] });
    expect(evaluateCategoryChange(k, ['LATERAL', 'FOOD BOX'])).toMatchObject({
      kind: 'correction',
      final: ['FOOD BOX', 'LATERAL'],
    });
  });
});
