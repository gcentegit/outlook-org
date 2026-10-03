import type { PrismaClient } from '@clasificador/db';
import {
  CATEGORIES,
  canonicalCategory,
  decisionSourceSchema,
  type Category,
  type DecisionSource,
} from '@clasificador/shared';
import { z } from 'zod';

/**
 * Métricas del panel. Las consultas leen los mínimos campos de `Message`, `Decision` y
 * `Correction` y todo el cálculo vive en funciones puras (`evaluateMessages`, `computeMetrics`,
 * `listDiscrepancies`) para poder comprobarlas con datos de prueba.
 *
 * Definiciones:
 * - Decisión vigente de un correo: la más reciente (sombra o live).
 * - Categorías del equipo: la última `Correction.final` si existe; si no, las categorías que el
 *   correo tiene en Outlook (`seenCategories`). En modo sombra son solo las de personas; en modo
 *   live incluyen las que aplicó el servicio, así que ahí el acierto es más optimista.
 * - Un correo está revisado por el equipo si tiene alguna categoría en Outlook o una corrección.
 *   Solo los revisados cuentan para el acierto (aciertos, falsos positivos y negativos, precisión
 *   por modelo y discrepancias): uno sin revisar no suma como acierto ni como fallo y se cuenta
 *   aparte como «pendiente de revisar».
 * - Solo se comparan las tres categorías automatizadas (las demás no son de este clasificador).
 * - Las decisiones degradadas (se tomaron con docling o el LLM caídos) no cuentan en nada: ni en el
 *   acierto, ni en la cobertura, ni por modelo. Quedan pendientes de reprocesar.
 */

export interface MetricsFilter {
  /** Inicio del rango (inclusive), por fecha de recepción. */
  from: Date;
  /** Fin del rango (exclusive). */
  to: Date;
  category: Category | null;
}

export interface LoadedDecision {
  id: string;
  categories: string[];
  model: string | null;
  costUsd: number | null;
  createdAt: Date;
  mode: 'shadow' | 'live';
  /** Tomada con un fallo técnico (docling o LLM caídos); está pendiente de reprocesar. */
  degraded: boolean;
  /** JSON completo guardado por el worker. */
  decision: unknown;
}

export interface LoadedMessage {
  id: string;
  receivedAt: Date;
  sender: string;
  subject: string;
  seenCategories: string[];
  decisions: LoadedDecision[];
  corrections: { final: string[]; createdAt: Date }[];
}

export type Origin = DecisionSource;
export const ORIGINS: readonly Origin[] = ['thread', 'rule', 'llm', 'none'];

export interface EvaluatedMessage {
  id: string;
  receivedAt: Date;
  sender: string;
  subject: string;
  /** Decisión vigente (null si el correo aún no tiene ninguna). */
  decision: {
    id: string;
    proposed: Category[];
    source: Origin;
    model: string | null;
    mode: 'shadow' | 'live';
    /** La decisión vigente salió con un fallo técnico y está pendiente de reprocesar. */
    degraded: boolean;
    reason: string | null;
    confidence: number | null;
    needsReview: boolean;
  } | null;
  team: Category[];
  /** El equipo ya ha mirado el correo: tiene alguna categoría en Outlook o una corrección. */
  reviewed: boolean;
}

function toCategories(names: readonly string[]): Category[] {
  const found = new Set<Category>();
  for (const name of names) {
    const category = canonicalCategory(name);
    if (category) found.add(category);
  }
  return CATEGORIES.filter((c) => found.has(c));
}

const decisionDetailsSchema = z.object({
  source: decisionSourceSchema.catch('none'),
  reason: z.string().nullable().catch(null),
  confidence: z.number().nullable().catch(null),
  needsReview: z.boolean().catch(false),
});

function readDetails(json: unknown): z.infer<typeof decisionDetailsSchema> {
  const parsed = decisionDetailsSchema.safeParse(json);
  return parsed.success
    ? parsed.data
    : { source: 'none', reason: null, confidence: null, needsReview: false };
}

/** Une la decisión vigente de cada correo con las categorías finales del equipo. */
export function evaluateMessages(messages: readonly LoadedMessage[]): EvaluatedMessage[] {
  return messages.map((message) => {
    const latest = [...message.decisions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    const lastCorrection = [...message.corrections].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    const details = latest ? readDetails(latest.decision) : null;
    return {
      id: message.id,
      receivedAt: message.receivedAt,
      sender: message.sender,
      subject: message.subject,
      decision:
        latest && details
          ? {
              id: latest.id,
              proposed: toCategories(latest.categories),
              source: details.source,
              model: latest.model,
              mode: latest.mode,
              degraded: latest.degraded,
              reason: details.reason,
              confidence: details.confidence,
              needsReview: details.needsReview,
            }
          : null,
      team: toCategories(lastCorrection ? lastCorrection.final : message.seenCategories),
      reviewed: lastCorrection !== undefined || message.seenCategories.length > 0,
    };
  });
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export interface CategoryMetrics {
  category: Category;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** tp / (tp + fp); null si nunca se propuso. */
  precision: number | null;
  /** tp / (tp + fn); null si el equipo nunca la puso. */
  recall: number | null;
}

export interface ModelMetrics {
  model: string;
  decisions: number;
  /** Decisiones sobre correos que el equipo ya ha revisado (las únicas que se comparan). */
  reviewed: number;
  /** Decisiones revisadas cuyas categorías coinciden exactamente con las del equipo. */
  correct: number;
  /** correct / reviewed; null si el equipo aún no ha revisado ninguna. */
  accuracy: number | null;
  costUsd: number;
  /** Latencia media en ms; null si ninguna decisión del modelo registra latencia. */
  avgLatencyMs: number | null;
}

export interface Metrics {
  summary: {
    read: number;
    classified: number;
    /** Con decisión pero sin categoría (dudosos). */
    doubtful: number;
    /** Sin ninguna decisión todavía. */
    pending: number;
    /** Con decisión pero sin revisar por el equipo: no cuentan para el acierto. */
    awaitingReview: number;
    /** classified / (classified + doubtful); null si aún no hay decisiones. */
    coverage: number | null;
  };
  perCategory: CategoryMetrics[];
  origin: Record<Origin, number>;
  perModel: ModelMetrics[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Calcula las métricas de un conjunto de correos. El filtro de categoría limita los clasificados,
 * la tabla por categoría y el origen a los correos cuya decisión propone esa categoría; el
 * detalle por modelo no se filtra por categoría.
 */
export function computeMetrics(
  messages: readonly LoadedMessage[],
  latencyByModel: ReadonlyMap<string, number>,
  category: Category | null,
): Metrics {
  const evaluated = evaluateMessages(messages);
  const categories = category ? [category] : [...CATEGORIES];

  let classified = 0;
  let doubtful = 0;
  let pending = 0;
  let awaitingReview = 0;
  const origin: Record<Origin, number> = { thread: 0, rule: 0, llm: 0, none: 0 };
  const cells = new Map<Category, { tp: number; fp: number; fn: number; tn: number }>(
    categories.map((c) => [c, { tp: 0, fp: 0, fn: 0, tn: 0 }]),
  );

  for (const item of evaluated) {
    const decision = item.decision;
    if (!decision) {
      pending++;
      continue;
    }
    // Una decisión degradada está pendiente de reprocesar: no dice nada del clasificador.
    if (decision.degraded) continue;
    if (decision.proposed.length === 0) doubtful++;
    else if (!category || decision.proposed.includes(category)) classified++;
    if (!category || decision.proposed.includes(category)) origin[decision.source]++;
    // Sin revisar por el equipo no hay con qué comparar: ni acierto ni fallo.
    if (!item.reviewed) {
      if (!category || decision.proposed.includes(category)) awaitingReview++;
      continue;
    }
    for (const c of categories) {
      const cell = cells.get(c);
      if (!cell) continue;
      const did = decision.proposed.includes(c);
      const should = item.team.includes(c);
      if (did && should) cell.tp++;
      else if (did) cell.fp++;
      else if (should) cell.fn++;
      else cell.tn++;
    }
  }

  const perCategory = categories.map((c): CategoryMetrics => {
    const { tp, fp, fn, tn } = cells.get(c) ?? { tp: 0, fp: 0, fn: 0, tn: 0 };
    return {
      category: c,
      tp,
      fp,
      fn,
      tn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
    };
  });

  const models = new Map<
    string,
    { decisions: number; reviewed: number; correct: number; cost: number }
  >();
  messages.forEach((message, index) => {
    // `evaluateMessages` conserva el orden de entrada.
    const item = evaluated[index];
    for (const decision of message.decisions) {
      if (!decision.model || decision.degraded) continue;
      const row = models.get(decision.model) ?? { decisions: 0, reviewed: 0, correct: 0, cost: 0 };
      row.decisions++;
      if (item?.reviewed) {
        row.reviewed++;
        if (sameSet(toCategories(decision.categories), item.team)) row.correct++;
      }
      row.cost += decision.costUsd ?? 0;
      models.set(decision.model, row);
    }
  });
  const perModel = [...models.entries()]
    .map(([model, row]): ModelMetrics => ({
      model,
      decisions: row.decisions,
      reviewed: row.reviewed,
      correct: row.correct,
      accuracy: ratio(row.correct, row.reviewed),
      costUsd: row.cost,
      avgLatencyMs: latencyByModel.get(model) ?? null,
    }))
    .sort((a, b) => b.decisions - a.decisions);

  return {
    summary: {
      read: messages.length,
      classified,
      doubtful,
      pending,
      awaitingReview,
      coverage: ratio(classified, classified + doubtful),
    },
    perCategory,
    origin,
    perModel,
  };
}

export interface Discrepancy extends EvaluatedMessage {
  /** Presente siempre: solo se listan correos con decisión. */
  decision: NonNullable<EvaluatedMessage['decision']>;
}

/**
 * Correos revisados por el equipo donde dejó categorías distintas de las de la decisión vigente,
 * del más reciente al más antiguo. Con filtro de categoría, solo los que difieren en esa categoría.
 */
export function listDiscrepancies(
  messages: readonly LoadedMessage[],
  category: Category | null,
): Discrepancy[] {
  return evaluateMessages(messages)
    .filter((item): item is Discrepancy => {
      if (!item.decision || item.decision.degraded || !item.reviewed) return false;
      if (category) {
        return item.decision.proposed.includes(category) !== item.team.includes(category);
      }
      return !sameSet(item.decision.proposed, item.team);
    })
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export function paginate<T>(items: readonly T[], requestedPage: number, pageSize: number): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pages);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
    pages,
  };
}

// --- Acceso a datos -------------------------------------------------------------------------

type Db = Pick<PrismaClient, 'message' | 'syncState' | '$queryRaw'>;

/** Correos recibidos en el rango con sus decisiones y la última corrección del equipo. */
export async function loadMessages(
  db: Pick<PrismaClient, 'message'>,
  filter: Pick<MetricsFilter, 'from' | 'to'>,
): Promise<LoadedMessage[]> {
  const rows = await db.message.findMany({
    where: { receivedAt: { gte: filter.from, lt: filter.to } },
    select: {
      id: true,
      receivedAt: true,
      sender: true,
      subject: true,
      seenCategories: true,
      decisions: {
        select: {
          id: true,
          categories: true,
          model: true,
          costUsd: true,
          createdAt: true,
          mode: true,
          degraded: true,
          decision: true,
        },
      },
      corrections: {
        select: { final: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  return rows.map((row) => ({
    ...row,
    decisions: row.decisions.map((d) => ({ ...d, costUsd: d.costUsd?.toNumber() ?? null })),
  }));
}

/**
 * Latencia media por modelo (`Decision.latencyMs`, que rellena el worker al llamar al LLM). Si la
 * columna no existe devuelve un mapa vacío y el panel muestra "n/d" en vez de fallar.
 */
export async function loadLatencyByModel(
  db: Pick<PrismaClient, '$queryRaw'>,
  filter: Pick<MetricsFilter, 'from' | 'to'>,
): Promise<Map<string, number>> {
  try {
    const rows = await db.$queryRaw<{ model: string; avg: number }[]>`
      SELECT d."model" AS model, AVG(d."latencyMs")::float8 AS avg
      FROM "Decision" d
      JOIN "Message" m ON m."id" = d."messageId"
      WHERE m."receivedAt" >= ${filter.from} AND m."receivedAt" < ${filter.to}
        AND d."model" IS NOT NULL AND d."latencyMs" IS NOT NULL
      GROUP BY d."model"`;
    return new Map(rows.map((row) => [row.model, row.avg]));
  } catch (error) {
    if (error instanceof Error && /latencyMs/.test(error.message)) return new Map();
    throw error;
  }
}

export async function getMetrics(db: Db, filter: MetricsFilter): Promise<Metrics> {
  const [messages, latency] = await Promise.all([
    loadMessages(db, filter),
    loadLatencyByModel(db, filter),
  ]);
  return computeMetrics(messages, latency, filter.category);
}

export async function getDiscrepancies(
  db: Pick<PrismaClient, 'message'>,
  filter: MetricsFilter,
  page: number,
  pageSize = 25,
): Promise<Page<Discrepancy>> {
  return paginate(
    listDiscrepancies(await loadMessages(db, filter), filter.category),
    page,
    pageSize,
  );
}

// --- Estado del servicio --------------------------------------------------------------------

export interface ServiceStatus {
  /** `never`: el worker aún no ha sincronizado; `stale`: lleva más de `staleSeconds` parado. */
  state: 'ok' | 'stale' | 'never';
  lastSyncAt: Date | null;
  ageSeconds: number | null;
  staleSeconds: number;
  /** Correos detectados cuyo trabajo aún no ha terminado (en cola o reintentándose). */
  pending: number;
  /** Correos cuyo trabajo agotó los reintentos sin decisión. */
  failed: number;
  /** Correos marcados para reprocesar (fallidos o decididos con docling o el LLM caídos). */
  needsReprocess: number;
  lastDecisionAt: Date | null;
}

export function classifySync(
  lastSyncAt: Date | null,
  now: Date,
  staleSeconds: number,
): Pick<ServiceStatus, 'state' | 'ageSeconds'> {
  if (!lastSyncAt) return { state: 'never', ageSeconds: null };
  const ageSeconds = Math.max(0, Math.round((now.getTime() - lastSyncAt.getTime()) / 1000));
  return { state: ageSeconds > staleSeconds ? 'stale' : 'ok', ageSeconds };
}

export async function getServiceStatus(
  db: Pick<PrismaClient, 'syncState' | 'message' | 'decision'>,
  staleSeconds: number,
  now: Date = new Date(),
): Promise<ServiceStatus> {
  const [sync, pending, failed, needsReprocess, lastDecision] = await Promise.all([
    db.syncState.findUnique({ where: { id: 'inbox' }, select: { lastSyncAt: true } }),
    db.message.count({ where: { status: 'pending' } }),
    db.message.count({ where: { status: 'failed' } }),
    db.message.count({ where: { needsReprocess: true } }),
    db.decision.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  const lastSyncAt = sync?.lastSyncAt ?? null;
  return {
    ...classifySync(lastSyncAt, now, staleSeconds),
    lastSyncAt,
    staleSeconds,
    pending,
    failed,
    needsReprocess,
    lastDecisionAt: lastDecision?.createdAt ?? null,
  };
}
