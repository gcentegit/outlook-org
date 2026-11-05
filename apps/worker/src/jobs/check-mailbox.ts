import type { CheckMailboxResult } from '@clasificador/shared';

import { GraphError, type GraphClient } from '../graph/client';

/** Acceso al buzón, o el motivo por el que no hay: faltan credenciales de Graph. */
export type MailboxAccess =
  { graph: Pick<GraphClient, 'getJson'>; mailbox: string } | { missing: string[] };

const MAX_DETAIL = 300;

/** Errores de `@azure/identity` al pedir el token (certificado, app o tenant). */
const AUTH_ERROR_NAMES = new Set([
  'AuthenticationError',
  'AuthenticationRequiredError',
  'CredentialUnavailableError',
]);

const detail = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_DETAIL);

/**
 * Comprueba que el worker llega al buzón: lee la Bandeja de entrada con la dirección y el
 * certificado configurados, como la sincronización. Traduce el fallo a su causa probable para que
 * el panel diga qué revisar. Solo lee. Nunca lanza.
 */
export async function runCheckMailbox(access: MailboxAccess): Promise<CheckMailboxResult> {
  if ('missing' in access) {
    return {
      status: 'unconfigured',
      message: `El worker no tiene credenciales de Graph (faltan: ${access.missing.join(', ')}).`,
    };
  }
  const { graph, mailbox } = access;
  try {
    const inbox = await graph.getJson<{ totalItemCount?: number }>(
      `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=id,totalItemCount`,
    );
    return { status: 'ok', mailbox, inboxTotal: inbox.totalItemCount ?? 0 };
  } catch (error) {
    if (error instanceof GraphError) {
      if (error.status === 403) return { status: 'forbidden', mailbox, message: detail(error) };
      if (error.status === 404) return { status: 'not-found', mailbox, message: detail(error) };
      if (error.status === 401) return { status: 'auth', message: detail(error) };
    } else if (error instanceof Error && AUTH_ERROR_NAMES.has(error.name)) {
      return { status: 'auth', message: detail(error) };
    }
    return { status: 'error', message: detail(error) };
  }
}
