import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Texto propio (capa de texto) de las primeras `maxPages` páginas de un PDF, sin OCR. Las páginas
 * van separadas por un salto de página (\f), el separador que entiende `firstPage` del prompt.
 * Un PDF escaneado devuelve poco o nada: quien llama decide si pasa por OCR.
 *
 * Lanza un error si el PDF no se deja abrir (dañado o cifrado) o si se pasa de `timeoutSeconds`.
 */
export async function readPdfTextLayer(
  bytes: Buffer,
  options: { maxPages: number; timeoutSeconds: number },
): Promise<string> {
  // pdf.js se queda con el buffer que recibe: se le pasa una copia.
  const task = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`lectura del PDF: más de ${options.timeoutSeconds} s`)),
      options.timeoutSeconds * 1000,
    );
  });
  try {
    return await Promise.race([readPages(task.promise, options.maxPages), timeout]);
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

async function readPages(loading: Promise<PdfDocument>, maxPages: number): Promise<string> {
  const pdf = await loading;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    pages.push(text.trim());
    page.cleanup();
  }
  // La capa de texto de algunos PDF trae caracteres nulos, que PostgreSQL no admite en un texto.
  return pages.join('\f').replaceAll('\u0000', '').trim();
}
