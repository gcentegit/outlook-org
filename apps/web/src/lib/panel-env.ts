/**
 * Lectura de las variables de entorno del panel (login y bypass de desarrollo). El panel no tiene
 * credenciales de Graph: lo que necesita del buzón se lo pide al worker.
 * Funciones puras sobre un `env` inyectable; nada se valida al importar para que la
 * compilación de producción no dependa del entorno.
 */

export type Env = Record<string, string | undefined>;

export const MS_ENV_NAMES = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID'] as const;

export type MicrosoftLogin =
  | { configured: true; clientId: string; clientSecret: string; tenantId: string }
  | { configured: false; missing: string[] };

const filled = (value: string | undefined): value is string => !!value && value.trim() !== '';

/** Credenciales de la app de login (Entra ID, un solo tenant) o la lista de las que faltan. */
export function readMicrosoftLogin(env: Env = process.env): MicrosoftLogin {
  const missing = MS_ENV_NAMES.filter((name) => !filled(env[name]));
  if (missing.length > 0) return { configured: false, missing };
  return {
    configured: true,
    clientId: (env.MS_CLIENT_ID as string).trim(),
    clientSecret: (env.MS_CLIENT_SECRET as string).trim(),
    tenantId: (env.MS_TENANT_ID as string).trim(),
  };
}

/**
 * El bypass de login solo existe en `next dev`: exige AUTH_DEV_BYPASS=true Y NODE_ENV=development.
 * En una compilación de producción (NODE_ENV=production) se ignora aunque la variable esté puesta.
 */
export function isDevBypassActive(env: Env = process.env): boolean {
  return env.AUTH_DEV_BYPASS === 'true' && env.NODE_ENV === 'development';
}

/** Segundos sin sincronizar a partir de los cuales el servicio se considera parado (como en el worker). */
export function readSyncStaleSeconds(env: Env = process.env): number {
  const value = Number(env.SYNC_STALE_SECONDS);
  return Number.isInteger(value) && value > 0 ? value : 300;
}
