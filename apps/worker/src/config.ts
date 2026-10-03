import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

const configSchema = z.object({
  DATABASE_URL: z.url(),
  /** Versión desplegada (sha corto de la imagen); la fija el Dockerfile. */
  APP_VERSION: z.string().min(1).default('dev'),
  /** Puerto interno del endpoint /health. */
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Segundos sin sincronizar a partir de los cuales /health devuelve 503. */
  SYNC_STALE_SECONDS: z.coerce.number().int().positive().default(300),
  /** docling-serve (extracción de adjuntos). */
  DOCLING_URL: z.url().default('http://docling:5001'),
  /** Microsoft Graph (permisos de aplicación con certificado). Opcionales hasta que haya acceso al buzón. */
  GRAPH_TENANT_ID: z.string().min(1).optional(),
  GRAPH_CLIENT_ID: z.string().min(1).optional(),
  /** Ruta al certificado PEM (clave privada y certificado) de la aplicación de Entra. */
  GRAPH_CERT_PATH: z.string().min(1).optional(),
  /** Buzón que se clasifica (su dirección completa; sin valor no sincroniza). */
  MAILBOX: z.string().min(1).optional(),
  /** Tamaño máximo de un adjunto a convertir; los mayores se omiten. */
  ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 1024 * 1024),
  /** Páginas de un PDF que se convierten (desde la primera). */
  ATTACHMENT_MAX_PAGES: z.coerce.number().int().positive().default(2),
  /** Tiempo máximo de docling por documento. */
  DOCLING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(180),
  /** Claves de los proveedores de LLM: solo de entorno, nunca de la base de datos. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  OPENAI_COMPATIBLE_BASE_URL: z.url().optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().min(1).optional(),
  /** `shadow` registra decisiones sin tocar el buzón; `live` (PATCH de categorías) aún no existe. */
  MODE: z.enum(['shadow', 'live']).default('shadow'),
  /** Segundos entre sincronizaciones de la Bandeja de entrada (recomendado 60-120). */
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(600).default(90),
  /** Correos que se procesan a la vez (docling es el cuello de botella). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** URL de push de Uptime Kuma; sin ella no se envía heartbeat. */
  UPTIME_KUMA_PUSH_URL: z.url().optional(),
  /** Confianza mínima para proponer una categoría; por debajo queda sin categoría y en revisión. */
  CLASSIFY_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  /**
   * Administrador inicial del panel: se da de alta al arrancar solo si no hay ningún usuario
   * autorizado. Sin valor y con la lista vacía no se crea ningún administrador.
   */
  ADMIN_EMAIL: z.email().optional(),
  /** Dominios de correo del grupo (separados por comas, sin valor por defecto): sus remitentes son internos. */
  INTERNAL_EMAIL_DOMAINS: csv,
});

export type Config = z.infer<typeof configSchema>;

/** Configuración inválida o no soportada: el mensaje basta, no hace falta la traza. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Una variable definida pero vacía (habitual en Dokploy) cuenta como no definida.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = configSchema.safeParse(present);
  if (!parsed.success) {
    throw new ConfigError(`Configuración del worker no válida:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** El PATCH de categorías no existe todavía: con `MODE=live` el worker no debe arrancar. */
export function assertSupportedMode(config: Pick<Config, 'MODE'>): void {
  if (config.MODE === 'live') {
    throw new ConfigError(
      'MODE=live no está soportado todavía: este worker solo funciona en modo sombra (MODE=shadow) ' +
        'hasta que se implemente la aplicación de categorías.',
    );
  }
}

export interface GraphSettings {
  tenantId: string;
  clientId: string;
  certPath: string;
  mailbox: string;
}

/** Credenciales de Graph si están todas; si no, la lista de variables que faltan. */
export function resolveGraphSettings(
  config: Pick<Config, 'GRAPH_TENANT_ID' | 'GRAPH_CLIENT_ID' | 'GRAPH_CERT_PATH' | 'MAILBOX'>,
): { settings: GraphSettings } | { missing: string[] } {
  const missing = (
    ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CERT_PATH', 'MAILBOX'] as const
  ).filter((key) => !config[key]);
  if (missing.length > 0) return { missing };
  return {
    settings: {
      tenantId: config.GRAPH_TENANT_ID!,
      clientId: config.GRAPH_CLIENT_ID!,
      certPath: config.GRAPH_CERT_PATH!,
      mailbox: config.MAILBOX!,
    },
  };
}
