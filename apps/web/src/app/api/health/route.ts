import { NextResponse } from 'next/server';

import { loadConfig } from '@/lib/config';

// Siempre se evalúa en cada petición: es la comprobación de salud del contenedor.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const { APP_VERSION, APP_COMMIT } = loadConfig();
  return NextResponse.json({ status: 'ok', version: APP_VERSION, commit: APP_COMMIT });
}
