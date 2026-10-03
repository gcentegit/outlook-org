import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// En local el .env vive en la raíz del monorepo (lo comparten web, worker y compose). No pisa
// variables ya definidas; en la imagen Docker no existe y se usa el entorno del contenedor.
if (existsSync(join(repoRoot, '.env'))) process.loadEnvFile(join(repoRoot, '.env'));

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Bundle autónomo para la imagen Docker (el runner solo copia el directorio standalone).
  output: 'standalone',
  // En el monorepo los paquetes del workspace están fuera de apps/web.
  outputFileTracingRoot: repoRoot,
  // ESLint corre como paso aparte (pnpm lint); el build solo compila y comprueba tipos.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@clasificador/shared', '@clasificador/db'],
  // Contra el clickjacking: acciones como pasar a live o crear una categoría se confirman con una
  // casilla o un botón, y no deben poder inducirse desde un iframe de otra web.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
