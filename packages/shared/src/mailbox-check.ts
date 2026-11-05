import { z } from 'zod';

/**
 * Trabajo con el que el panel pide al worker comprobar que llega al buzón: con su certificado lee
 * la Bandeja de entrada, igual que la sincronización. El panel no tiene credenciales de Graph.
 */
export const CHECK_MAILBOX_QUEUE = 'check-mailbox';

/** Tiempo máximo que el panel espera la comprobación (pedir el token y leer la Bandeja). */
export const MAILBOX_CHECK_TIMEOUT_MS = 30_000;

/**
 * - `ok`: lee la Bandeja de entrada (`inboxTotal`, correos que tiene).
 * - `forbidden`: Graph responde 403; la app no tiene permiso sobre ese buzón (p. ej., el ámbito de
 *   Exchange no lo incluye tras cambiar su dirección).
 * - `not-found`: Graph no encuentra el buzón con la dirección configurada (`MAILBOX`).
 * - `auth`: no se pudo obtener el token (certificado, app o tenant).
 * - `unconfigured`: al worker le faltan las credenciales de Graph.
 * - `error`: cualquier otro fallo.
 */
export const checkMailboxResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    mailbox: z.string(),
    inboxTotal: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal('forbidden'), mailbox: z.string(), message: z.string() }),
  z.object({ status: z.literal('not-found'), mailbox: z.string(), message: z.string() }),
  z.object({ status: z.literal('auth'), message: z.string() }),
  z.object({ status: z.literal('unconfigured'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);

export type CheckMailboxResult = z.infer<typeof checkMailboxResultSchema>;
