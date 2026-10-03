import { resolve } from 'node:path';

import { z } from 'zod';

/**
 * Dominios de correo público (o de operadoras): reciben correo de cualquiera, así que nunca se
 * propone una regla de dominio entera con ellos. Una dirección concreta sí puede proponerse.
 */
export const DEFAULT_GENERIC_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.es',
  'hotmail.com',
  'hotmail.es',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.es',
  'telefonica.net',
  'movistar.es',
] as const;

const csv = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const historySchema = z.object({
  /** Carpeta de datos (contiene correos de terceros: nunca se sube al repositorio). */
  HISTORY_DATA_DIR: z.string().min(1).default('data/history'),
  HISTORY_MONTHS: z.coerce.number().int().positive().default(6),
  HISTORY_SAMPLE_SIZE: z.coerce.number().int().positive().default(1500),
  /** Fracción de desarrollo; el resto (los más recientes) es la prueba. */
  HISTORY_DEV_RATIO: z.coerce.number().gt(0).lt(1).default(0.7),
  /** Nombres de carpeta (en minúsculas, separados por comas) que no se recorren. */
  HISTORY_SKIP_FOLDERS: csv,
  RULE_MIN_OCCURRENCES: z.coerce.number().int().positive().default(5),
  RULE_MIN_PURITY: z.coerce.number().gt(0).max(1).default(0.98),
  /** Dominios genéricos adicionales a los de `DEFAULT_GENERIC_DOMAINS`. */
  RULE_GENERIC_DOMAINS: csv,
  /**
   * Dominios del grupo (los mismos `INTERNAL_EMAIL_DOMAINS` del worker): los compañeros reenvían de
   * todo, así que no se propone ninguna regla con ellos, ni de dominio ni de dirección.
   */
  INTERNAL_EMAIL_DOMAINS: csv,
  /** Extracción de adjuntos (los mismos nombres que usa el worker). */
  DOCLING_URL: z.url().default('http://localhost:5101'),
  ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 1024 * 1024),
  ATTACHMENT_MAX_PAGES: z.coerce.number().int().positive().default(2),
  DOCLING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(180),
});

const graphSchema = z.object({
  GRAPH_TENANT_ID: z.string().min(1),
  GRAPH_CLIENT_ID: z.string().min(1),
  GRAPH_CERT_PATH: z.string().min(1),
  MAILBOX: z.string().min(1),
});

export type HistoryConfig = z.infer<typeof historySchema> & { dataDir: string };
export type GraphEnv = z.infer<typeof graphSchema>;

/** Configuración del análisis del histórico; la ruta de datos relativa se resuelve desde `baseDir`. */
export function loadHistoryConfig(
  env: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): HistoryConfig {
  const parsed = historySchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración del histórico no válida:\n${z.prettifyError(parsed.error)}`);
  }
  return { ...parsed.data, dataDir: resolve(baseDir, parsed.data.HISTORY_DATA_DIR) };
}

/** Credenciales de Graph; solo se exigen cuando se va a leer el buzón de verdad. */
export function loadGraphEnv(env: NodeJS.ProcessEnv = process.env): GraphEnv {
  const parsed = graphSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Faltan variables para leer el buzón con Graph:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function genericDomains(config: Pick<HistoryConfig, 'RULE_GENERIC_DOMAINS'>): Set<string> {
  return new Set([...DEFAULT_GENERIC_DOMAINS, ...config.RULE_GENERIC_DOMAINS]);
}

export function internalDomains(
  config: Pick<HistoryConfig, 'INTERNAL_EMAIL_DOMAINS'>,
): Set<string> {
  return new Set(config.INTERNAL_EMAIL_DOMAINS);
}
