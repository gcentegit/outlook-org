import { describe, expect, it, vi } from 'vitest';

import { GraphClient } from '../graph/client';
import type { AttachmentTextCache } from './attachment-text';
import { extractEmail } from './extract-email';

const json = (body: unknown): Response => new Response(JSON.stringify(body));

describe('extractEmail', () => {
  it('ensambla el correo: cuerpo a texto, adjuntos convertidos u omitidos, sin los inline', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/attachments/ok/$value')) return new Response(Buffer.from('%PDF'));
      if (url.includes('/attachments?')) {
        const f = '#microsoft.graph.fileAttachment';
        return json({
          value: [
            {
              '@odata.type': f,
              id: 'ok',
              name: 'f.pdf',
              contentType: 'application/pdf',
              size: 100,
              isInline: false,
            },
            {
              '@odata.type': f,
              id: 'logo',
              name: 'logo.png',
              contentType: 'image/png',
              size: 100,
              isInline: true,
            },
            {
              '@odata.type': f,
              id: 'zip',
              name: 'a.zip',
              contentType: 'application/zip',
              size: 100,
              isInline: false,
            },
            {
              '@odata.type': f,
              id: 'big',
              name: 'grande.pdf',
              contentType: 'application/pdf',
              size: 99_999_999,
              isInline: false,
            },
          ],
        });
      }
      if (url.includes('/v1/convert/file')) {
        return json({
          status: 'success',
          document: { md_content: 'CIF A87240420' },
          confidence: { parse_score: 1, ocr_score: null },
        });
      }
      return json({
        id: 'm1',
        subject: null,
        from: { emailAddress: { name: 'Proveedor', address: 'p@prov.es' } },
        body: { contentType: 'html', content: '<p>Hola</p>' },
        categories: ['FOOD BOX'],
        hasAttachments: true,
        receivedDateTime: '2026-10-02T08:30:00Z',
        internetMessageId: '<abc@prov.es>',
        conversationId: 'conv1',
      });
    });
    const graph = new GraphClient({
      getToken: async () => 't',
      fetchImpl,
      baseUrl: 'https://g.test/v1.0',
    });
    const db: AttachmentTextCache = {
      attachmentText: { findUnique: async () => null, upsert: async () => ({}) },
    };

    const email = await extractEmail('m1', {
      graph,
      mailbox: 'p@x.es',
      db,
      docling: { url: 'http://docling.test', maxPages: 2, timeoutSeconds: 30, fetchImpl },
      maxAttachmentBytes: 1_000_000,
      log: () => {},
    });

    expect(email).toMatchObject({
      messageId: 'm1',
      conversationId: 'conv1',
      internetMessageId: '<abc@prov.es>',
      fromAddress: 'p@prov.es',
      fromName: 'Proveedor',
      subject: '',
      bodyText: 'Hola',
      categories: ['FOOD BOX'],
    });
    expect(email.receivedAt.toISOString()).toBe('2026-10-02T08:30:00.000Z');
    expect(email.attachments.map((a) => [a.name, a.method])).toEqual([
      ['f.pdf', 'text'],
      ['a.zip', 'skipped'],
      ['grande.pdf', 'skipped'],
    ]);
    expect(email.attachments[0]!.markdown).toBe('CIF A87240420');
    // El adjunto grande no se descargó.
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('/attachments/big/'))).toBe(false);
  });

  it('anota degradedReasons si docling no responde o la descarga falla por el servidor, y no si el adjunto ya no existe', async () => {
    const f = '#microsoft.graph.fileAttachment';
    const attachment = (id: string, name: string) => ({
      '@odata.type': f,
      id,
      name,
      contentType: 'application/pdf',
      size: 100,
      isInline: false,
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/attachments/a1/$value')) return new Response(Buffer.from('%PDF'));
      if (url.includes('/attachments/a2/$value')) return new Response('x', { status: 500 });
      if (url.includes('/attachments/a3/$value')) return new Response('x', { status: 404 });
      if (url.includes('/attachments?')) {
        return json({
          value: [
            attachment('a1', 'uno.pdf'),
            attachment('a2', 'dos.pdf'),
            attachment('a3', 'tres.pdf'),
          ],
        });
      }
      if (url.includes('/v1/convert/file')) return new Response('reiniciando', { status: 503 });
      return json({
        id: 'm1',
        subject: 'x',
        body: { contentType: 'text', content: 'hola' },
        hasAttachments: true,
        receivedDateTime: '2026-10-02T08:30:00Z',
      });
    });
    const graph = new GraphClient({
      getToken: async () => 't',
      fetchImpl,
      baseUrl: 'https://g.test/v1.0',
      maxRetries: 0,
    });
    const db: AttachmentTextCache = {
      attachmentText: { findUnique: async () => null, upsert: async () => ({}) },
    };
    const email = await extractEmail('m1', {
      graph,
      mailbox: 'p@x.es',
      db,
      docling: { url: 'http://docling.test', maxPages: 2, timeoutSeconds: 30, fetchImpl },
      maxAttachmentBytes: 1_000_000,
      log: () => {},
    });
    expect(email.attachments.map((a) => a.method)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(email.degradedReasons).toHaveLength(2);
    expect(email.degradedReasons?.[0]).toContain('uno.pdf');
    expect(email.degradedReasons?.[1]).toContain('dos.pdf');
  });

  it('sin fallos pasajeros no hay degradedReasons', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json({
        id: 'm1',
        subject: 'x',
        body: { contentType: 'text', content: 'hola' },
        hasAttachments: false,
        receivedDateTime: '2026-10-02T08:30:00Z',
      }),
    );
    const graph = new GraphClient({
      getToken: async () => 't',
      fetchImpl,
      baseUrl: 'https://g.test/v1.0',
    });
    const email = await extractEmail('m1', {
      graph,
      mailbox: 'p@x.es',
      db: { attachmentText: { findUnique: async () => null, upsert: async () => ({}) } },
      docling: { url: 'http://docling.test', maxPages: 2, timeoutSeconds: 30 },
      maxAttachmentBytes: 1,
      log: () => {},
    });
    expect(email.degradedReasons).toBeUndefined();
  });
});
