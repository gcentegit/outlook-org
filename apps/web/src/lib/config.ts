import { z } from 'zod';

const configSchema = z.object({
  /** Versión del producto (X.Y.Z, la del package.json raíz); la fija el Dockerfile. */
  APP_VERSION: z.string().min(1).default('dev'),
  /** Commit (sha corto) con el que se construyó la imagen; lo fija el Dockerfile. */
  APP_COMMIT: z.string().min(1).default('dev'),
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
