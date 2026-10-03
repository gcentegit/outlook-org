import { describe, expect, it, vi } from 'vitest';

import {
  classifySync,
  getServiceStatus,
  computeMetrics,
  evaluateMessages,
  listDiscrepancies,
  loadLatencyByModel,
  paginate,
  type LoadedDecision,
  type LoadedMessage,
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
    seenCategories: [],
    decisions: [],
    corrections: [],
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
    };
    const status = await getServiceStatus(db as never, 300, new Date('2026-10-02T12:00:00Z'));
    expect(status).toMatchObject({ state: 'ok', pending: 4, failed: 2, needsReprocess: 5 });
  });
});
