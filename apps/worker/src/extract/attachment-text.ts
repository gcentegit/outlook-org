import { createHash } from 'node:crypto';

import type { ExtractedAttachment } from '@clasificador/shared';

import {
  DoclingUnavailableError,
  convertWithDocling,
  detectAttachmentKind,
  type DoclingOptions,
} from './docling';

/** Retención del texto extraído (decisión de producto: 90 días). */
export const ATTACHMENT_TEXT_TTL_DAYS = 90;

type CachedMethod = 'texto' | 'ocr';

/** Parte del cliente de Prisma que usa la caché (facilita probarla sin base de datos). */
export interface AttachmentTextCache {
  attachmentText: {
    findUnique(args: {
      where: { hash: string };
    }): Promise<{ markdown: string; method: CachedMethod; expiresAt: Date } | null>;
    upsert(args: {
      where: { hash: string };
      create: { hash: string; markdown: string; method: CachedMethod; expiresAt: Date };
      update: { markdown: string; method: CachedMethod; createdAt: Date; expiresAt: Date };
    }): Promise<unknown>;
  };
}

export interface AttachmentFile {
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface AttachmentTextDeps {
  db: AttachmentTextCache;
  docling: DoclingOptions;
  now?: Date;
  log?: (message: string) => void;
  /** Se llama cuando docling no está disponible (no cuando el fichero no se pudo convertir). */
  onDegraded?: (reason: string) => void;
}

/** Clave de la caché: el mismo fichero con otro límite de páginas da otro texto. */
export function attachmentCacheKey(sha256: string, maxPages: number): string {
  return `${sha256}:p${maxPages}`;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Adjunto no convertido (tipo no soportado, demasiado grande o fallo): sin texto y sin hash si no se descargó. */
export function skippedAttachment(
  name: string,
  contentType: string,
  sha256 = '',
): ExtractedAttachment {
  return { name, contentType, sha256, markdown: '', method: 'skipped' };
}

/**
 * Texto de un adjunto ya descargado. Si su SHA-256 (con el límite de páginas) está en la caché y no ha caducado no se
 * llama a docling. Un fallo de docling nunca se propaga: el adjunto queda con markdown vacío,
 * se registra y no se cachea (para reintentarlo si el mismo fichero llega otra vez). Si docling no
 * responde (a diferencia de un fichero que no se deja convertir) se avisa con `onDegraded`: la
 * decisión del correo no es definitiva.
 */
export async function extractAttachmentText(
  file: AttachmentFile,
  deps: AttachmentTextDeps,
): Promise<ExtractedAttachment> {
  const log = deps.log ?? console.warn;
  const now = deps.now ?? new Date();
  const sha256 = sha256Hex(file.bytes);
  const cacheKey = attachmentCacheKey(sha256, deps.docling.maxPages);

  const detected = detectAttachmentKind(file.name, file.contentType);
  if (!detected) return skippedAttachment(file.name, file.contentType, sha256);

  const cached = await deps.db.attachmentText.findUnique({ where: { hash: cacheKey } });
  if (cached && cached.expiresAt > now) {
    return {
      name: file.name,
      contentType: file.contentType,
      sha256,
      markdown: cached.markdown,
      method: cached.method === 'ocr' ? 'ocr' : 'text',
    };
  }

  try {
    const started = Date.now();
    const { markdown, method } = await convertWithDocling(
      { ...detected, bytes: file.bytes },
      deps.docling,
    );
    log(`docling: ${file.name} (${method}) en ${Date.now() - started} ms`);
    // Un resultado vacío no se cachea: no se quiere fijar 90 días un fallo de lectura.
    if (markdown) {
      const expiresAt = new Date(now.getTime() + ATTACHMENT_TEXT_TTL_DAYS * 86_400_000);
      const stored = method === 'ocr' ? 'ocr' : 'texto';
      await deps.db.attachmentText.upsert({
        where: { hash: cacheKey },
        create: { hash: cacheKey, markdown, method: stored, expiresAt },
        update: { markdown, method: stored, createdAt: now, expiresAt },
      });
    }
    return { name: file.name, contentType: file.contentType, sha256, markdown, method };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(`docling falló con ${file.name}: ${reason}`);
    if (err instanceof DoclingUnavailableError) {
      deps.onDegraded?.(`${file.name}: ${reason}`);
    }
    return skippedAttachment(file.name, file.contentType, sha256);
  }
}
