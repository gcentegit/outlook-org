import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DoclingUnavailableError,
  convertAttachment,
  detectAttachmentKind,
  hasTextLayer,
} from './docling';
import { makePdf } from './test-fixtures';

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

describe('hasTextLayer', () => {
  it('no cuenta las marcas de imagen ni los espacios', () => {
    expect(hasTextLayer('<!-- image -->\n\n<!-- image -->')).toBe(false);
    expect(hasTextLayer('Factura nº 12')).toBe(false);
    expect(hasTextLayer(`<!-- image -->\n${'Factura emitida a B12345678 '.repeat(3)}`)).toBe(true);
  });
});

describe('convertAttachment (servidor simulado)', () => {
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

  /** PDF que pdf.js no abre: va a docling como si no trajera texto. */
  const pdf = {
    bytes: Buffer.from('%PDF-1.4'),
    filename: 'f.pdf',
    mime: 'application/pdf',
    kind: 'pdf' as const,
  };
  const opts = () => ({ url, maxPages: 2, timeoutSeconds: 30 });

  const textPage = 'Factura emitida a B12345678 por suministro de mercancia. '.repeat(2);
  const pdfPage = 'Factura emitida a B12345678\npor suministro de mercancia del mes';
  const ok = (md: string, ocrScore: number | null = null) => ({
    status: 200,
    body: {
      status: 'success',
      document: { md_content: md },
      confidence: { parse_score: 1, ocr_score: ocrScore },
    },
  });

  it('un PDF con capa de texto se lee sin docling y con las páginas limitadas', async () => {
    received = [];
    const r = await convertAttachment(
      { ...pdf, bytes: makePdf([pdfPage, 'Segunda pagina', 'Tercera pagina']) },
      opts(),
    );
    expect(r).toEqual({ markdown: `${pdfPage}\fSegunda pagina`, method: 'text' });
    expect(received).toHaveLength(0);
  });

  it('un PDF sin capa de texto (escaneado) va a docling con RapidOCR y las páginas limitadas', async () => {
    received = [];
    reply = ok(textPage, 0.93);
    const r = await convertAttachment({ ...pdf, bytes: makePdf(['']) }, opts());
    expect(r).toEqual({ markdown: textPage.trim(), method: 'ocr' });
    expect(received).toHaveLength(1);
    const sent = received[0]!;
    expect(sent.path).toBe('/v1/convert/file');
    expect(sent.body).toMatch(/name="do_ocr"\r\n\r\ntrue/);
    expect(sent.body).toMatch(/name="ocr_preset"\r\n\r\nrapidocr/);
    expect(sent.body).toMatch(/name="do_table_structure"\r\n\r\nfalse/);
    expect(sent.body).toMatch(/name="to_formats"\r\n\r\nmd/);
    expect(sent.body.match(/name="page_range"\r\n\r\n(\d+)/g)).toHaveLength(2);
    expect(sent.body).toMatch(/name="page_range"\r\n\r\n2/);
  });

  it('un PDF que pdf.js no abre también se intenta con docling y OCR', async () => {
    received = [];
    reply = ok(textPage, 0.9);
    const r = await convertAttachment(pdf, opts());
    expect(r.method).toBe('ocr');
    expect(received).toHaveLength(1);
  });

  it('quita los caracteres nulos del texto de docling, que PostgreSQL no admite', async () => {
    reply = ok(`Factura\u0000 emitida\u0000 ${textPage}`);
    const r = await convertAttachment({ ...pdf, filename: 'f.xlsx', kind: 'xlsx' }, opts());
    expect(r.markdown).not.toContain('\u0000');
    expect(r.markdown.startsWith('Factura emitida')).toBe(true);
  });

  it('una imagen va directa al OCR y no limita páginas; un XLSX va a docling sin OCR', async () => {
    received = [];
    reply = ok('texto', 0.97);
    const r = await convertAttachment(
      { ...pdf, filename: 'f.png', mime: 'image/png', kind: 'image' },
      opts(),
    );
    expect(r.method).toBe('ocr');
    expect(received).toHaveLength(1);
    expect(received[0]!.body).toMatch(/name="do_ocr"\r\n\r\ntrue/);
    expect(received[0]!.body).not.toContain('page_range');

    received = [];
    reply = ok('');
    const x = await convertAttachment({ ...pdf, filename: 'f.xlsx', kind: 'xlsx' }, opts());
    expect(x).toEqual({ markdown: '', method: 'text' });
    expect(received).toHaveLength(1);
    expect(received[0]!.body).toMatch(/name="do_ocr"\r\n\r\nfalse/);
    expect(received[0]!.body).not.toContain('ocr_preset');
  });

  it('lanza error ante HTTP de error o estado de fallo', async () => {
    reply = { status: 500, body: { detail: 'boom' } };
    const failure = await convertAttachment(pdf, opts()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DoclingUnavailableError);
    expect((failure as Error).message).toMatch(/500/);
    reply = {
      status: 200,
      body: { status: 'failure', errors: [{ error_message: 'PDF corrupto' }] },
    };
    await expect(convertAttachment(pdf, opts())).rejects.toThrow(/PDF corrupto/);
  });

  it('distingue docling caído (503, red cortada) de un fichero que no se convierte', async () => {
    reply = { status: 503, body: { detail: 'reiniciando' } };
    await expect(convertAttachment(pdf, opts())).rejects.toBeInstanceOf(DoclingUnavailableError);
    reply = { status: 422, body: { detail: 'formato' } };
    const bad = await convertAttachment(pdf, opts()).catch((e: unknown) => e);
    expect(bad).not.toBeInstanceOf(DoclingUnavailableError);
    await expect(
      convertAttachment(pdf, { ...opts(), url: 'http://127.0.0.1:1' }),
    ).rejects.toBeInstanceOf(DoclingUnavailableError);
  });
});
