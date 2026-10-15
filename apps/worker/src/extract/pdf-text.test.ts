import { describe, expect, it } from 'vitest';

import { readPdfTextLayer } from './pdf-text';
import { makePdf } from './test-fixtures';

const opts = { maxPages: 2, timeoutSeconds: 30 };

describe('readPdfTextLayer', () => {
  it('lee la capa de texto de las primeras páginas, separadas por un salto de página', async () => {
    const pdf = makePdf(['Factura a B12345678', 'Condiciones de pago', 'Anexo sin interes']);
    expect(await readPdfTextLayer(pdf, opts)).toBe('Factura a B12345678\fCondiciones de pago');
  });

  it('una página sin capa de texto (escaneo) no aporta texto', async () => {
    expect(await readPdfTextLayer(makePdf(['']), opts)).toBe('');
  });

  it('no modifica el buffer que recibe', async () => {
    const pdf = makePdf(['Factura']);
    const copy = Buffer.from(pdf);
    await readPdfTextLayer(pdf, opts);
    expect(pdf.equals(copy)).toBe(true);
  });

  it('lanza error si el fichero no es un PDF válido', async () => {
    await expect(readPdfTextLayer(Buffer.from('%PDF-1.4 roto'), opts)).rejects.toThrow();
  });
});
