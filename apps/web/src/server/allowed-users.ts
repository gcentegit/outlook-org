import type { PrismaClient } from '@clasificador/db';
import { z } from 'zod';

import { lockSettings } from './settings-lock';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Escribe un email válido.' }))
  .pipe(z.string().max(254, 'El email es demasiado largo.'));

export interface AllowedUserRow {
  id: string;
  email: string;
  /** Ya se vinculó a una cuenta de Microsoft (primer acceso hecho). */
  linked: boolean;
  createdAt: Date;
}

export type UserChange = { ok: true } | { ok: false; message: string };

type Db = Pick<PrismaClient, 'allowedUser'>;
type TxDb = Pick<PrismaClient, 'allowedUser' | '$transaction'>;

export async function listAllowedUsers(db: Db): Promise<AllowedUserRow[]> {
  const rows = await db.allowedUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, oid: true, createdAt: true },
  });
  return rows.map(({ oid, ...row }) => ({ ...row, linked: oid !== null }));
}

export type Authorization = 'ok' | 'not-listed' | 'other-account';

/**
 * ¿Puede entrar esta cuenta? El alta es por email; en el primer acceso válido se guarda el `oid`
 * de la cuenta de Microsoft y desde entonces debe coincidir. La vinculación es condicional
 * (`oid` aún nulo) para que dos primeros accesos simultáneos no se pisen; y si el `oid` ya está
 * en otra fila (la misma cuenta dada de alta con dos emails) se rechaza.
 */
export async function authorizeUser(
  db: Pick<PrismaClient, 'allowedUser'>,
  email: string,
  oid: string,
): Promise<Authorization> {
  const row = await db.allowedUser.findUnique({
    where: { email },
    select: { id: true, oid: true },
  });
  if (!row) return 'not-listed';
  if (row.oid) return row.oid === oid ? 'ok' : 'other-account';
  try {
    const linked = await db.allowedUser.updateMany({
      where: { id: row.id, oid: null },
      data: { oid },
    });
    if (linked.count === 1) return 'ok';
  } catch (error) {
    // Violación de la unicidad de `oid`: esa cuenta ya está vinculada a otro usuario de la lista.
    if ((error as { code?: string }).code === 'P2002') return 'other-account';
    throw error;
  }
  // Otra petición vinculó la fila entre la lectura y la escritura.
  const current = await db.allowedUser.findUnique({ where: { id: row.id }, select: { oid: true } });
  return current?.oid === oid ? 'ok' : 'other-account';
}

export async function addAllowedUser(db: Db, rawEmail: string): Promise<UserChange> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Email no válido.' };
  const email = parsed.data;
  if ((await db.allowedUser.count({ where: { email } })) > 0) {
    return { ok: false, message: `${email} ya tiene acceso.` };
  }
  try {
    await db.allowedUser.create({ data: { email } });
  } catch (error) {
    // Alta simultánea del mismo email: la unicidad de la columna lo detiene.
    if ((error as { code?: string }).code === 'P2002') {
      return { ok: false, message: `${email} ya tiene acceso.` };
    }
    throw error;
  }
  return { ok: true };
}

/**
 * Da de baja a un usuario. No permite quitarse a uno mismo ni dejar la lista vacía: en ambos
 * casos nadie podría volver a gestionar el panel. La comprobación del recuento y el borrado van
 * en una transacción con bloqueo, para que dos administradores que se quitan el acceso el uno al
 * otro a la vez no dejen la lista vacía.
 */
export async function removeAllowedUser(
  db: TxDb,
  id: string,
  actorEmail: string,
): Promise<UserChange> {
  return db.$transaction(async (tx): Promise<UserChange> => {
    await lockSettings(tx);
    const target = await tx.allowedUser.findUnique({ where: { id }, select: { email: true } });
    if (!target) return { ok: false, message: 'Ese usuario ya no existe.' };
    if (target.email === actorEmail.toLowerCase()) {
      return { ok: false, message: 'No puedes quitarte el acceso a ti mismo.' };
    }
    if ((await tx.allowedUser.count()) <= 1) {
      return { ok: false, message: 'Debe quedar al menos un usuario autorizado.' };
    }
    await tx.allowedUser.delete({ where: { id } });
    return { ok: true };
  });
}
