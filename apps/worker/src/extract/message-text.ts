import { convert } from 'html-to-text';

/**
 * Cuerpo del mensaje en texto plano: el HTML se convierte; el texto se devuelve tal cual. Cada celda
 * de tabla va en su propio bloque: juntas, un CIF al final de una celda se pegaría al texto de la
 * siguiente ("A87240420Calle…") y las reglas, que lo piden como palabra completa, no lo verían.
 */
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
      { selector: 'td', format: 'block' },
      { selector: 'th', format: 'block' },
    ],
  }).trim();
}
