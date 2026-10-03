import { describe, expect, it } from 'vitest';

import { bodyToText } from './message-text';

describe('bodyToText', () => {
  it('convierte HTML a texto sin enlaces, imágenes ni estilos', () => {
    const html =
      '<style>p{color:red}</style><p>Hola,</p><p>Adjunto la <a href="https://x.es/f">factura</a>.</p><img src="cid:logo">';
    expect(bodyToText({ contentType: 'html', content: html })).toBe('Hola,\n\nAdjunto la factura.');
  });

  it('devuelve el texto plano tal cual y cadena vacía sin cuerpo', () => {
    expect(bodyToText({ contentType: 'text', content: ' hola \n' })).toBe('hola');
    expect(bodyToText(null)).toBe('');
  });
});
