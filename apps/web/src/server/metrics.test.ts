import { describe, expect, it, vi } from 'vitest';

import {
  classifySync,
  getServiceStatus,
  computeMetrics,
  evaluateMessages,
  countStates,
  listDiscrepancies,
  listMessages,
  loadLatencyByModel,
  appliedReasons,
  paginate,
  reprocessCause,
  type LoadedDecision,
  type LoadedMessage,
  weekOf,
} from './metrics';

let counter = 0;

function decision(over: Partial<LoadedDecision> & { source?: string } = {}): LoadedDecision {
  const { source = 'rule', ...rest } = over;
  const categories = rest.categories ?? [];
  return {
    id: `d${++counter}`,
    categories,
    model: null,
    costUsd: null,
    createdAt: new Date('2026-09-10T10:00:00Z'),
    mode: 'shadow',
    degraded: false,
    decision: {
      source,
      reason: 'motivo',
      confidence: 0.9,
      needsReview: categories.length === 0,
    },
    ...rest,
  };
}

function message(over: Partial<LoadedMessage> = {}): LoadedMessage {
  return {
    id: `m${++counter}`,
    receivedAt: new Date('2026-09-10T08:00:00Z'),
    sender: 'prov@example.com',
    subject: 'Factura',
    status: 'processed',
    seenCategories: [],
    folder: null,
    folderPath: null,
    decisions: [],
    corrections: [],
    appliedCategories: [],
    ...over,
  };
}

const NO_LATENCY = new Map<string, number>();

describe('evaluateMessages', () => {
  it('toma la decisión más reciente y las categorías vistas del equipo', () => {
    const [item] = evaluateMessages([
      message({
        seenCategories: ['Food Box', 'RESPONSABLE JUAN'],
        decisions: [
          decision({ categories: ['LATERAL'], createdAt: new Date('2026-09-10T09:00:00Z') }),
          decision({ categories: ['FOOD BOX'], createdAt: new Date('2026-09-11T09:00:00Z') }),
        ],
      }),
    ]);
    expect(item?.decision?.proposed).toEqual(['FOOD BOX']);
    // Solo cuentan las tres categorías del clasificador y se normaliza el nombre.
    expect(item?.team).toEqual(['FOOD BOX']);
  });

  it('la última corrección manda sobre las categorías vistas', () => {
    const [item] = evaluateMessages([
      message({
        seenCategories: ['FOOD BOX', 'LATERAL'],
        corrections: [{ final: ['ARCOBETA'], createdAt: new Date('2026-09-12T00:00:00Z') }],
        decisions: [decision({ categories: ['FOOD BOX'] })],
      }),
    ]);
    expect(item?.team).toEqual(['ARCOBETA']);
  });

  it('un correo está revisado si tiene alguna categoría en Outlook (aunque no sea de las tres) o una corrección', () => {
    const [none, other, corrected, team] = evaluateMessages([
      message(),
      message({ seenCategories: ['RESPONSABLE JUAN'] }),
      message({ corrections: [{ final: [], createdAt: new Date('2026-09-12T00:00:00Z') }] }),
      message({ seenCategories: ['LATERAL'] }),
    ]);
    expect(none?.reviewed).toBe(false);
    expect(other?.reviewed).toBe(true);
    expect(corrected?.reviewed).toBe(true);
    expect(team?.reviewed).toBe(true);
  });

  it('un correo sin decisión queda con decision null', () => {
    expect(evaluateMessages([message()])[0]?.decision).toBeNull();
  });

  it('un JSON de decisión inválido se trata como origen none', () => {
    const [item] = evaluateMessages([
      message({ decisions: [decision({ categories: [], decision: 'basura' })] }),
    ]);
    expect(item?.decision?.source).toBe('none');
  });
});

describe('computeMetrics', () => {
  const messages: LoadedMessage[] = [
    // Acierto: propone FOOD BOX y el equipo también.
    message({
      seenCategories: ['FOOD BOX'],
      decisions: [decision({ categories: ['FOOD BOX'], source: 'rule' })],
    }),
    // Falso positivo de LATERAL (el equipo no la puso) y falso negativo de ARCOBETA.
    message({
      seenCategories: ['ARCOBETA'],
      decisions: [
        decision({
          categories: ['LATERAL'],
          source: 'llm',
          model: 'haiku',
          costUsd: 0.002,
        }),
      ],
    }),
    // Dudoso, el equipo puso LATERAL (falso negativo).
    message({
      seenCategories: ['LATERAL'],
      decisions: [decision({ categories: [], source: 'none' })],
    }),
    // Hereda del hilo y coincide.
    message({
      seenCategories: ['LATERAL'],
      decisions: [
        decision({ categories: ['LATERAL'], source: 'thread' }),
        decision({
          categories: ['LATERAL'],
          source: 'thread',
          model: 'haiku',
          costUsd: 0.004,
          createdAt: new Date('2026-09-09T00:00:00Z'),
        }),
      ],
    }),
    // Sin decisión todavía.
    message(),
    // Decidido pero el equipo aún no lo ha revisado: no suma como acierto ni como fallo.
    message({
      decisions: [
        decision({ categories: ['FOOD BOX'], source: 'llm', model: 'haiku', costUsd: 0.001 }),
      ],
    }),
  ];

  const metrics = computeMetrics(messages, new Map([['haiku', 850]]), null);

  it('calcula leídos, clasificados, dudosos, pendientes, pendientes de revisar y cobertura', () => {
    expect(metrics.summary).toEqual({
      read: 6,
      classified: 4,
      doubtful: 1,
      pending: 1,
      awaitingReview: 1,
      coverage: 4 / 5,
      deleted: 0,
      deletedUnclassified: 0,
    });
  });

  it('un correo sin revisar no suma ni como acierto ni como fallo', () => {
    const byCategory = Object.fromEntries(metrics.perCategory.map((c) => [c.category, c]));
    // La decisión sin revisar propone FOOD BOX: si contara, serían 2 aciertos o 1 falso positivo.
    expect(byCategory['FOOD BOX']).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    const cells = metrics.perCategory.reduce((n, c) => n + c.tp + c.fp + c.fn + c.tn, 0);
    // 4 correos revisados con decisión × 3 categorías.
    expect(cells).toBe(12);
  });

  it('calcula precisión y cobertura por categoría frente al equipo', () => {
    const byCategory = Object.fromEntries(metrics.perCategory.map((c) => [c.category, c]));
    expect(byCategory['FOOD BOX']).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
    // LATERAL: aciertos en el 4.º correo; falso positivo en el 2.º; falso negativo en el 3.º.
    expect(byCategory['LATERAL']).toMatchObject({
      tp: 1,
      fp: 1,
      fn: 1,
      precision: 0.5,
      recall: 0.5,
    });
    expect(byCategory['ARCOBETA']).toMatchObject({
      tp: 0,
      fp: 0,
      fn: 1,
      precision: null,
      recall: 0,
    });
  });

  it('cuenta el origen de la decisión vigente', () => {
    expect(metrics.origin).toEqual({ thread: 1, rule: 1, llm: 2, none: 1 });
  });

  it('agrega por modelo: decisiones, solo las revisadas para el acierto, coste y latencia', () => {
    expect(metrics.perModel).toEqual([
      {
        model: 'haiku',
        decisions: 3,
        reviewed: 2,
        // El 2.º correo falla (LATERAL frente a ARCOBETA); el 4.º coincide; el 6.º no está revisado.
        correct: 1,
        accuracy: 0.5,
        costUsd: 0.007,
        avgLatencyMs: 850,
      },
    ]);
  });

  it('las decisiones degradadas no cuentan ni en el acierto ni por modelo', () => {
    const degraded = computeMetrics(
      [
        message({
          seenCategories: ['LATERAL'],
          decisions: [decision({ categories: [], source: 'llm', model: 'haiku', degraded: true })],
        }),
      ],
      NO_LATENCY,
      null,
    );
    expect(degraded.perModel).toEqual([]);
    expect(degraded.summary).toMatchObject({
      read: 1,
      classified: 0,
      doubtful: 0,
      awaitingReview: 0,
    });
    expect(degraded.perCategory.every((c) => c.tp + c.fp + c.fn + c.tn === 0)).toBe(true);
  });

  it('los correos eliminados por el equipo se cuentan aparte y no entran en el acierto', () => {
    const deleted = computeMetrics(
      [
        // Publicidad que el equipo borró sin mirar: sin categoría propuesta.
        message({
          folder: 'missing',
          decisions: [decision({ categories: [], source: 'none', degraded: true })],
        }),
        // Tenía categoría del equipo antes de borrarlo: tampoco se compara.
        message({
          folder: 'missing',
          seenCategories: ['LATERAL'],
          decisions: [decision({ categories: ['FOOD BOX'], source: 'llm', model: 'haiku' })],
        }),
        message({
          folder: 'lateral',
          decisions: [decision({ categories: ['LATERAL'], source: 'rule' })],
        }),
      ],
      NO_LATENCY,
      null,
    );
    expect(deleted.summary).toEqual({
      read: 3,
      classified: 1,
      doubtful: 0,
      pending: 0,
      awaitingReview: 0,
      coverage: 1,
      deleted: 2,
      deletedUnclassified: 1,
    });
    const by = Object.fromEntries(deleted.perCategory.map((row) => [row.category, row]));
    expect(by['FOOD BOX']).toMatchObject({ tp: 0, fp: 0, fn: 0, tn: 1 });
    expect(by.LATERAL).toMatchObject({ tp: 1, fp: 0, fn: 0, tn: 0 });
    expect(deleted.origin).toEqual({ thread: 0, rule: 1, llm: 0, none: 0 });
    expect(deleted.perModel).toEqual([
      expect.objectContaining({ model: 'haiku', decisions: 1, reviewed: 0, accuracy: null }),
    ]);
  });

  it('sin latencia registrada la deja en null', () => {
    expect(computeMetrics(messages, NO_LATENCY, null).perModel[0]?.avgLatencyMs).toBeNull();
  });

  it('el filtro de categoría limita clasificados, tabla y origen a esa categoría', () => {
    const filtered = computeMetrics(messages, NO_LATENCY, 'LATERAL');
    expect(filtered.perCategory.map((c) => c.category)).toEqual(['LATERAL']);
    expect(filtered.summary.classified).toBe(2);
    expect(filtered.summary.awaitingReview).toBe(0);
    expect(filtered.origin).toEqual({ thread: 1, rule: 0, llm: 1, none: 0 });
  });

  it('sin datos no divide por cero', () => {
    const empty = computeMetrics([], NO_LATENCY, null);
    expect(empty.summary.coverage).toBeNull();
    expect(empty.perCategory.every((c) => c.precision === null && c.recall === null)).toBe(true);
    expect(empty.perModel).toEqual([]);
  });
});

describe('verdad por carpeta', () => {
  const lateral = (categories: string[], over: Partial<LoadedMessage> = {}) =>
    message({ folder: 'lateral', decisions: [decision({ categories })], ...over });

  it('un correo archivado en el árbol de una sociedad cuenta como revisado con esa categoría', () => {
    const [item] = evaluateMessages([lateral(['LATERAL'])]);
    expect(item).toMatchObject({ team: ['LATERAL'], reviewed: true });
    expect(item?.compared).toEqual(['FOOD BOX', 'LATERAL']);
  });

  it('en la Bandeja, en otra carpeta o sin comprobar no hay con qué comparar', () => {
    for (const folder of ['inbox', 'other', 'missing', null] as const) {
      const [item] = evaluateMessages([message({ folder })]);
      expect(item).toMatchObject({ team: [], compared: [], reviewed: false });
    }
  });

  it('un correo eliminado no se compara aunque tuviera categorías del equipo', () => {
    const [item] = evaluateMessages([message({ folder: 'missing', seenCategories: ['LATERAL'] })]);
    expect(item).toMatchObject({ compared: [], reviewed: false, deleted: true });
  });

  it('con solo la carpeta, ARCOBETA no se compara; con categorías del equipo, sí', () => {
    const metrics = computeMetrics(
      [
        lateral(['LATERAL']),
        lateral(['FOOD BOX']),
        lateral(['ARCOBETA'], { seenCategories: ['ARCOBETA'] }),
      ],
      NO_LATENCY,
      null,
    );
    const by = Object.fromEntries(metrics.perCategory.map((row) => [row.category, row]));
    expect(by.LATERAL).toMatchObject({ tp: 1, fn: 1, tn: 1 });
    expect(by['FOOD BOX']).toMatchObject({ fp: 1, tn: 2 });
    // Solo el tercero, con la etiqueta del equipo, dice algo de ARCOBETA.
    expect(by.ARCOBETA).toMatchObject({ tp: 1, fp: 0, fn: 0, tn: 0 });
  });

  it('en el árbol Lateral, un correo de ARCOBETA no cuenta como fallo de LATERAL', () => {
    const [proposedArcobeta] = evaluateMessages([lateral(['ARCOBETA'])]);
    expect(proposedArcobeta).toMatchObject({ team: [], compared: ['FOOD BOX'], reviewed: true });
    const [labelledArcobeta] = evaluateMessages([
      lateral(['FOOD BOX'], { seenCategories: ['ARCOBETA'] }),
    ]);
    expect(labelledArcobeta?.team).toEqual(['ARCOBETA']);
    // Si el equipo quitó las categorías sin decir cuál de las dos, tampoco se comparan.
    const [emptyCorrection] = evaluateMessages([
      lateral(['ARCOBETA'], {
        corrections: [{ final: [], createdAt: new Date('2026-09-12T00:00:00Z') }],
      }),
    ]);
    expect(emptyCorrection?.compared).toEqual(['FOOD BOX']);
    // Quien archiva ARCOBETA en Lateral le pone a veces la etiqueta LATERAL por comodidad: tampoco
    // desmiente la propuesta de ARCOBETA.
    const [labelledLateral] = evaluateMessages([
      lateral(['ARCOBETA'], { seenCategories: ['LATERAL'] }),
    ]);
    expect(labelledLateral).toMatchObject({ compared: ['FOOD BOX'], reviewed: true });
  });

  it('sin etiqueta del equipo, la carpeta no desmiente lo que se propuso por CIF', () => {
    const byCif = (reason: string) =>
      message({
        folder: 'lateral',
        decisions: [
          decision({
            categories: ['FOOD BOX'],
            decision: { source: 'rule', reason, confidence: 1, needsReview: false },
          }),
        ],
      });
    const [cif] = evaluateMessages([byCif('FOOD BOX por CIF A87240420; LATERAL descartada(s)')]);
    expect(cif).toMatchObject({ team: ['FOOD BOX'], compared: ['FOOD BOX', 'LATERAL'] });
    // Tampoco una categoría ajena al grupo en la Bandeja.
    const [inbox] = evaluateMessages([
      { ...byCif('FOOD BOX por CIF A87240420'), folder: 'inbox', seenCategories: ['Pagado'] },
    ]);
    expect(inbox).toMatchObject({ team: ['FOOD BOX'], reviewed: true });
    // Por la razón social sola, la carpeta sigue siendo la verdad.
    const [name] = evaluateMessages([byCif('FOOD BOX por razón social «FOODBOX, S.A.»')]);
    expect(name?.team).toEqual(['LATERAL']);
    // Una etiqueta del equipo sí cuenta.
    const [labelled] = evaluateMessages([lateral(['FOOD BOX'], { seenCategories: ['LATERAL'] })]);
    expect(labelled?.team).toEqual(['LATERAL']);
  });

  it('una categoría ajena al grupo no hace comparar ARCOBETA en un correo archivado', () => {
    const [item] = evaluateMessages([
      message({
        folder: 'foodbox',
        seenCategories: ['Pagado'],
        decisions: [decision({ categories: ['FOOD BOX', 'ARCOBETA'] })],
      }),
    ]);
    expect(item?.compared).toEqual(['FOOD BOX', 'LATERAL']);
    // Sin carpeta, una categoría ajena sigue contando como «revisado y ninguna de las tres».
    const [unfiled] = evaluateMessages([message({ seenCategories: ['Pagado'] })]);
    expect(unfiled?.compared).toEqual(['FOOD BOX', 'LATERAL', 'ARCOBETA']);
  });

  it('por modelo y en discrepancias solo cuentan las categorías comparables', () => {
    const agrees = lateral(['LATERAL', 'ARCOBETA']);
    const differs = lateral(['FOOD BOX']);
    expect(listDiscrepancies([agrees, differs], null).map((d) => d.id)).toEqual([differs.id]);
    expect(listDiscrepancies([agrees], 'ARCOBETA')).toEqual([]);
  });

  it('separa lo que puso una persona de lo que se deduce para la referencia', () => {
    const at = new Date('2026-09-12T00:00:00Z');
    const byCif = message({
      decisions: [
        decision({
          categories: ['LATERAL'],
          decision: { source: 'rule', reason: 'LATERAL por CIF B12345678', confidence: 1 },
        }),
      ],
    });
    const [cif, folder, outlook, mixed, service, removed, nothing] = evaluateMessages([
      byCif,
      message({ folder: 'lateral' }),
      message({ seenCategories: ['FOOD BOX'] }),
      message({ folder: 'foodbox', seenCategories: ['LATERAL'] }),
      message({ seenCategories: ['LATERAL', 'FOOD BOX'], appliedCategories: ['LATERAL'] }),
      message({ seenCategories: ['FOOD BOX'], corrections: [{ final: [], createdAt: at }] }),
      message(),
    ]);
    expect(cif).toMatchObject({ team: ['LATERAL'], teamSources: ['cif'], byPeople: [] });
    expect(folder).toMatchObject({ team: ['LATERAL'], teamSources: ['folder'], byPeople: [] });
    expect(outlook).toMatchObject({ teamSources: ['people'], byPeople: ['FOOD BOX'] });
    expect(mixed).toMatchObject({ teamSources: ['people', 'folder'], byPeople: ['LATERAL'] });
    // En modo real, lo que escribió el servicio no cuenta como del equipo.
    expect(service).toMatchObject({
      team: ['FOOD BOX', 'LATERAL'],
      teamSources: ['people', 'service'],
      byPeople: ['FOOD BOX'],
    });
    expect(removed).toMatchObject({ team: [], byPeople: [], changedByTeam: true });
    expect(nothing).toMatchObject({ team: [], teamSources: [], changedByTeam: false });
  });

  it('las categorías puestas en la carpeta se suman a la de la carpeta', () => {
    const [item] = evaluateMessages([message({ folder: 'foodbox', seenCategories: ['LATERAL'] })]);
    expect(item?.team).toEqual(['FOOD BOX', 'LATERAL']);
    expect(item?.compared).toEqual(['FOOD BOX', 'LATERAL', 'ARCOBETA']);
  });
});

describe('evolución por semana', () => {
  it('weekOf da el lunes de la semana en hora de Madrid', () => {
    expect(weekOf(new Date('2026-10-13T10:00:00Z'))).toBe('2026-10-12');
    expect(weekOf(new Date('2026-10-12T00:30:00+02:00'))).toBe('2026-10-12');
    // El domingo a las 23:30 de Madrid es aún esa semana; a las 00:30 del lunes ya es la siguiente.
    expect(weekOf(new Date('2026-10-18T21:30:00Z'))).toBe('2026-10-12');
    expect(weekOf(new Date('2026-10-18T22:30:00Z'))).toBe('2026-10-19');
  });

  it('agrupa los revisados por semana de recepción, la más reciente primero', () => {
    const metrics = computeMetrics(
      [
        message({
          folder: 'foodbox',
          receivedAt: new Date('2026-10-06T09:00:00Z'),
          decisions: [decision({ categories: ['FOOD BOX'] })],
        }),
        message({
          folder: 'foodbox',
          receivedAt: new Date('2026-10-13T09:00:00Z'),
          decisions: [decision({ categories: ['LATERAL'] })],
        }),
        message({
          folder: 'inbox',
          receivedAt: new Date('2026-10-13T10:00:00Z'),
          decisions: [decision({ categories: ['LATERAL'] })],
        }),
      ],
      NO_LATENCY,
      'FOOD BOX',
    );
    expect(metrics.perWeek.map((w) => [w.week, w.reviewed])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-05', 1],
    ]);
    expect(metrics.perWeek[0]?.perCategory).toMatchObject([
      { category: 'FOOD BOX', tp: 0, fn: 1, recall: 0 },
    ]);
    expect(metrics.perWeek[1]?.perCategory[0]).toMatchObject({ precision: 1, recall: 1 });
  });

  it('con filtro de categoría, «contrastados» solo cuenta los que se pueden comparar en ella', () => {
    const metrics = computeMetrics(
      [
        message({ folder: 'foodbox', decisions: [decision({ categories: ['FOOD BOX'] })] }),
        message({ folder: 'foodbox', decisions: [decision({ categories: ['ARCOBETA'] })] }),
      ],
      NO_LATENCY,
      'ARCOBETA',
    );
    expect(metrics.perWeek).toEqual([]);
    expect(metrics.perCategory[0]).toMatchObject({ tp: 0, fp: 0, fn: 0, tn: 0 });
    // El propuesto como ARCOBETA queda sin contrastar, no desaparece de las cifras.
    expect(metrics.summary.awaitingReview).toBe(1);
  });
});

describe('listDiscrepancies', () => {
  const agree = message({
    seenCategories: ['FOOD BOX'],
    decisions: [decision({ categories: ['FOOD BOX'] })],
  });
  const differs = message({
    receivedAt: new Date('2026-09-12T08:00:00Z'),
    seenCategories: ['LATERAL'],
    decisions: [decision({ categories: ['FOOD BOX'] })],
  });
  const missed = message({
    receivedAt: new Date('2026-09-11T08:00:00Z'),
    seenCategories: ['ARCOBETA'],
    decisions: [decision({ categories: [] })],
  });
  const undecided = message({ seenCategories: ['LATERAL'] });
  // Decidido pero sin revisar: el equipo no ha puesto nada, no es una discrepancia.
  const unreviewed = message({ decisions: [decision({ categories: ['FOOD BOX'] })] });

  it('lista solo los correos con decisión y categorías distintas, el más reciente primero', () => {
    const list = listDiscrepancies([agree, missed, differs, undecided, unreviewed], null);
    expect(list.map((d) => d.id)).toEqual([differs.id, missed.id]);
  });

  it('con filtro de categoría, solo los que difieren en esa categoría', () => {
    expect(listDiscrepancies([agree, missed, differs], 'ARCOBETA').map((d) => d.id)).toEqual([
      missed.id,
    ]);
    expect(listDiscrepancies([agree, missed, differs], 'LATERAL').map((d) => d.id)).toEqual([
      differs.id,
    ]);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 53 }, (_, i) => i);

  it('devuelve la página pedida y los totales', () => {
    const page = paginate(items, 3, 25);
    expect(page).toMatchObject({ page: 3, pages: 3, total: 53 });
    expect(page.items).toHaveLength(3);
  });

  it('acota páginas fuera de rango o no numéricas', () => {
    expect(paginate(items, 99, 25).page).toBe(3);
    expect(paginate(items, 0, 25).page).toBe(1);
    expect(paginate(items, Number.NaN, 25).page).toBe(1);
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pages: 1, total: 0, items: [] });
  });
});

describe('classifySync', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('distingue nunca, al día y parado', () => {
    expect(classifySync(null, now, 300)).toEqual({ state: 'never', ageSeconds: null });
    expect(classifySync(new Date('2026-10-02T11:58:00Z'), now, 300)).toEqual({
      state: 'ok',
      ageSeconds: 120,
    });
    expect(classifySync(new Date('2026-10-02T11:50:00Z'), now, 300)).toEqual({
      state: 'stale',
      ageSeconds: 600,
    });
  });
});

describe('loadLatencyByModel', () => {
  const range = { from: new Date('2026-09-01'), to: new Date('2026-10-01') };

  it('devuelve la media por modelo', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ model: 'haiku', avg: 900 }]) };
    expect(await loadLatencyByModel(db, range)).toEqual(new Map([['haiku', 900]]));
  });

  it('si la columna latencyMs no existe devuelve un mapa vacío', async () => {
    const db = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('column d.latencyMs does not exist')),
    };
    expect((await loadLatencyByModel(db, range)).size).toBe(0);
  });

  it('propaga cualquier otro error', async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')) };
    await expect(loadLatencyByModel(db, range)).rejects.toThrow('connection refused');
  });
});

describe('getServiceStatus', () => {
  it('cuenta pendientes y fallidos por estado del correo y los marcados para reprocesar', async () => {
    const count = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.status === 'pending') return 4;
      if (where.status === 'failed') return 2;
      if (where.needsReprocess === true) return 5;
      throw new Error('consulta inesperada');
    });
    const db = {
      syncState: {
        findUnique: vi.fn(async () => ({ lastSyncAt: new Date('2026-10-02T11:59:00Z') })),
      },
      message: { count },
      decision: { findFirst: vi.fn(async () => ({ createdAt: new Date('2026-10-02T11:58:00Z') })) },
      outage: {
        findMany: vi.fn(async () => [
          {
            id: 'b',
            startedAt: new Date('2026-10-02T11:50:00Z'),
            endedAt: null,
            cause: 'Graph 503',
          },
          {
            id: 'a',
            startedAt: new Date('2026-10-01T10:00:00Z'),
            endedAt: new Date('2026-10-01T10:05:00Z'),
            cause: 'el worker estuvo parado',
          },
        ]),
      },
    };
    const status = await getServiceStatus(db as never, 300, new Date('2026-10-02T12:00:00Z'));
    expect(status).toMatchObject({ state: 'ok', pending: 4, failed: 2, needsReprocess: 5 });
    expect(status.lastFolderCheckAt).toEqual(new Date('2026-10-02T11:59:00Z'));
    expect(status.certExpiresAt).toEqual(new Date('2026-10-02T11:59:00Z'));
    expect(status.outages.map((o) => o.durationSeconds)).toEqual([600, 300]);
  });
});

describe('listMessages', () => {
  const valid = (categories: string[], needsReview = false) =>
    decision({
      categories,
      decision: { source: 'rule', reason: 'motivo', confidence: 1, needsReview },
    });

  it('da a cada correo su estado: clasificado, sin categoría, en duda, a reprocesar o en cola', () => {
    const messages = [
      message({ id: 'c', decisions: [valid(['FOOD BOX'])] }),
      message({ id: 'n', decisions: [valid([])] }),
      message({ id: 'd', decisions: [valid(['LATERAL'], true)] }),
      message({ id: 'r', decisions: [{ ...valid([]), degraded: true }] }),
      message({ id: 'f', status: 'failed' }),
      message({ id: 'q', status: 'pending' }),
    ];
    const states = Object.fromEntries(
      listMessages(messages, { category: null, state: null }).map((m) => [m.id, m.state]),
    );
    expect(states).toEqual({
      c: 'classified',
      n: 'none',
      d: 'doubt',
      r: 'reprocess',
      f: 'reprocess',
      q: 'queued',
    });
    expect(countStates(messages)).toEqual({
      classified: 1,
      none: 1,
      doubt: 1,
      reprocess: 2,
      queued: 1,
    });
  });

  it('filtra por estado y por categoría propuesta, del más reciente al más antiguo', () => {
    const messages = [
      message({
        id: 'viejo',
        receivedAt: new Date('2026-09-01T08:00:00Z'),
        decisions: [valid(['FOOD BOX'])],
      }),
      message({
        id: 'nuevo',
        receivedAt: new Date('2026-09-05T08:00:00Z'),
        decisions: [valid(['FOOD BOX'])],
      }),
      message({ id: 'lateral', decisions: [valid(['LATERAL'])] }),
      message({ id: 'cola', status: 'pending' }),
    ];
    expect(listMessages(messages, { category: 'FOOD BOX', state: null }).map((m) => m.id)).toEqual([
      'nuevo',
      'viejo',
    ]);
    expect(listMessages(messages, { category: null, state: 'queued' }).map((m) => m.id)).toEqual([
      'cola',
    ]);
  });
});

describe('reprocessCause', () => {
  it('distingue LLM sin configurar, LLM fallido, adjuntos y reintentos agotados', () => {
    expect(
      reprocessCause({ reason: 'LLM no disponible (Falta ANTHROPIC_API_KEY); categorías en duda' }),
    ).toBe('llm-unavailable');
    expect(
      reprocessCause({ reason: 'LLM no disponible: tope de gasto diario del LLM superado' }),
    ).toBe('llm-budget');
    expect(reprocessCause({ reason: 'LLM fallido (timeout); categorías en duda' })).toBe(
      'llm-failed',
    );
    expect(reprocessCause({ reason: 'FOOD BOX sí por regla fuerte' })).toBe('extraction');
    expect(reprocessCause({ reason: null })).toBe('extraction');
    expect(reprocessCause(null)).toBe('retries');
  });
});

describe('appliedReasons', () => {
  it('deja solo lo que se cumple: regla, hilo o «sí» del LLM', () => {
    expect(
      appliedReasons(
        'FOOD BOX por CIF A87240420 (adjunto); LATERAL sin coincidencias en las reglas; ARCOBETA descartada(s): el documento es de otra sociedad del grupo',
      ),
    ).toEqual(['FOOD BOX por CIF A87240420 (adjunto)']);
    expect(
      appliedReasons(
        'LATERAL heredada del hilo (correo m1 etiquetado por el equipo); FOOD BOX no según el LLM (0.90): otra sociedad',
      ),
    ).toEqual(['LATERAL heredada del hilo (correo m1 etiquetado por el equipo)']);
  });

  it('sin nada que se cumpla, una sola línea: por qué está pendiente o que no hay regla', () => {
    expect(
      appliedReasons(
        'FOOD BOX sin coincidencias en las reglas; LLM no disponible (Falta ANTHROPIC_API_KEY); categorías en duda',
      ),
    ).toEqual(['LLM no disponible (Falta ANTHROPIC_API_KEY)']);
    expect(appliedReasons('FOOD BOX sin coincidencias en las reglas')).toEqual([
      'Ninguna regla se cumple',
    ]);
    expect(appliedReasons(null)).toEqual([]);
  });
});
