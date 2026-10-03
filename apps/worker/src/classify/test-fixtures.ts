import { SOCIEDADES, type ExtractedEmail } from '@clasificador/shared';

import type { RuleRecord } from './rules';

/** Correo mínimo para pruebas; `over` pisa cualquier campo. */
export function makeEmail(over: Partial<ExtractedEmail> = {}): ExtractedEmail {
  return {
    messageId: 'm1',
    conversationId: null,
    internetMessageId: null,
    receivedAt: new Date('2026-10-01T08:00:00Z'),
    fromAddress: 'facturas@proveedor.es',
    fromName: 'Proveedor',
    subject: '',
    bodyText: '',
    categories: [],
    attachments: [],
    ...over,
  };
}

export function makeAttachment(markdown: string, name = 'factura.pdf') {
  return {
    name,
    contentType: 'application/pdf',
    sha256: 'abc',
    markdown,
    method: 'text' as const,
  };
}

/** Reglas fuertes de las siete sociedades, como las deja la semilla. */
export function sociedadRules(): RuleRecord[] {
  return SOCIEDADES.flatMap((s) => [
    {
      id: `cif-${s.cif}`,
      type: 'cif' as const,
      value: s.cif,
      category: s.category,
      weight: 'fuerte' as const,
    },
    {
      id: `rs-${s.cif}`,
      type: 'razon_social' as const,
      value: s.razonSocial,
      category: s.category,
      weight: 'fuerte' as const,
    },
  ]);
}
