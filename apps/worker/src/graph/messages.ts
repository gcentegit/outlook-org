import type { GraphClient } from './client';

/** Campos mínimos que se piden del mensaje; el resto no se lee. */
const MESSAGE_SELECT = [
  'subject',
  'from',
  'toRecipients',
  'body',
  'categories',
  'hasAttachments',
  'receivedDateTime',
  'internetMessageId',
  'conversationId',
].join(',');

const ATTACHMENT_SELECT = 'id,name,contentType,size,isInline';
const FILE_ATTACHMENT_TYPE = '#microsoft.graph.fileAttachment';

export interface GraphEmailAddress {
  name?: string | null;
  address?: string | null;
}

export interface GraphMessage {
  id: string;
  subject: string | null;
  from?: { emailAddress?: GraphEmailAddress } | null;
  toRecipients?: { emailAddress?: GraphEmailAddress }[];
  body?: { contentType: 'html' | 'text'; content: string } | null;
  categories?: string[];
  hasAttachments: boolean;
  receivedDateTime: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

export interface GraphFileAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

const userPath = (mailbox: string): string => `/users/${encodeURIComponent(mailbox)}`;
const messagePath = (mailbox: string, messageId: string): string =>
  `${userPath(mailbox)}/messages/${encodeURIComponent(messageId)}`;

export function getMessage(
  client: GraphClient,
  mailbox: string,
  messageId: string,
): Promise<GraphMessage> {
  return client.getJson<GraphMessage>(
    `${messagePath(mailbox, messageId)}?$select=${MESSAGE_SELECT}`,
  );
}

/**
 * Adjuntos de tipo fichero del mensaje, sin los inline (firmas, logos, imágenes incrustadas).
 * No descarga el contenido: eso lo decide quien llama según tipo y tamaño.
 */
export async function listFileAttachments(
  client: GraphClient,
  mailbox: string,
  messageId: string,
): Promise<GraphFileAttachment[]> {
  const all = await client.getAll<
    GraphFileAttachment & { '@odata.type'?: string; isInline?: boolean }
  >(`${messagePath(mailbox, messageId)}/attachments?$select=${ATTACHMENT_SELECT}`);
  return all
    .filter((a) => a['@odata.type'] === FILE_ATTACHMENT_TYPE && !a.isInline)
    .map(({ id, name, contentType, size }) => ({ id, name, contentType, size }));
}

/** Contenido binario de un adjunto (`/$value` evita el límite de tamaño del base64 en JSON). */
export function downloadAttachment(
  client: GraphClient,
  mailbox: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  return client.getBytes(
    `${messagePath(mailbox, messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
  );
}
