import type { ExtractedEmail } from '@clasificador/shared';

import { defaultRules } from './default-rules';
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
  return defaultRules();
}
