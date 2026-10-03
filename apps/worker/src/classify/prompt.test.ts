import { SOCIEDADES } from '@clasificador/shared';
import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, buildUserPrompt, firstPage } from './prompt';
import { makeAttachment, makeEmail } from './test-fixtures';

describe('buildSystemPrompt', () => {
  it('incluye las siete sociedades con su CIF', () => {
    const prompt = buildSystemPrompt();
    for (const s of SOCIEDADES) {
      expect(prompt).toContain(s.razonSocial);
      expect(prompt).toContain(s.cif);
    }
  });
});

describe('firstPage', () => {
  it('corta en el primer salto de página', () => {
    expect(firstPage('uno\fdos')).toBe('uno');
    expect(firstPage('uno\n<!-- page break -->\ndos')).toBe('uno');
    expect(firstPage('todo seguido')).toBe('todo seguido');
  });
});

describe('buildUserPrompt', () => {
  it('lleva asunto, cuerpo y solo la primera página de cada adjunto', () => {
    const email = makeEmail({
      subject: 'Asunto X',
      bodyText: 'Cuerpo Y',
      attachments: [
        makeAttachment('pág uno\fpág dos', 'a.pdf'),
        makeAttachment('otro doc', 'b.pdf'),
      ],
    });
    const prompt = buildUserPrompt(email, ['LATERAL'], 10_000);
    expect(prompt).toContain('Asunto X');
    expect(prompt).toContain('Cuerpo Y');
    expect(prompt).toContain('pág uno');
    expect(prompt).not.toContain('pág dos');
    expect(prompt).toContain('otro doc');
  });

  it('trunca al máximo configurado y marca el recorte', () => {
    const email = makeEmail({
      subject: 'S',
      bodyText: 'c'.repeat(5000),
      attachments: [makeAttachment('a'.repeat(5000)), makeAttachment('b'.repeat(5000))],
    });
    const prompt = buildUserPrompt(email, ['LATERAL'], 1000);
    const segments = [...prompt.matchAll(/<(cuerpo|adjunto)[^>]*>\n([\s\S]*?)\n<\/\1>/g)].map(
      (m) => m[2] ?? '',
    );
    expect(segments).toHaveLength(3);
    // asunto (1 carácter) + cuerpo + adjuntos nunca superan el máximo configurado.
    expect(1 + segments.reduce((sum, t) => sum + t.length, 0)).toBeLessThanOrEqual(1000);
    expect(prompt).toContain('[…texto truncado]');
  });

  it('sin adjuntos el cuerpo usa todo el presupuesto', () => {
    const prompt = buildUserPrompt(makeEmail({ bodyText: 'x'.repeat(900) }), ['LATERAL'], 1000);
    expect(prompt).not.toContain('truncado');
  });

  it('omite adjuntos sin texto', () => {
    const prompt = buildUserPrompt(
      makeEmail({ attachments: [makeAttachment('')] }),
      ['LATERAL'],
      1000,
    );
    expect(prompt).not.toContain('<adjunto');
  });
});
