import { NextResponse } from 'next/server';

import { loadConfig } from '@/lib/config';

// Siempre se evalúa en cada petición: es la comprobación de salud del contenedor.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', version: loadConfig().APP_VERSION });
}
