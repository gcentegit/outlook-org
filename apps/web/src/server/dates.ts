const TIME_ZONE = 'Europe/Madrid';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Diferencia (minutos) entre la hora de Madrid y UTC en un instante dado. */
function madridOffsetMinutes(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** Instante UTC de las 00:00 (hora de Madrid) del día `YYYY-MM-DD`; null si no es una fecha real. */
export function madridDayStart(day: string): Date | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const naive = Date.UTC(year, month - 1, date);
  if (new Date(naive).getUTCDate() !== date) return null; // 31 de febrero, etc.
  // Dos pasadas: el desfase a mediodía evita el salto de horario de la medianoche.
  const guess = naive - madridOffsetMinutes(naive + 12 * 3_600_000) * 60_000;
  return new Date(naive - madridOffsetMinutes(guess) * 60_000);
}

/** Día `YYYY-MM-DD` (hora de Madrid) de un instante. */
export function madridDay(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts; // en-CA da YYYY-MM-DD
}

export interface DateRange {
  /** Primer día incluido (`YYYY-MM-DD`). */
  fromDay: string;
  /** Último día incluido (`YYYY-MM-DD`). */
  toDay: string;
  /** Inicio del primer día (inclusive). */
  from: Date;
  /** Inicio del día siguiente al último (exclusivo). */
  to: Date;
}

const DEFAULT_DAYS = 30;
/** Máximo de días de un rango: el panel carga en memoria todos los correos del periodo. */
export const MAX_RANGE_DAYS = 366;

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Rango de fechas de los parámetros `desde` y `hasta` (ambos incluidos, hora de Madrid). Si faltan
 * o no son válidos, los últimos 30 días hasta hoy; si vienen al revés se intercambian; si pasan de
 * `MAX_RANGE_DAYS` se recortan por el principio (el panel no carga rangos ilimitados).
 */
export function parseDateRange(
  desde: string | undefined,
  hasta: string | undefined,
  now: Date = new Date(),
): DateRange {
  const today = madridDay(now);
  let toDay = hasta && madridDayStart(hasta) ? hasta : today;
  let fromDay = desde && madridDayStart(desde) ? desde : addDays(toDay, -(DEFAULT_DAYS - 1));
  if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
  const earliest = addDays(toDay, -(MAX_RANGE_DAYS - 1));
  if (fromDay < earliest) fromDay = earliest;
  return {
    fromDay,
    toDay,
    from: madridDayStart(fromDay) as Date,
    to: madridDayStart(addDays(toDay, 1)) as Date,
  };
}
