import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@clasificador/db';

import {
  attachmentCacheKey,
  extractAttachmentText,
  sha256Hex,
  type AttachmentTextCache,
} from './attachment-text';

// Comprueba en compilación que el cliente de Prisma encaja en la caché.
export const prismaEncaja = (db: PrismaClient): AttachmentTextCache => db;

function fakeDb() {
  const rows = new Map<string, { markdown: string; method: 'texto' | 'ocr'; expiresAt: Date }>();
  const db: AttachmentTextCache = {
    attachmentText: {
      findUnique: async ({ where }) => rows.get(where.hash) ?? null,
      upsert: async ({ where, create, update }) => {
        rows.set(
          where.hash,
          rows.has(where.hash) ? { ...rows.get(where.hash)!, ...update } : create,
        );
      },
    },
  };
  return { db, rows };
}

const docling = { url: 'http://docling.test', maxPages: 2, timeoutSeconds: 30 };
const file = { name: 'f.pdf', contentType: 'application/pdf', bytes: Buffer.from('contenido') };
const now = new Date('2026-10-02T10:00:00Z');

function doclingFetch(md: string, ocr = false) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          document: { md_content: md },
          confidence: { ocr_score: ocr ? 0.9 : null },
        }),
      ),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('extractAttachmentText', () => {
  it('convierte, guarda con caducidad a 90 días y la segunda vez sirve la caché sin llamar a docling', async () => {
    const { db, rows } = fakeDb();
    const fetchImpl = doclingFetch('# Factura A87240420', true);
    const deps = { db, docling: { ...docling, fetchImpl }, now, log: () => {} };

    const first = await extractAttachmentText(file, deps);
    expect(first).toMatchObject({
      method: 'ocr',
      markdown: '# Factura A87240420',
      sha256: sha256Hex(file.bytes),
    });
    const row = rows.get(attachmentCacheKey(first.sha256, 2))!;
    expect(rows.has(first.sha256)).toBe(false);
    expect(row.method).toBe('ocr');
    expect(row.expiresAt.toISOString()).toBe('2026-12-31T10:00:00.000Z');

    const second = await extractAttachmentText(file, deps);
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('otro límite de páginas no reutiliza la caché del anterior', async () => {
    const { db, rows } = fakeDb();
    const fetchImpl = doclingFetch('texto');
    const base = { db, now, log: () => {} };
    await extractAttachmentText(file, { ...base, docling: { ...docling, fetchImpl } });
    await extractAttachmentText(file, {
      ...base,
      docling: { ...docling, maxPages: 5, fetchImpl },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const sha = sha256Hex(file.bytes);
    expect([...rows.keys()].sort()).toEqual([`${sha}:p2`, `${sha}:p5`]);
  });

  it('vuelve a convertir si la entrada de caché ha caducado', async () => {
    const { db, rows } = fakeDb();
    rows.set(attachmentCacheKey(sha256Hex(file.bytes), 2), {
      markdown: 'viejo',
      method: 'texto',
      expiresAt: new Date('2026-10-01T00:00:00Z'),
    });
    const fetchImpl = doclingFetch('nuevo');
    const r = await extractAttachmentText(file, {
      db,
      docling: { ...docling, fetchImpl },
      now,
      log: () => {},
    });
    expect(r.markdown).toBe('nuevo');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(rows.get(attachmentCacheKey(r.sha256, 2))!.expiresAt > now).toBe(true);
  });

  it('si docling falla devuelve markdown vacío, lo registra y no cachea', async () => {
    const { db, rows } = fakeDb();
    const log = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('error', { status: 500 }));
    const r = await extractAttachmentText(file, {
      db,
      docling: { ...docling, fetchImpl },
      now,
      log,
    });
    expect(r).toMatchObject({ markdown: '', method: 'skipped' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('docling falló'));
    expect(rows.size).toBe(0);
  });

  it('avisa con onDegraded solo cuando docling no responde, no cuando el fichero no se convierte', async () => {
    const { db } = fakeDb();
    const onDegraded = vi.fn();
    const down = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    const r = await extractAttachmentText(file, {
      db,
      docling: { ...docling, fetchImpl: down },
      now,
      log: () => {},
      onDegraded,
    });
    expect(r.method).toBe('skipped');
    expect(onDegraded).toHaveBeenCalledWith(expect.stringContaining('docling respondió 503'));

    onDegraded.mockClear();
    const broken = vi.fn<typeof fetch>(async () => new Response('', { status: 422 }));
    await extractAttachmentText(file, {
      db,
      docling: { ...docling, fetchImpl: broken },
      now,
      log: () => {},
      onDegraded,
    });
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('omite tipos no soportados sin llamar a docling', async () => {
    const { db } = fakeDb();
    const fetchImpl = doclingFetch('x');
    const r = await extractAttachmentText(
      { name: 'datos.zip', contentType: 'application/zip', bytes: Buffer.from('z') },
      { db, docling: { ...docling, fetchImpl }, now, log: () => {} },
    );
    expect(r.method).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
