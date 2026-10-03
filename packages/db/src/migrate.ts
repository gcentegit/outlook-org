import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Aplica las migraciones pendientes (`prisma migrate deploy`) contra `databaseUrl`.
 * Usa el CLI de Prisma instalado en este paquete, así que no hace falta pnpm en el contenedor.
 */
export async function migrateDeploy(databaseUrl: string): Promise<string> {
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const packageRoot = resolve(import.meta.dirname, '..');
  const { stdout } = await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 120_000,
  });
  return stdout;
}
