import { convert } from 'html-to-text';

/** Cuerpo del mensaje en texto plano: el HTML se convierte; el texto se devuelve tal cual. */
export function bodyToText(
  body: { contentType: 'html' | 'text'; content: string } | null | undefined,
): string {
  if (!body?.content) return '';
  if (body.contentType === 'text') return body.content.trim();
  return convert(body.content, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'script', format: 'skip' },
    ],
  }).trim();
}
