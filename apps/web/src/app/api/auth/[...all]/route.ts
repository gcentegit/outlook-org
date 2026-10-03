import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/lib/auth';

// better-auth necesita el entorno de la petición: nada se resuelve al compilar.
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
