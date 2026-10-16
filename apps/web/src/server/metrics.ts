import type { PrismaClient } from '@clasificador/db';
import {
  CATEGORIES,
  CERT_EXPIRY_SYNC_ID,
  canonicalCategory,
  decisionSourceSchema,
  FOLDER_CATEGORIES,
  folderCategory,
  FOLDERS_SYNC_ID,
  type Category,
  type DecisionSource,
  type MessageFolder,
} from '@clasificador/shared';
import { z } from 'zod';

import { madridDay } from './dates';

/**
 * Métricas del panel. Las consultas leen los mínimos campos de `Message`, `Decision` y
 * `Correction` y todo el cálculo vive en funciones puras (`evaluateMessages`, `computeMetrics`,
 * `listDiscrepancies`) para poder comprobarlas con datos de prueba.
 *
 * Definiciones:
 * - Decisión vigente de un correo: la más reciente (sombra o live).
 * - Categorías del equipo: la última `Correction.final` si existe; si no, las categorías que el
 *   correo tiene en Outlook (`seenCategories`), más la de la carpeta donde lo archivó (árbol
 *   Foodbox → FOOD BOX, árbol Lateral → LATERAL). En modo sombra son solo las de personas; en modo
 *   live incluyen las que aplicó el servicio, así que ahí el acierto es más optimista.
 * - Un correo está revisado por el equipo si tiene alguna categoría en Outlook, una corrección o
 *   está archivado en el árbol de una sociedad. Solo los revisados cuentan para el acierto
 *   (aciertos, falsos positivos y negativos, precisión por modelo y discrepancias): uno sin revisar
 *   no suma como acierto ni como fallo y se cuenta aparte como «sin contrastar». Con filtro de
 *   categoría, lo mismo con un correo que no se puede comparar en esa categoría.
 * - Con solo la carpeta se comparan FOOD BOX y LATERAL: la carpeta no dice nada de ARCOBETA, que no
 *   tiene árbol propio y se archiva en Lateral. Por eso, si el correo es de ARCOBETA (según la
 *   propuesta o el equipo), el árbol Lateral no cuenta como LATERAL. Con categorías del grupo o
 *   corrección del equipo se comparan las tres, salvo LATERAL y ARCOBETA en ese caso si el equipo
 *   no puso ninguna de las dos.
 * - Solo se comparan las tres categorías automatizadas (las demás no son de este clasificador).
 * - Las decisiones degradadas (se tomaron con docling o el LLM caídos) no cuentan en nada: ni en el
 *   acierto, ni en la cobertura, ni por modelo. Quedan pendientes de reprocesar.
 * - Los correos que el equipo eliminó (ya no están en el buzón) se cuentan aparte y no entran en el
 *   acierto, la cobertura ni las discrepancias: casi todos son publicidad y avisos que el equipo
 *   descarta, y contarlos haría pasar por fallos del clasificador lo que el equipo no quiere.
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
  /** Estado del trabajo del worker: `pending` en cola, `failed` agotó los reintentos sin decisión. */
  status: 'pending' | 'processed' | 'failed';
  seenCategories: string[];
  /** Carpeta donde está el correo según la última comprobación; null si aún no se ha comprobado. */
  folder: MessageFolder | null;
  /** Ruta de esa carpeta (`Bandeja de entrada/Foodbox/2026`); null si no se conoce. */
  folderPath: string | null;
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
  status: LoadedMessage['status'];
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
  folder: MessageFolder | null;
  folderPath: string | null;
  /** Categorías en las que se sabe qué quiere el equipo (vacío: sin revisar). */
  compared: Category[];
  /** El equipo ya ha mirado el correo: tiene categoría en Outlook, corrección o carpeta de sociedad. */
  reviewed: boolean;
  /** El equipo lo eliminó: ya no está en el buzón. No se compara con nada. */
  deleted: boolean;
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
    const labels = toCategories(lastCorrection ? lastCorrection.final : message.seenCategories);
    // Con categorías del grupo o una corrección, el equipo ha dicho algo de las tres.
    const labelled = lastCorrection !== undefined || labels.length > 0;
    const archivedAs = folderCategory(message.folder);
    // ARCOBETA no tiene árbol propio: la misma persona lleva ARCOBETA y LATERAL y lo archiva todo en
    // Lateral, así que esa carpeta vale por «LATERAL o ARCOBETA». Si el correo es de ARCOBETA según
    // la propuesta o el equipo, la carpeta no dice si además es de LATERAL.
    const arcobetaInLateral =
      archivedAs === 'LATERAL' &&
      [...labels, ...toCategories(latest?.categories ?? [])].includes('ARCOBETA');
    const folderTruth = arcobetaInLateral ? null : archivedAs;
    const deleted = message.folder === 'missing';
    // Sin carpeta, unas categorías ajenas al grupo también dicen que el equipo no puso ninguna.
    const base = deleted
      ? []
      : labelled || (!archivedAs && message.seenCategories.length > 0)
        ? CATEGORIES
        : archivedAs
          ? FOLDER_CATEGORIES
          : [];
    // Solo la etiqueta ARCOBETA aclara cuál de las dos es: en ese árbol se pone a veces LATERAL a lo
    // que es de ARCOBETA, por comodidad (la regla del negocio es que el CIF de ARCO BETA manda).
    const undecided = arcobetaInLateral && !labels.includes('ARCOBETA');
    const compared = base.filter((c) => !(undecided && (c === 'LATERAL' || c === 'ARCOBETA')));
    return {
      id: message.id,
      receivedAt: message.receivedAt,
      sender: message.sender,
      subject: message.subject,
      status: message.status,
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
      team: folderTruth ? toCategories([...labels, folderTruth]) : labels,
      folder: message.folder,
      folderPath: message.folderPath,
      compared,
      reviewed: compared.length > 0,
      deleted,
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

/** Precisión y cobertura de las decisiones de los correos recibidos en una semana. */
export interface WeekMetrics {
  /** Lunes de la semana (`YYYY-MM-DD`, hora de Madrid). */
  week: string;
  /** Correos con decisión válida y revisados por el equipo. */
  reviewed: number;
  perCategory: CategoryMetrics[];
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
    /** Eliminados por el equipo: no cuentan en nada de lo anterior salvo en `read`. */
    deleted: number;
    /** De los eliminados, los que no tenían ninguna categoría propuesta (o aún sin decisión). */
    deletedUnclassified: number;
  };
  perCategory: CategoryMetrics[];
  /** De la semana más reciente a la más antigua. */
  perWeek: WeekMetrics[];
  origin: Record<Origin, number>;
  perModel: ModelMetrics[];
}

/** La decisión coincide con el equipo en todas las categorías que se pueden comparar. */
const agrees = (proposed: readonly Category[], item: EvaluatedMessage): boolean =>
  item.compared.every((c) => proposed.includes(c) === item.team.includes(c));

type Cells = Map<Category, { tp: number; fp: number; fn: number; tn: number }>;

const emptyCells = (categories: readonly Category[]): Cells =>
  new Map(categories.map((c) => [c, { tp: 0, fp: 0, fn: 0, tn: 0 }]));

/** Suma un correo revisado a la tabla de aciertos, solo en las categorías que se pueden comparar. */
function addToCells(cells: Cells, proposed: readonly Category[], item: EvaluatedMessage): void {
  for (const [c, cell] of cells) {
    if (!item.compared.includes(c)) continue;
    const did = proposed.includes(c);
    const should = item.team.includes(c);
    if (did && should) cell.tp++;
    else if (did) cell.fp++;
    else if (should) cell.fn++;
    else cell.tn++;
  }
}

function cellsToMetrics(cells: Cells): CategoryMetrics[] {
  return [...cells].map(([category, { tp, fp, fn, tn }]) => ({
    category,
    tp,
    fp,
    fn,
    tn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
  }));
}

/** Lunes (`YYYY-MM-DD`) de la semana de un instante, en hora de Madrid. */
export function weekOf(instant: Date): string {
  const day = new Date(`${madridDay(instant)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

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
  let deleted = 0;
  let deletedUnclassified = 0;
  const origin: Record<Origin, number> = { thread: 0, rule: 0, llm: 0, none: 0 };
  const cells = emptyCells(categories);
  const weeks = new Map<string, { reviewed: number; cells: Cells }>();

  for (const item of evaluated) {
    const decision = item.decision;
    // El equipo lo descartó: no dice nada del acierto del clasificador.
    if (item.deleted) {
      deleted++;
      if (!decision || decision.proposed.length === 0) deletedUnclassified++;
      continue;
    }
    if (!decision) {
      pending++;
      continue;
    }
    // Una decisión degradada está pendiente de reprocesar: no dice nada del clasificador.
    if (decision.degraded) continue;
    if (decision.proposed.length === 0) doubtful++;
    else if (!category || decision.proposed.includes(category)) classified++;
    if (!category || decision.proposed.includes(category)) origin[decision.source]++;
    // Sin nada del equipo con qué comparar en las categorías mostradas: ni acierto ni fallo.
    if (!categories.some((c) => item.compared.includes(c))) {
      if (!category || decision.proposed.includes(category)) awaitingReview++;
      continue;
    }
    addToCells(cells, decision.proposed, item);
    const key = weekOf(item.receivedAt);
    const week = weeks.get(key) ?? { reviewed: 0, cells: emptyCells(categories) };
    week.reviewed++;
    addToCells(week.cells, decision.proposed, item);
    weeks.set(key, week);
  }

  const perCategory = cellsToMetrics(cells);
  const perWeek = [...weeks]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([week, row]): WeekMetrics => ({
      week,
      reviewed: row.reviewed,
      perCategory: cellsToMetrics(row.cells),
    }));

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
        if (agrees(toCategories(decision.categories), item)) row.correct++;
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
      deleted,
      deletedUnclassified,
    },
    perCategory,
    perWeek,
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
        return (
          item.compared.includes(category) &&
          item.decision.proposed.includes(category) !== item.team.includes(category)
        );
      }
      return !agrees(item.decision.proposed, item);
    })
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
}

/**
 * Cómo ha quedado un correo para quien mira el panel:
 * - `classified`: decisión válida con alguna categoría.
 * - `none`: decisión válida sin ninguna categoría (no es de ninguna sociedad del grupo).
 * - `doubt`: decisión válida pero marcada para revisar (confianza baja o categorías en duda).
 * - `reprocess`: decisión tomada con un fallo técnico (docling o el LLM caídos, o sin clave del LLM);
 *   se volverá a procesar.
 * - `queued`: aún sin decisión (en cola o con los reintentos agotados).
 */
export type MessageState = 'classified' | 'none' | 'doubt' | 'reprocess' | 'queued';
export const MESSAGE_STATES: readonly MessageState[] = [
  'classified',
  'none',
  'doubt',
  'reprocess',
  'queued',
];

export function messageState(item: EvaluatedMessage): MessageState {
  if (!item.decision) return item.status === 'failed' ? 'reprocess' : 'queued';
  if (item.decision.degraded) return 'reprocess';
  if (item.decision.needsReview) return 'doubt';
  return item.decision.proposed.length > 0 ? 'classified' : 'none';
}

/**
 * Del motivo que guarda el worker (líneas separadas por «; »), solo lo que se cumple: la regla que
 * decidió una categoría, la herencia del hilo o el «sí» del LLM. Si no se cumple nada, una sola
 * línea: el motivo de que esté pendiente (LLM sin configurar o fallido) o «Ninguna regla se cumple».
 */
export function appliedReasons(reason: string | null): string[] {
  if (!reason) return [];
  const lines = reason.split('; ');
  const applied = lines.filter((line) =>
    /^(FOOD BOX|LATERAL|ARCOBETA) (por |heredada del hilo|sí según el LLM)/.test(line),
  );
  if (applied.length > 0) return applied;
  const pending = lines.find((line) =>
    /^(LLM no disponible|LLM fallido|sin LLM configurado)/.test(line),
  );
  return [pending ?? 'Ninguna regla se cumple'];
}

export interface ListedMessage extends EvaluatedMessage {
  state: MessageState;
}

/**
 * Todos los correos del periodo con su decisión vigente y su estado, del más reciente al más
 * antiguo. Con categoría, solo los que tienen esa categoría propuesta; con estado, solo ese estado.
 */
export function listMessages(
  messages: readonly LoadedMessage[],
  filter: { category: Category | null; state: MessageState | null },
): ListedMessage[] {
  return evaluateMessages(messages)
    .map((item) => ({ ...item, state: messageState(item) }))
    .filter(
      (item) =>
        (!filter.state || item.state === filter.state) &&
        (!filter.category || (item.decision?.proposed.includes(filter.category) ?? false)),
    )
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
}

/** Cuántos correos hay en cada estado (para los contadores de la página). */
export function countStates(messages: readonly LoadedMessage[]): Record<MessageState, number> {
  const counts = Object.fromEntries(MESSAGE_STATES.map((s) => [s, 0])) as Record<
    MessageState,
    number
  >;
  for (const item of evaluateMessages(messages)) counts[messageState(item)]++;
  return counts;
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
      status: true,
      seenCategories: true,
      folder: true,
      folderPath: true,
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

export async function getMessageList(
  db: Pick<PrismaClient, 'message'>,
  filter: MetricsFilter,
  state: MessageState | null,
  page: number,
  pageSize = 25,
): Promise<Page<ListedMessage> & { counts: Record<MessageState, number> }> {
  const messages = await loadMessages(db, filter);
  return {
    ...paginate(listMessages(messages, { category: filter.category, state }), page, pageSize),
    counts: countStates(messages),
  };
}

// --- Estado del servicio --------------------------------------------------------------------

export interface OutageEntry {
  id: string;
  startedAt: Date;
  /** Null mientras la parada dura. */
  endedAt: Date | null;
  durationSeconds: number;
  cause: string;
}

export const OUTAGE_HISTORY_LIMIT = 10;

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
  /** Últimas paradas de la sincronización, la más reciente primero. */
  outages: OutageEntry[];
  /** Última comprobación de en qué carpeta está cada correo (null: nunca). */
  lastFolderCheckAt: Date | null;
  /** Caducidad del certificado de Graph que el worker deja en la base de datos (null: no se conoce). */
  certExpiresAt: Date | null;
}

/** Por qué está un correo pendiente de reprocesar; decide qué se le dice a quien mira el panel. */
export type ReprocessCause =
  'llm-budget' | 'llm-unavailable' | 'llm-failed' | 'extraction' | 'retries';
export const REPROCESS_CAUSES: readonly ReprocessCause[] = [
  'llm-budget',
  'llm-unavailable',
  'llm-failed',
  'extraction',
  'retries',
];

/**
 * Causa a partir del correo y de su decisión vigente. El worker anota en el motivo «LLM no
 * disponible» con el tope de gasto diario superado (se reprocesa al día siguiente o al subir el tope), «LLM no
 * disponible» (sin clave o sin proveedor: reprocesar no sirve hasta configurarlo) o «LLM fallido»
 * (error pasajero); una decisión degradada sin ninguno de los dos se debe a los adjuntos (docling o
 * la descarga). Sin decisión, el trabajo agotó los reintentos.
 */
export function reprocessCause(latest: { reason: string | null } | null): ReprocessCause {
  if (!latest) return 'retries';
  if (latest.reason?.includes('tope de gasto diario')) return 'llm-budget';
  if (latest.reason?.includes('LLM no disponible')) return 'llm-unavailable';
  if (latest.reason?.includes('LLM fallido')) return 'llm-failed';
  return 'extraction';
}

export async function getReprocessCauses(
  db: Pick<PrismaClient, 'message'>,
): Promise<Record<ReprocessCause, number>> {
  const rows = await db.message.findMany({
    where: { needsReprocess: true },
    select: {
      decisions: { select: { decision: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const counts = Object.fromEntries(REPROCESS_CAUSES.map((c) => [c, 0])) as Record<
    ReprocessCause,
    number
  >;
  for (const row of rows) {
    const latest = row.decisions[0];
    counts[reprocessCause(latest ? { reason: readDetails(latest.decision).reason } : null)]++;
  }
  return counts;
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
  db: Pick<PrismaClient, 'syncState' | 'message' | 'decision' | 'outage'>,
  staleSeconds: number,
  now: Date = new Date(),
): Promise<ServiceStatus> {
  const [sync, folders, cert, pending, failed, needsReprocess, lastDecision, outages] =
    await Promise.all([
      db.syncState.findUnique({ where: { id: 'inbox' }, select: { lastSyncAt: true } }),
      db.syncState.findUnique({ where: { id: FOLDERS_SYNC_ID }, select: { lastSyncAt: true } }),
      db.syncState.findUnique({ where: { id: CERT_EXPIRY_SYNC_ID }, select: { lastSyncAt: true } }),
      db.message.count({ where: { status: 'pending' } }),
      db.message.count({ where: { status: 'failed' } }),
      db.message.count({ where: { needsReprocess: true } }),
      db.decision.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.outage.findMany({ orderBy: { startedAt: 'desc' }, take: OUTAGE_HISTORY_LIMIT }),
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
    outages: outages.map((o) => ({
      id: o.id,
      startedAt: o.startedAt,
      endedAt: o.endedAt,
      durationSeconds: Math.max(
        0,
        Math.round(((o.endedAt ?? now).getTime() - o.startedAt.getTime()) / 1000),
      ),
      cause: o.cause,
    })),
    lastFolderCheckAt: folders?.lastSyncAt ?? null,
    certExpiresAt: cert?.lastSyncAt ?? null,
  };
}
