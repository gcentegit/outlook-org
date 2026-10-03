import { describe, expect, it } from 'vitest';

import { makeAttachment, makeEmail } from '../classify/test-fixtures';
import { findDiscrepancies, formatDiscrepanciesMarkdown } from './discrepancies';

describe('findDiscrepancies', () => {
  it('detecta la categoría que las reglas fuertes ven y el equipo no puso', () => {
    const arturoSoria = makeEmail({
      messageId: 'a',
      subject: 'Lateral Arturo Soria',
      attachments: [makeAttachment('Cliente: LATERAL IBERIA, S.L. CIF B88300413')],
    });
    const correcto = makeEmail({
      messageId: 'b',
      attachments: [makeAttachment('Cliente: FOODBOX, S.A. A87240420')],
    });
    const sinNada = makeEmail({ messageId: 'c', bodyText: 'hola' });

    const found = findDiscrepancies([
      { email: arturoSoria, expected: ['Pte ok', 'Elena'] },
      { email: correcto, expected: ['FOOD BOX'] },
      { email: sinNada, expected: [] },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ messageId: 'a', missing: ['LATERAL'] });
    expect(found[0]?.reasons[0]).toContain('B88300413');
    expect(found[0]?.teamCategories).toEqual(['Pte ok', 'Elena']);

    const md = formatDiscrepanciesMarkdown(found, 3);
    expect(md).toContain('1 de 3 correos');
    expect(md).toContain('Lateral Arturo Soria');
  });
});
