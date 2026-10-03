import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client';

/** Crea un cliente de Prisma sobre `pg` (Prisma 7 no lleva motor propio). */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

let shared: PrismaClient | undefined;

/** Cliente compartido del proceso; se crea la primera vez a partir de `DATABASE_URL`. */
export function prisma(): PrismaClient {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL no está definida');
    shared = createPrismaClient(url);
  }
  return shared;
}
