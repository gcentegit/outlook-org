import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

// En local la configuración vive en el .env de la raíz; en los contenedores llega por entorno.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` no se conecta; el valor solo importa en migrate.
    url: process.env.DATABASE_URL ?? '',
  },
});
