import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DoclingUnavailableError,
  convertWithDocling,
  detectAttachmentKind,
  hasTextLayer,
} from './docling';

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

describe('convertWithDocling (servidor simulado)', () => {
  let server: Server;
  let url: string;
  let received: { path: string; body: string }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  /** Respuestas en orden para las siguientes peticiones; vacía, se usa `reply`. */
  let queue: { status: number; body: unknown }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', body: Buffer.concat(chunks).toString('latin1') });
        const next = queue.shift() ?? reply;
        res.writeHead(next.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next.body));
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

  const textPage = 'Factura emitida a B12345678 por suministro de mercancía. '.repeat(2);
  const ok = (md: string, ocrScore: number | null = null) => ({
    status: 200,
    body: {
      status: 'success',
      document: { md_content: md },
      confidence: { parse_score: 1, ocr_score: ocrScore },
    },
  });

  it('un PDF con texto se lee en una sola pasada, sin OCR ni tablas y con las páginas limitadas', async () => {
    received = [];
    reply = ok(` ${textPage}\n`);
    const r = await convertWithDocling(pdf, opts());
    expect(r).toEqual({ markdown: textPage.trim(), method: 'text' });
    expect(received).toHaveLength(1);
    const sent = received[0]!;
    expect(sent.path).toBe('/v1/convert/file');
    expect(sent.body).toMatch(/name="do_ocr"\r\n\r\nfalse/);
    expect(sent.body).toMatch(/name="do_table_structure"\r\n\r\nfalse/);
    expect(sent.body).not.toContain('ocr_preset');
    expect(sent.body).toMatch(/name="to_formats"\r\n\r\nmd/);
    expect(sent.body.match(/name="page_range"\r\n\r\n(\d+)/g)).toHaveLength(2);
    expect(sent.body).toMatch(/name="page_range"\r\n\r\n2/);
  });

  it('un PDF sin capa de texto (escaneado) se repite con RapidOCR', async () => {
    received = [];
    queue = [ok('<!-- image -->'), ok(textPage, 0.93)];
    const r = await convertWithDocling(pdf, opts());
    expect(r).toEqual({ markdown: textPage.trim(), method: 'ocr' });
    expect(received).toHaveLength(2);
    expect(received[1]!.body).toMatch(/name="do_ocr"\r\n\r\ntrue/);
    expect(received[1]!.body).toMatch(/name="ocr_preset"\r\n\r\nrapidocr/);
  });

  it('una imagen va directa al OCR y no limita páginas; un XLSX nunca pasa por OCR', async () => {
    received = [];
    reply = ok('texto', 0.97);
    const r = await convertWithDocling(
      { ...pdf, filename: 'f.png', mime: 'image/png', kind: 'image' },
      opts(),
    );
    expect(r.method).toBe('ocr');
    expect(received).toHaveLength(1);
    expect(received[0]!.body).toMatch(/name="do_ocr"\r\n\r\ntrue/);
    expect(received[0]!.body).not.toContain('page_range');

    received = [];
    reply = ok('');
    const x = await convertWithDocling({ ...pdf, filename: 'f.xlsx', kind: 'xlsx' }, opts());
    expect(x).toEqual({ markdown: '', method: 'text' });
    expect(received).toHaveLength(1);
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
