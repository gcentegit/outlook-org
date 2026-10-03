import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DoclingUnavailableError, convertWithDocling, detectAttachmentKind } from './docling';

describe('detectAttachmentKind', () => {
  it('reconoce PDF, imágenes, DOCX y XLSX por extensión aunque el MIME sea genérico', () => {
    expect(detectAttachmentKind('Factura.PDF', 'application/octet-stream')?.kind).toBe('pdf');
    expect(detectAttachmentKind('scan.tif', 'image/tiff')?.kind).toBe('image');
    expect(detectAttachmentKind('a.docx', '')?.kind).toBe('docx');
    expect(detectAttachmentKind('a.xlsx', '')?.kind).toBe('xlsx');
  });

  it('recurre al MIME si el nombre no tiene extensión útil y omite el resto', () => {
    expect(detectAttachmentKind('factura', 'application/pdf')?.filename).toBe('factura.pdf');
    expect(detectAttachmentKind('datos.zip', 'application/zip')).toBeNull();
    expect(detectAttachmentKind('nota.txt', 'text/plain')).toBeNull();
  });
});

describe('convertWithDocling (servidor simulado)', () => {
  let server: Server;
  let url: string;
  let received: { path: string; body: string }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', body: Buffer.concat(chunks).toString('latin1') });
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const pdf = {
    bytes: Buffer.from('%PDF-1.4'),
    filename: 'f.pdf',
    mime: 'application/pdf',
    kind: 'pdf' as const,
  };
  const opts = () => ({ url, maxPages: 2, timeoutSeconds: 30 });

  it('pide Markdown con RapidOCR y limita las páginas', async () => {
    received = [];
    reply = {
      status: 200,
      body: {
        status: 'success',
        document: { md_content: ' # Factura\n' },
        confidence: { parse_score: 1, ocr_score: null },
      },
    };
    const r = await convertWithDocling(pdf, opts());
    expect(r).toEqual({ markdown: '# Factura', method: 'text' });
    const sent = received[0]!;
    expect(sent.path).toBe('/v1/convert/file');
    expect(sent.body).toMatch(/name="ocr_preset"\r\n\r\nrapidocr/);
    expect(sent.body).toMatch(/name="to_formats"\r\n\r\nmd/);
    expect(sent.body.match(/name="page_range"\r\n\r\n(\d+)/g)).toHaveLength(2);
    expect(sent.body).toMatch(/name="page_range"\r\n\r\n2/);
  });

  it('marca method=ocr cuando docling informa ocr_score y no limita páginas fuera de PDF', async () => {
    received = [];
    reply = {
      status: 200,
      body: {
        status: 'success',
        document: { md_content: 'texto' },
        confidence: { parse_score: null, ocr_score: 0.97 },
      },
    };
    const r = await convertWithDocling(
      { ...pdf, filename: 'f.png', mime: 'image/png', kind: 'image' },
      opts(),
    );
    expect(r.method).toBe('ocr');
    expect(received[0]!.body).not.toContain('page_range');
  });

  it('lanza error ante HTTP de error o estado de fallo', async () => {
    reply = { status: 500, body: { detail: 'boom' } };
    const failure = await convertWithDocling(pdf, opts()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DoclingUnavailableError);
    expect((failure as Error).message).toMatch(/500/);
    reply = {
      status: 200,
      body: { status: 'failure', errors: [{ error_message: 'PDF corrupto' }] },
    };
    await expect(convertWithDocling(pdf, opts())).rejects.toThrow(/PDF corrupto/);
  });

  it('distingue docling caído (503, red cortada) de un fichero que no se convierte', async () => {
    reply = { status: 503, body: { detail: 'reiniciando' } };
    await expect(convertWithDocling(pdf, opts())).rejects.toBeInstanceOf(DoclingUnavailableError);
    reply = { status: 422, body: { detail: 'formato' } };
    const bad = await convertWithDocling(pdf, opts()).catch((e: unknown) => e);
    expect(bad).not.toBeInstanceOf(DoclingUnavailableError);
    await expect(
      convertWithDocling(pdf, { ...opts(), url: 'http://127.0.0.1:1' }),
    ).rejects.toBeInstanceOf(DoclingUnavailableError);
  });
});
