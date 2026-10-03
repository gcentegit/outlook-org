import type { ExtractedEmail } from '@clasificador/shared';

import { GraphError, type GraphClient } from '../graph/client';
import { downloadAttachment, getMessage, listFileAttachments } from '../graph/messages';
import {
  extractAttachmentText,
  skippedAttachment,
  type AttachmentTextCache,
} from './attachment-text';
import { detectAttachmentKind, type DoclingOptions } from './docling';
import { bodyToText } from './message-text';

export interface ExtractEmailDeps {
  graph: GraphClient;
  mailbox: string;
  db: AttachmentTextCache;
  docling: DoclingOptions;
  /** Tamaño máximo (bytes) de un adjunto a convertir; los mayores se omiten sin descargarlos. */
  maxAttachmentBytes: number;
  now?: Date;
  log?: (message: string) => void;
}

/**
 * Convierte un correo del buzón en un `ExtractedEmail`. Los adjuntos se procesan de uno en uno
 * (docling es el cuello de botella) y un fallo en uno no afecta al correo ni a los demás
 * adjuntos; los errores de Graph al leer el mensaje sí se propagan.
 *
 * Si un adjunto falta por un fallo pasajero (docling caído, descarga con error de servidor o de
 * red) se anota en `degradedReasons`, para que quien decide sepa que el resultado no es definitivo.
 * Un adjunto que no se deja convertir o que ya no existe se omite sin más. Los adjuntos que son
 * un correo (`.eml`, `.msg`, `itemAttachment`) no se leen: no están soportados.
 */
export async function extractEmail(
  messageId: string,
  deps: ExtractEmailDeps,
): Promise<ExtractedEmail> {
  const log = deps.log ?? console.warn;
  const message = await getMessage(deps.graph, deps.mailbox, messageId);

  const attachments: ExtractedEmail['attachments'] = [];
  const degradedReasons: string[] = [];
  if (message.hasAttachments) {
    for (const att of await listFileAttachments(deps.graph, deps.mailbox, messageId)) {
      if (!detectAttachmentKind(att.name, att.contentType)) {
        log(`adjunto omitido (tipo no soportado): ${att.name}`);
        attachments.push(skippedAttachment(att.name, att.contentType));
        continue;
      }
      if (att.size > deps.maxAttachmentBytes) {
        log(`adjunto omitido (${att.size} bytes supera el límite): ${att.name}`);
        attachments.push(skippedAttachment(att.name, att.contentType));
        continue;
      }
      try {
        const bytes = await downloadAttachment(deps.graph, deps.mailbox, messageId, att.id);
        attachments.push(
          await extractAttachmentText(
            { name: att.name, contentType: att.contentType, bytes },
            { ...deps, onDegraded: (reason) => degradedReasons.push(reason) },
          ),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log(`no se pudo leer el adjunto ${att.name}: ${reason}`);
        if (isTransientGraphFailure(err)) degradedReasons.push(`${att.name}: ${reason}`);
        attachments.push(skippedAttachment(att.name, att.contentType));
      }
    }
  }

  return {
    messageId: message.id,
    conversationId: message.conversationId ?? null,
    internetMessageId: message.internetMessageId ?? null,
    receivedAt: new Date(message.receivedDateTime),
    fromAddress: message.from?.emailAddress?.address ?? null,
    fromName: message.from?.emailAddress?.name ?? null,
    subject: message.subject ?? '',
    bodyText: bodyToText(message.body),
    categories: message.categories ?? [],
    attachments,
    ...(degradedReasons.length > 0 ? { degradedReasons } : {}),
  };
}

/** Error de servidor, límite de uso o de red al descargar: puede funcionar si se repite. */
function isTransientGraphFailure(err: unknown): boolean {
  if (err instanceof GraphError)
    return err.status >= 500 || err.status === 429 || err.status === 408;
  return true;
}
