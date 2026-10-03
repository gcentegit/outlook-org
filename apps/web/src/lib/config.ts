import { z } from 'zod';

const configSchema = z.object({
  /** Versión desplegada (sha corto de la imagen); la fija el Dockerfile. */
  APP_VERSION: z.string().min(1).default('dev'),
});

export type WebConfig = z.infer<typeof configSchema>;

/** Se valida al usarla (no al importar) para que `next build` no dependa del entorno. */
export function loadConfig(env: Record<string, string | undefined> = process.env): WebConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración de la web no válida:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
