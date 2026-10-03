import { describe, expect, it, vi } from 'vitest';

import {
  applyCandidates,
  formatCandidatesMarkdown,
  isProposable,
  proposeCandidates,
} from './candidates';
import { DEFAULT_GENERIC_DOMAINS } from './config';
import { subjectNgrams } from './keywords';
import type { HistoryMessage } from './types';

let counter = 0;
function mail(from: string, subject: string, categories: string[]): HistoryMessage {
  counter++;
  return {
    id: `m${counter}`,
    folderId: 'f',
    folderPath: 'Bandeja',
    subject,
    fromAddress: from,
    fromName: null,
    receivedAt: '2026-06-01T00:00:00.000Z',
    categories,
    hasAttachments: false,
    conversationId: null,
    internetMessageId: null,
  };
}
const many = (n: number, from: string, subject: string, categories: string[]) =>
  Array.from({ length: n }, () => mail(from, subject, categories));

const options = {
  minOccurrences: 5,
  minPurity: 0.98,
  genericDomains: new Set<string>(DEFAULT_GENERIC_DOMAINS),
  internalDomains: new Set(['ejemplo.com', 'grupo.example']),
};

describe('subjectNgrams', () => {
  it('normaliza, quita palabras vacías en los extremos y genera 1-3 gramas', () => {
    const grams = subjectNgrams('RE: Factura de Compra — Pedido 2026');
    expect(grams).toContain('factura');
    expect(grams).toContain('factura de compra');
    expect(grams).toContain('compra');
    expect(grams).toContain('pedido');
    expect(grams).not.toContain('re');
    expect(grams).not.toContain('de');
    expect(grams).not.toContain('de compra');
    expect(grams).not.toContain('2026');
    expect(grams).not.toContain('compra pedido 2026');
  });
});

describe('proposeCandidates', () => {
  it('propone remitente y dominio con pureza ≥ 98 % y mínimo de apariciones', () => {
    const msgs = [
      ...many(50, 'a@limpio.es', 'x', ['LATERAL']), // 50/50
      ...many(49, 'b@casi.es', 'x', ['FOOD BOX']),
      ...many(1, 'b@casi.es', 'x', []), // 49/50 = 98 %: cumple
      ...many(48, 'c@sucio.es', 'x', ['FOOD BOX']),
      ...many(2, 'c@sucio.es', 'x', []), // 96 %: no
      ...many(4, 'd@poco.es', 'x', ['LATERAL']), // por debajo del mínimo
    ];
    const found = proposeCandidates(msgs, options);
    const sig = found
      .filter((c) => c.type !== 'palabra_clave')
      .map((c) => `${c.type}:${c.value}:${c.category}`);
    expect(sig).toContain('dominio:limpio.es:LATERAL');
    expect(sig).toContain('dominio:casi.es:FOOD BOX');
    expect(sig.some((s) => s.includes('sucio.es'))).toBe(false);
    expect(sig.some((s) => s.includes('poco.es'))).toBe(false);
    expect(found.every((c) => c.weight === 'medio' && c.active === false)).toBe(true);
  });

  it('no propone el remitente cuando su dominio ya cumple, pero sí si solo cumple él', () => {
    const msgs = [
      ...many(6, 'a@mixto.es', 'x', ['LATERAL']),
      ...many(6, 'b@mixto.es', 'x', ['FOOD BOX']),
    ];
    const found = proposeCandidates(msgs, options).filter((c) => c.type !== 'palabra_clave');
    expect(found.map((c) => `${c.type}:${c.value}`).sort()).toEqual([
      'remitente:a@mixto.es',
      'remitente:b@mixto.es',
    ]);
  });

  it('los correos sin categoría cuentan en contra del dominio y del remitente', async () => {
    const msgs = [
      ...many(10, 'x@gmail.com', 'x', ['ARCOBETA']),
      ...many(10, 'y@gmail.com', 'x', []),
      ...many(8, 'z@gmail.com', 'x', ['LATERAL']),
    ];
    // gmail.com: 8/28 de LATERAL y 10/28 de ARCOBETA, no cumple; los remitentes sí individualmente.
    const found = proposeCandidates(msgs, options);
    expect(found.some((c) => c.type === 'dominio')).toBe(false);
    expect(
      found
        .filter((c) => c.type === 'remitente')
        .map((c) => c.value)
        .sort(),
    ).toEqual(['x@gmail.com', 'z@gmail.com']);
  });

  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'outlook.es',
    'hotmail.com',
    'hotmail.es',
    'live.com',
    'msn.com',
    'yahoo.com',
    'yahoo.es',
    'icloud.com',
    'me.com',
    'proton.me',
    'protonmail.com',
    'gmx.com',
    'gmx.es',
  ])('nunca propone una regla de dominio entero para %s, aunque cumpla el umbral', (domain) => {
    const found = proposeCandidates(many(30, `alguien@${domain}`, 'x', ['LATERAL']), options);
    expect(found.some((c) => c.type === 'dominio')).toBe(false);
    // La dirección concreta sí puede proponerse: cumple el umbral y el mínimo de apariciones.
    expect(
      found.filter((c) => c.type === 'remitente').map((c) => `${c.value}:${c.category}`),
    ).toEqual([`alguien@${domain}:LATERAL`]);
  });

  it('la dirección de un dominio genérico respeta el umbral y el mínimo de apariciones', () => {
    const msgs = [
      ...many(4, 'poco@gmail.com', 'x', ['LATERAL']), // por debajo del mínimo
      ...many(40, 'mezcla@gmail.com', 'x', ['LATERAL']),
      ...many(10, 'mezcla@gmail.com', 'x', ['FOOD BOX']), // 80 %: no cumple
    ];
    const found = proposeCandidates(msgs, options);
    expect(found.filter((c) => c.type !== 'palabra_clave')).toEqual([]);
  });

  it('nunca propone reglas con los dominios internos, ni de dominio ni de dirección', () => {
    const msgs = [
      ...many(40, 'admin@ejemplo.com', 'x', ['FOOD BOX']),
      ...many(40, 'ana@ejemplo.com', 'x', ['LATERAL']),
      ...many(40, 'bea@compras.ejemplo.com', 'x', ['ARCOBETA']),
      ...many(40, 'ext@proveedor.es', 'x', ['LATERAL']),
    ];
    const found = proposeCandidates(msgs, options).filter((c) => c.type !== 'palabra_clave');
    expect(found.map((c) => `${c.type}:${c.value}`)).toEqual(['dominio:proveedor.es']);
  });

  it('un dominio interno configurado de más también se excluye', () => {
    const msgs = many(30, 'x@lateral.example', 'x', ['LATERAL']);
    const withExtra = { ...options, internalDomains: new Set(['ejemplo.com', 'lateral.example']) };
    expect(proposeCandidates(msgs, withExtra).filter((c) => c.type !== 'palabra_clave')).toEqual(
      [],
    );
    expect(proposeCandidates(msgs, options).some((c) => c.type === 'dominio')).toBe(true);
  });

  it('el dominio se compara sin distinguir mayúsculas', () => {
    expect(isProposable({ type: 'remitente', value: 'Ana@Ejemplo.com' }, options)).toBe(false);
    expect(isProposable({ type: 'dominio', value: 'GMAIL.com' }, options)).toBe(false);
    expect(isProposable({ type: 'remitente', value: 'Ana@Gmail.com' }, options)).toBe(true);
    expect(isProposable({ type: 'palabra_clave', value: 'gmail.com' }, options)).toBe(true);
  });

  it('propone palabras clave del asunto sin stopwords y sin redundancias', () => {
    const msgs = [
      ...many(6, 'a@a.es', 'Factura Lateral Santa Ana', ['LATERAL']),
      ...many(6, 'b@b.es', 'Factura de la compra', ['FOOD BOX']),
      ...many(6, 'c@c.es', 'Factura de la compra', ['FOOD BOX']),
    ];
    const kw = proposeCandidates(msgs, options)
      .filter((c) => c.type === 'palabra_clave')
      .map((c) => `${c.category}:${c.value}`);
    expect(kw).toContain('LATERAL:lateral');
    expect(kw).toContain('FOOD BOX:compra');
    // "factura" aparece con ambas categorías: no llega a la pureza.
    expect(kw.some((k) => k.endsWith(':factura'))).toBe(false);
    // "lateral santa" tiene las mismas apariciones que "lateral": redundante.
    expect(kw).not.toContain('LATERAL:lateral santa');
    expect(kw.some((k) => /:(de|la)$/.test(k))).toBe(false);
  });

  it('ARCOBETA sin etiquetados no genera candidatas y la tabla lo dice', () => {
    const found = proposeCandidates(many(6, 'a@a.es', 'hola mundo', ['LATERAL']), options);
    const md = formatCandidatesMarkdown(found, {
      devMessages: 6,
      options,
      generatedAt: '02/10/2026',
    });
    expect(md).toContain('## ARCOBETA (0)');
    expect(md).toContain('Sin candidatas.');
    expect(md).toContain('| dominio | a.es |');
  });
});

describe('applyCandidates', () => {
  it('carga las candidatas inactivas sin tocar las existentes', async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    const candidates = proposeCandidates(many(6, 'a@a.es', 'x', ['LATERAL']), options);
    const result = await applyCandidates({ rule: { createMany } } as never, candidates, options);
    expect(result).toEqual({ created: 2, existing: candidates.length - 2, skipped: 0 });
    const args = (
      createMany.mock.calls[0] as unknown as [
        { data: { active: boolean; weight: string }[]; skipDuplicates: boolean },
      ]
    )[0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data.every((r) => r.active === false && r.weight === 'medio')).toBe(true);
  });

  it('no carga reglas prohibidas aunque vengan en un fichero de candidatas antiguo', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const base = {
      category: 'LATERAL',
      weight: 'medio',
      active: false,
      total: 9,
      hits: 9,
      purity: 1,
    };
    const stale = [
      { ...base, id: 'c1', type: 'dominio', value: 'gmail.com' },
      { ...base, id: 'c2', type: 'dominio', value: 'ejemplo.com' },
      { ...base, id: 'c3', type: 'remitente', value: 'ana@ejemplo.com' },
      { ...base, id: 'c4', type: 'remitente', value: 'alguien@gmail.com' },
      { ...base, id: 'c5', type: 'palabra_clave', value: 'lateral' },
    ] as never[];
    const result = await applyCandidates({ rule: { createMany } } as never, stale, options);
    const loaded = (createMany.mock.calls[0] as unknown as [{ data: { value: string }[] }])[0].data;
    expect(loaded.map((r) => r.value)).toEqual(['alguien@gmail.com', 'lateral']);
    expect(result).toEqual({ created: 1, existing: 1, skipped: 3 });
  });
});
