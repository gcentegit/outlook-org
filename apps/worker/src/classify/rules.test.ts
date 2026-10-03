import { describe, expect, it } from 'vitest';

import {
  cifPattern,
  evaluateRules,
  foldText,
  forwardedBlock,
  isInternalSender,
  razonSocialPattern,
  type RuleRecord,
} from './rules';
import { makeAttachment, makeEmail, sociedadRules } from './test-fixtures';

const cifRule = (value: string, category: string, weight: RuleRecord['weight'] = 'fuerte') =>
  ({ id: `cif-${value}`, type: 'cif', value, category, weight }) satisfies RuleRecord;

describe('cifPattern', () => {
  const pattern = cifPattern('B85554921') as RegExp;

  it.each([
    'B85554921',
    'b85554921',
    'ESB85554921',
    'ES B85554921',
    'ES-B85554921',
    'B-85554921',
    'B 85554921',
    'B-85.554.921',
    'B 85 554 921',
    'CIF: B85554921.',
    'NIF:ES B-85.554.921,',
  ])('reconoce %s', (text) => {
    expect(pattern.test(text)).toBe(true);
  });

  it.each(['B855549210', 'XB85554921', 'B8555492', 'B85554922', 'IBAN ES12 3456 B85554 92'])(
    'no reconoce %s',
    (text) => {
      expect(pattern.test(text)).toBe(false);
    },
  );

  it('acepta el valor con prefijo ES o separadores', () => {
    expect(cifPattern('ES-B-85.554.921')?.test('B85554921')).toBe(true);
  });

  it('rechaza valores que no son un CIF', () => {
    expect(cifPattern('123')).toBeNull();
  });
});

describe('razonSocialPattern', () => {
  const foodbox = razonSocialPattern('FOODBOX, S.A.') as RegExp;
  const test = (re: RegExp, text: string) => re.test(foldText(text));

  it.each([
    'FOODBOX, S.A.',
    'Foodbox SA',
    'FOODBOX , S.A',
    'foodbox s.a.',
    'FOODBOX S.L.',
    'Foodbox,  S.A.U.',
  ])('reconoce %s', (text) => {
    expect(test(foodbox, text)).toBe(true);
  });

  it.each(['admin@foodbox.example', 'Equipo Foodbox', 'foodboxes SA', 'FOODBOX'])(
    'no reconoce %s (sin forma societaria o parte de otra palabra)',
    (text) => {
      expect(test(foodbox, text)).toBe(false);
    },
  );

  it('ignora acentos y mayúsculas', () => {
    const re = razonSocialPattern('GRUPO RESTAURACION LATERAL, S.L.') as RegExp;
    expect(test(re, 'Grupo Restauración Lateral SL')).toBe(true);
  });

  it('un valor sin forma societaria no la exige', () => {
    const re = razonSocialPattern('ARCO BETA') as RegExp;
    expect(test(re, 'pedido de Arco Beta')).toBe(true);
  });
});

describe('evaluateRules', () => {
  const rules = sociedadRules();

  it('detecta el CIF de una sociedad en el Markdown de un adjunto', () => {
    const email = makeEmail({
      attachments: [makeAttachment('Cliente\nLATERAL CONSELL\nCIF: B-86.898.491')],
    });
    const ev = evaluateRules(email, rules);
    expect(ev.LATERAL.strong.map((h) => h.ruleId)).toEqual(['cif-B86898491']);
    expect(ev['FOOD BOX'].strong).toEqual([]);
    expect(ev.ARCOBETA.strong).toEqual([]);
  });

  it('busca el CIF en asunto y cuerpo', () => {
    const subject = evaluateRules(makeEmail({ subject: 'Factura NIF A87240420' }), rules);
    const body = evaluateRules(makeEmail({ bodyText: 'cif es-a-87.240.420' }), rules);
    expect(subject['FOOD BOX'].strong).toHaveLength(1);
    expect(body['FOOD BOX'].strong).toHaveLength(1);
  });

  it('es multietiqueta: dos sociedades en el mismo correo', () => {
    const email = makeEmail({
      attachments: [
        makeAttachment('FOODBOX SA A87240420'),
        makeAttachment('ARCO BETA, SL B87694121'),
      ],
    });
    const ev = evaluateRules(email, rules);
    expect(ev['FOOD BOX'].strong.length).toBeGreaterThan(0);
    expect(ev.ARCOBETA.strong.length).toBeGreaterThan(0);
    expect(ev.LATERAL.strong).toEqual([]);
  });

  it('ignora el CIF del proveedor, que no es de ninguna sociedad', () => {
    const email = makeEmail({
      bodyText: 'Emisor: Proveedor SL, CIF B12345678. C/ Núñez Morgado 6, 28036 Madrid',
    });
    const ev = evaluateRules(email, rules);
    for (const category of ['FOOD BOX', 'LATERAL', 'ARCOBETA'] as const) {
      expect(ev[category]).toEqual({ strong: [], medium: [] });
    }
  });

  it('la dirección fiscal común no da ninguna señal', () => {
    const ev = evaluateRules(makeEmail({ bodyText: 'C/ Núñez Morgado 6, 28036 Madrid' }), rules);
    expect(ev.LATERAL.strong).toEqual([]);
  });

  it('no toma por razón social una firma o dirección de correo con "foodbox"', () => {
    const ev = evaluateRules(
      makeEmail({ bodyText: 'Un saludo, equipo Foodbox. admin@foodbox.example' }),
      rules,
    );
    expect(ev['FOOD BOX'].strong).toEqual([]);
  });

  it('el peso de la regla decide si es fuerte o media', () => {
    const ev = evaluateRules(makeEmail({ bodyText: 'Pedido para B85554921' }), [
      cifRule('B85554921', 'LATERAL', 'medio'),
    ]);
    expect(ev.LATERAL.strong).toEqual([]);
    expect(ev.LATERAL.medium).toHaveLength(1);
  });

  it('palabra clave: en asunto y cuerpo, sin distinguir acentos, con límite de palabra', () => {
    const kw: RuleRecord = {
      id: 'kw1',
      type: 'palabra_clave',
      value: 'Restauración Lateral',
      category: 'LATERAL',
      weight: 'medio',
    };
    expect(
      evaluateRules(makeEmail({ subject: 'Pedido restauracion lateral' }), [kw]).LATERAL.medium,
    ).toHaveLength(1);
    expect(
      evaluateRules(makeEmail({ bodyText: 'restauración laterales' }), [kw]).LATERAL.medium,
    ).toEqual([]);
    // Las palabras clave no se buscan en adjuntos.
    expect(
      evaluateRules(makeEmail({ attachments: [makeAttachment('Restauración Lateral')] }), [kw])
        .LATERAL.medium,
    ).toEqual([]);
  });

  it('remitente: dirección exacta sin distinguir mayúsculas', () => {
    const rule: RuleRecord = {
      id: 'r1',
      type: 'remitente',
      value: 'Compras@Lateral.example',
      category: 'LATERAL',
      weight: 'medio',
    };
    expect(
      evaluateRules(makeEmail({ fromAddress: 'compras@lateral.example' }), [rule]).LATERAL.medium,
    ).toHaveLength(1);
    expect(
      evaluateRules(makeEmail({ fromAddress: 'otro@lateral.example' }), [rule]).LATERAL.medium,
    ).toEqual([]);
    expect(evaluateRules(makeEmail({ fromAddress: null }), [rule]).LATERAL.medium).toEqual([]);
  });

  it('dominio: el dominio y sus subdominios, no sufijos de otro dominio', () => {
    const rule: RuleRecord = {
      id: 'd1',
      type: 'dominio',
      value: '@lateral.example',
      category: 'LATERAL',
      weight: 'medio',
    };
    const medium = (from: string) =>
      evaluateRules(makeEmail({ fromAddress: from }), [rule]).LATERAL.medium;
    expect(medium('a@lateral.example')).toHaveLength(1);
    expect(medium('a@mail.lateral.example')).toHaveLength(1);
    expect(medium('a@notlateral.example')).toEqual([]);
  });

  it('ignora reglas de categorías que no automatiza el clasificador', () => {
    const ev = evaluateRules(makeEmail({ bodyText: 'B85554921' }), [
      cifRule('B85554921', 'ALQUILERES'),
    ]);
    expect(ev.LATERAL).toEqual({ strong: [], medium: [] });
  });

  it('el reenvío interno se decide por el documento, no por el remitente', () => {
    const email = makeEmail({
      fromAddress: 'admin@ejemplo.com',
      bodyText: 'Reenvío factura',
      attachments: [makeAttachment('LATERAL IBERIA, S.L. B88300413')],
    });
    const ev = evaluateRules(email, rules);
    expect(ev.LATERAL.strong.length).toBeGreaterThan(0);
    expect(ev['FOOD BOX'].strong).toEqual([]);
  });
});

describe('isInternalSender', () => {
  const domains = ['ejemplo.com', 'grupo.example'];
  it('reconoce los dominios del grupo y sus subdominios, sin confundir sufijos', () => {
    expect(isInternalSender('Ana@Ejemplo.com', domains)).toBe(true);
    expect(isInternalSender('a@mail.grupo.example', domains)).toBe(true);
    expect(isInternalSender('a@noejemplo.com', domains)).toBe(false);
    expect(isInternalSender('a@proveedor.es', domains)).toBe(false);
    expect(isInternalSender(null, domains)).toBe(false);
    expect(isInternalSender('a@ejemplo.com', [])).toBe(false);
  });
});

describe('forwardedBlock', () => {
  it.each([
    ['-----Mensaje original-----\nDe: x'],
    ['---------- Forwarded message ---------\nFrom: x'],
    ['De: Proveedor <a@b.es>\nEnviado el: lunes\nPara: yo\nAsunto: Factura'],
    ['From: A\nSent: Monday\nTo: B\nSubject: Invoice'],
    ['El lun, 5 oct 2026 a las 10:00, Ana <a@b.es> escribió:\n> hola'],
  ])('detecta el inicio del bloque reenviado o citado: %s', (block) => {
    expect(forwardedBlock(`Mira esto\nFirma interna\n\n${block}`)).toBe(block);
  });

  it('sin bloque reenviado devuelve cadena vacía y no confunde un "De:" suelto', () => {
    expect(forwardedBlock('Hola\nFOODBOX, S.A.')).toBe('');
    expect(forwardedBlock('De: Marta\nCIF A87240420')).toBe('');
  });
});

describe('evaluateRules con remitente interno', () => {
  const rules = sociedadRules();
  const internalDomains = ['ejemplo.com'];
  const signature = 'Marta\nFOODBOX, S.A. - CIF A87240420';

  it('la firma interna en el cuerpo o el asunto no cuenta', () => {
    const ev = evaluateRules(
      makeEmail({
        fromAddress: 'g@ejemplo.com',
        subject: 'FOODBOX, S.A. A87240420',
        bodyText: `Hola\n${signature}`,
      }),
      rules,
      { internalDomains },
    );
    expect(ev['FOOD BOX'].strong).toEqual([]);
  });

  it('el CIF del adjunto y el del bloque reenviado sí cuentan', () => {
    const forwarded = evaluateRules(
      makeEmail({
        fromAddress: 'g@ejemplo.com',
        bodyText: `Hola\n${signature}\n\nDe: P <p@p.es>\nEnviado: hoy\nAsunto: x\n\nFactura LATERAL IBERIA, S.L. B88300413`,
      }),
      rules,
      { internalDomains },
    );
    expect(forwarded.LATERAL.strong.length).toBeGreaterThan(0);
    expect(forwarded['FOOD BOX'].strong).toEqual([]);

    const attached = evaluateRules(
      makeEmail({
        fromAddress: 'g@ejemplo.com',
        bodyText: signature,
        attachments: [makeAttachment('FOODBOX, S.A. A87240420')],
      }),
      rules,
      { internalDomains },
    );
    expect(attached['FOOD BOX'].strong.length).toBeGreaterThan(0);
  });

  it('un remitente externo conserva el comportamiento de siempre', () => {
    const ev = evaluateRules(
      makeEmail({ fromAddress: 'p@proveedor.es', bodyText: signature }),
      rules,
      { internalDomains },
    );
    expect(ev['FOOD BOX'].strong.length).toBeGreaterThan(0);
  });
});
