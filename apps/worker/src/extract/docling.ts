export type AttachmentKind = 'pdf' | 'image' | 'docx' | 'xlsx';

const KINDS: Record<string, { kind: AttachmentKind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  tif: { kind: 'image', mime: 'image/tiff' },
  tiff: { kind: 'image', mime: 'image/tiff' },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    kind: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/tiff': 'tiff',
  [KINDS.docx!.mime]: 'docx',
  [KINDS.xlsx!.mime]: 'xlsx',
};

/**
 * Tipo soportado de un adjunto, o null si se omite. Manda la extensión del nombre;
 * Outlook a veces etiqueta los ficheros como `application/octet-stream`, así que el
 * tipo MIME solo se usa cuando el nombre no aporta nada.
 */
export function detectAttachmentKind(
  name: string,
  contentType: string,
): { kind: AttachmentKind; mime: string; filename: string } | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const byExt = ext ? KINDS[ext] : undefined;
  if (byExt) return { ...byExt, filename: name };
  const mimeExt = MIME_TO_EXT[contentType.split(';')[0]!.trim().toLowerCase()];
  const byMime = mimeExt ? KINDS[mimeExt] : undefined;
  return byMime ? { ...byMime, filename: `${name}.${mimeExt}` } : null;
}

/**
 * docling no está disponible ahora mismo (conexión rechazada o cortada, tiempo agotado, 408, 429,
 * 502, 503 o 504): reintentar más tarde puede funcionar. Un fallo de conversión del fichero (un
 * 4xx, un 500 o `status: failure`) es otra cosa y no lanza este error.
 */
export class DoclingUnavailableError extends Error {
  override name = 'DoclingUnavailableError';
}

const UNAVAILABLE_STATUS = new Set([408, 429, 502, 503, 504]);

export interface DoclingOptions {
  /** URL base de docling-serve, p. ej. http://docling:5001. */
  url: string;
  /** Páginas que se convierten (desde la primera) en PDF; el CIF del cliente suele estar en la primera. */
  maxPages: number;
  timeoutSeconds: number;
  fetchImpl?: typeof fetch;
}

export interface DoclingResult {
  markdown: string;
  method: 'text' | 'ocr';
}

interface DoclingResponse {
  status?: string;
  errors?: { error_message?: string }[];
  document?: { md_content?: string | null };
  confidence?: { ocr_score?: number | null } | null;
}

/**
 * Convierte un fichero a Markdown con docling-serve (`/v1/convert/file`, OCR RapidOCR).
 *
 * Criterio de `method`: docling no indica explícitamente si hubo OCR. Se usa su puntuación de
 * confianza: `confidence.ocr_score` solo viene informada si el motor de OCR llegó a leer algo
 * (escaneos, imágenes o PDF con bitmaps con texto); en un PDF con capa de texto es null y
 * solo se informa `parse_score`. Si `ocr_score` existe, el método es 'ocr'; si no, 'text'.
 *
 * Lanza un error si docling falla; quien llama decide cómo degradar. Si docling no responde
 * (red, tiempo agotado, 502/503/504) lanza `DoclingUnavailableError`.
 */
export async function convertWithDocling(
  file: { bytes: Buffer; filename: string; mime: string; kind: AttachmentKind },
  options: DoclingOptions,
): Promise<DoclingResult> {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');
  form.append('ocr_preset', 'rapidocr');
  form.append('include_images', 'false');
  form.append('image_export_mode', 'placeholder');
  form.append('document_timeout', String(options.timeoutSeconds));
  if (file.kind === 'pdf') {
    // page_range es un par [desde, hasta], con la primera página = 1.
    form.append('page_range', '1');
    form.append('page_range', String(options.maxPages));
  }

  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(`${options.url.replace(/\/$/, '')}/v1/convert/file`, {
      method: 'POST',
      body: form,
      // Margen sobre el tiempo máximo del propio docling.
      signal: AbortSignal.timeout((options.timeoutSeconds + 15) * 1000),
    });
  } catch (err) {
    throw new DoclingUnavailableError(
      `docling no responde: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (UNAVAILABLE_STATUS.has(res.status)) {
      throw new DoclingUnavailableError(`docling respondió ${res.status}: ${detail}`);
    }
    throw new Error(`docling respondió ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as DoclingResponse;
  if (body.status !== 'success' && body.status !== 'partial_success') {
    const reason = body.errors?.map((e) => e.error_message).join('; ') || body.status;
    throw new Error(`docling no pudo convertir ${file.filename}: ${reason}`);
  }
  return {
    markdown: (body.document?.md_content ?? '').trim(),
    method: body.confidence?.ocr_score != null ? 'ocr' : 'text',
  };
}
