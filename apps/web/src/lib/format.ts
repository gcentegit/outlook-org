const TIME_ZONE = 'Europe/Madrid';

const integer = new Intl.NumberFormat('es-ES');
const percent = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dateTime = new Intl.DateTimeFormat('es-ES', {
  timeZone: TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});

export const NOT_AVAILABLE = 'n/d';

export function formatInt(value: number): string {
  return integer.format(value);
}

/** Ratio 0-1 como porcentaje (`93,4 %`); `n/d` si no hay datos. */
export function formatPercent(ratio: number | null): string {
  return ratio === null ? NOT_AVAILABLE : `${percent.format(ratio * 100)} %`;
}

export function formatUsd(value: number): string {
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} USD`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return NOT_AVAILABLE;
  return ms >= 1000
    ? `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
    : `${Math.round(ms)} ms`;
}

export function formatDateTime(date: Date | null): string {
  return date ? dateTime.format(date) : NOT_AVAILABLE;
}

/** Duración legible (`2 min`, `3 h`, `1 d`) a partir de segundos. */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return NOT_AVAILABLE;
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 129_600) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}
