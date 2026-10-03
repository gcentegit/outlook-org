import { decisionSchema } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  classify,
  type ClassifyContext,
  type LlmClassifier,
  type LlmOutcome,
  type RuleRecord,
  type ThreadCategory,
} from './index';
import { makeAttachment, makeEmail, sociedadRules } from './test-fixtures';

const ALL = ['FOOD BOX', 'LATERAL', 'ARCOBETA'];

function makeCtx(
  over: Partial<Omit<ClassifyContext, 'rules'>> & {
    ruleList?: RuleRecord[];
    thread?: ThreadCategory[];
  } = {},
) {
  const { ruleList = sociedadRules(), thread = [], ...rest } = over;
  const findThreadCategories = vi.fn().mockResolvedValue(thread);
  const ctx: ClassifyContext = {
    availableCategories: ALL,
    mode: 'shadow',
    rules: { listActiveRules: async () => ruleList },
    threads: { findThreadCategories },
    ...rest,
  };
  return { ctx, findThreadCategories };
}

const llmReturning = (outcome: LlmOutcome) => vi.fn<LlmClassifier>().mockResolvedValue(outcome);

const okOutcome = (
  verdicts: Record<string, { applies: boolean; confidence: number }>,
): LlmOutcome => ({
  status: 'ok',
  model: 'modelo-x',
  verdicts: Object.fromEntries(
    Object.entries(verdicts).map(([k, v]) => [k, { ...v, reason: 'porque sí' }]),
  ),
  usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
  latencyMs: 420,
});

const lateralInvoice = makeEmail({
  attachments: [makeAttachment('Cliente: LATERAL IBERIA, S.L. CIF B88300413')],
});

describe('classify: reglas', () => {
  it('regla fuerte: categoría decidida, las demás descartadas y sin llamar al LLM', async () => {
    const llm = llmReturning(okOutcome({}));
    const { ctx } = makeCtx({ llm });

    const { decision, usage, llmCalled } = await classify(lateralInvoice, ctx);

    expect(decisionSchema.safeParse(decision).success).toBe(true);
    expect(decision).toMatchObject({
      messageId: 'm1',
      categories: ['LATERAL'],
      source: 'rule',
      ruleId: 'cif-B88300413',
      model: null,
      confidence: 1,
      needsReview: false,
      mode: 'shadow',
    });
    expect(llm).not.toHaveBeenCalled();
    expect(usage).toBeNull();
    expect(llmCalled).toBe(false);
  });

  it('multietiqueta: dos sociedades dan dos categorías', async () => {
    const email = makeEmail({
      attachments: [
        makeAttachment('FOODBOX SA A87240420'),
        makeAttachment('LATERAL CONSELL SL B86898491'),
      ],
    });
    const { decision } = await classify(email, makeCtx().ctx);
    expect(decision.categories).toEqual(['FOOD BOX', 'LATERAL']);
    expect(decision.needsReview).toBe(false);
  });

  it('el CIF del proveedor no cuenta: sin señales queda en duda', async () => {
    const email = makeEmail({ bodyText: 'Emisor CIF B12345678, C/ Núñez Morgado 6' });
    const { decision } = await classify(email, makeCtx().ctx);
    expect(decision).toMatchObject({
      categories: [],
      needsReview: true,
      source: 'none',
      ruleId: null,
      model: null,
      confidence: 0,
    });
  });

  it('regla media decide cuando no hay regla fuerte', async () => {
    const rules: RuleRecord[] = [
      { id: 'kw', type: 'palabra_clave', value: 'arcobeta', category: 'ARCOBETA', weight: 'medio' },
    ];
    const { decision } = await classify(
      makeEmail({ subject: 'Pedido ArcoBeta' }),
      makeCtx({ ruleList: rules }).ctx,
    );
    // FOOD BOX y LATERAL siguen en duda: la confianza de la decisión es el mínimo, y una duda vale 0.
    expect(decision).toMatchObject({
      categories: ['ARCOBETA'],
      source: 'rule',
      ruleId: 'kw',
      confidence: 0,
    });
    expect(decision.needsReview).toBe(true);
  });

  it('una regla fuerte prevalece sobre una media de otra categoría', async () => {
    const rules: RuleRecord[] = [
      ...sociedadRules(),
      { id: 'kw', type: 'palabra_clave', value: 'lateral', category: 'LATERAL', weight: 'medio' },
    ];
    const email = makeEmail({
      subject: 'lateral',
      attachments: [makeAttachment('FOODBOX, S.A. A87240420')],
    });
    const { decision } = await classify(email, makeCtx({ ruleList: rules }).ctx);
    expect(decision.categories).toEqual(['FOOD BOX']);
  });

  it('reenvío interno: manda el CIF del adjunto, no el remitente', async () => {
    const email = makeEmail({
      fromAddress: 'admin@ejemplo.com',
      attachments: [makeAttachment('ARCO BETA, S.L. B87694121')],
    });
    const { decision } = await classify(email, makeCtx().ctx);
    expect(decision.categories).toEqual(['ARCOBETA']);
  });

  it('el umbral de confianza también afecta a las reglas medias', async () => {
    const rules: RuleRecord[] = [
      { id: 'kw', type: 'palabra_clave', value: 'lateral', category: 'LATERAL', weight: 'medio' },
    ];
    const { decision } = await classify(
      makeEmail({ subject: 'lateral' }),
      makeCtx({ ruleList: rules, confidenceThreshold: 0.95 }).ctx,
    );
    expect(decision.categories).toEqual([]);
    expect(decision.needsReview).toBe(true);
  });

  it('propaga los errores de la base de datos en lugar de decidir a ciegas', async () => {
    const { ctx } = makeCtx();
    ctx.rules = { listActiveRules: async () => Promise.reject(new Error('sin conexión')) };
    await expect(classify(lateralInvoice, ctx)).rejects.toThrow('sin conexión');
  });
});

describe('classify: hilo', () => {
  const thread: ThreadCategory[] = [{ category: 'FOOD BOX', messageId: 'prev', origin: 'team' }];

  it('hereda la categoría del hilo cuando el correo no trae ninguna regla fuerte', async () => {
    const email = makeEmail({ conversationId: 'c1', bodyText: 'Gracias' });
    const { ctx, findThreadCategories } = makeCtx({ thread });
    const { decision } = await classify(email, ctx);
    expect(findThreadCategories).toHaveBeenCalledWith('c1', 'm1');
    expect(decision).toMatchObject({
      source: 'thread',
      ruleId: null,
      confidence: 0,
      needsReview: true,
    });
    expect(decision.categories).toEqual(['FOOD BOX']);
    expect(decision.reason).toContain('prev');
  });

  it('con todo lo demás resuelto, la confianza es la de la herencia', async () => {
    const email = makeEmail({ conversationId: 'c1', bodyText: 'Gracias' });
    const llm = llmReturning(
      okOutcome({
        LATERAL: { applies: false, confidence: 0.97 },
        ARCOBETA: { applies: false, confidence: 0.97 },
      }),
    );
    const { decision } = await classify(email, makeCtx({ thread, llm }).ctx);
    expect(decision.confidence).toBe(0.95);
    expect(decision.needsReview).toBe(false);
  });

  it('el CIF del propio correo gana a la herencia del hilo', async () => {
    const email = makeEmail({
      conversationId: 'c1',
      attachments: [makeAttachment('LATERAL IBERIA SL')],
    });
    const { decision } = await classify(email, makeCtx({ thread }).ctx);
    expect(decision.categories).toEqual(['LATERAL']);
    expect(decision.source).toBe('rule');
    expect(decision.reason).toContain('FOOD BOX, ARCOBETA descartada(s)');
  });

  it('una regla media no pisa lo heredado del hilo', async () => {
    const ruleList: RuleRecord[] = [
      { id: 'k', type: 'palabra_clave', value: 'sushi', category: 'LATERAL', weight: 'medio' },
    ];
    const email = makeEmail({ conversationId: 'c1', subject: 'Pedido de sushi' });
    const { decision } = await classify(email, makeCtx({ thread, ruleList }).ctx);
    expect(decision.categories).toEqual(['FOOD BOX', 'LATERAL']);
    expect(decision.source).toBe('thread');
  });

  it('el LLM solo recibe las categorías que el hilo no ha resuelto', async () => {
    const llm = llmReturning(
      okOutcome({
        LATERAL: { applies: false, confidence: 0.9 },
        ARCOBETA: { applies: false, confidence: 0.9 },
      }),
    );
    const { decision } = await classify(
      makeEmail({ conversationId: 'c1' }),
      makeCtx({ thread, llm }).ctx,
    );
    expect(llm.mock.calls[0]?.[1]).toEqual(['LATERAL', 'ARCOBETA']);
    expect(decision.categories).toEqual(['FOOD BOX']);
    expect(decision.needsReview).toBe(false);
  });
});

describe('classify: LLM', () => {
  const noSignal = makeEmail({ bodyText: 'Hola, ¿cómo va lo nuestro?' });

  it('resuelve las categorías dudosas, informa modelo, tokens y coste', async () => {
    const llm = llmReturning(
      okOutcome({
        'FOOD BOX': { applies: false, confidence: 0.92 },
        LATERAL: { applies: true, confidence: 0.88 },
        ARCOBETA: { applies: false, confidence: 0.9 },
      }),
    );
    const result = await classify(noSignal, makeCtx({ llm }).ctx);
    const { decision, usage, llmCalled } = result;

    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0]?.[1]).toEqual(['FOOD BOX', 'LATERAL', 'ARCOBETA']);
    expect(decision).toMatchObject({
      categories: ['LATERAL'],
      source: 'llm',
      ruleId: null,
      model: 'modelo-x',
      confidence: 0.88,
      needsReview: false,
    });
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 20, costUsd: 0.001 });
    expect(result.latencyMs).toBe(420);
    expect(llmCalled).toBe(true);
    expect(decisionSchema.safeParse(decision).success).toBe(true);
  });

  it('confianza baja: sin categoría y needsReview', async () => {
    const llm = llmReturning(
      okOutcome({
        'FOOD BOX': { applies: true, confidence: 0.79 },
        LATERAL: { applies: false, confidence: 0.95 },
        ARCOBETA: { applies: false, confidence: 0.95 },
      }),
    );
    const { decision } = await classify(noSignal, makeCtx({ llm }).ctx);
    expect(decision.categories).toEqual([]);
    expect(decision.needsReview).toBe(true);
    expect(decision.confidence).toBe(0.79);
    expect(decision.reason).toContain('FOOD BOX');
  });

  it('el umbral es configurable', async () => {
    const llm = llmReturning(
      okOutcome({
        'FOOD BOX': { applies: true, confidence: 0.7 },
        LATERAL: { applies: false, confidence: 0.7 },
        ARCOBETA: { applies: false, confidence: 0.7 },
      }),
    );
    const { decision } = await classify(noSignal, makeCtx({ llm, confidenceThreshold: 0.6 }).ctx);
    expect(decision.categories).toEqual(['FOOD BOX']);
    expect(decision.needsReview).toBe(false);
  });

  it('categoría que el LLM no contesta: queda en duda', async () => {
    const llm = llmReturning(okOutcome({ LATERAL: { applies: true, confidence: 0.9 } }));
    const { decision } = await classify(noSignal, makeCtx({ llm }).ctx);
    expect(decision.categories).toEqual(['LATERAL']);
    expect(decision.needsReview).toBe(true);
  });

  it('LLM fallido: sin categorías, needsReview y el motivo en reason', async () => {
    const llm = llmReturning({
      status: 'failed',
      model: 'modelo-x',
      reason: 'AI_NoObjectGeneratedError',
      usage: { inputTokens: 50, outputTokens: 5, costUsd: null },
      latencyMs: 1800,
    });
    const { decision, usage } = await classify(noSignal, makeCtx({ llm }).ctx);
    expect(decision).toMatchObject({
      categories: [],
      needsReview: true,
      source: 'llm',
      model: 'modelo-x',
    });
    expect(decision.reason).toContain('AI_NoObjectGeneratedError');
    expect(usage?.inputTokens).toBe(50);
  });

  it('un LLM fallido marca la decisión como degradada y reintentable; uno no disponible, no', async () => {
    const failed = await classify(
      noSignal,
      makeCtx({
        llm: llmReturning({
          status: 'failed',
          model: 'm',
          reason: 'tiempo agotado',
          usage: null,
          latencyMs: 30_000,
        }),
      }).ctx,
    );
    expect(failed.degraded).toEqual({ reason: 'LLM fallido: tiempo agotado', transient: true });

    const unavailable = await classify(
      noSignal,
      makeCtx({ llm: llmReturning({ status: 'unavailable', reason: 'falta la clave' }) }).ctx,
    );
    expect(unavailable.degraded).toEqual({
      reason: 'LLM no disponible: falta la clave',
      transient: false,
    });

    const fine = await classify(lateralInvoice, makeCtx({ llm: llmReturning(okOutcome({})) }).ctx);
    expect(fine.degraded).toBeNull();
  });

  it('proveedor no configurado: duda, sin llamada ni coste', async () => {
    const llm = llmReturning({ status: 'unavailable', reason: 'no hay modelo de LLM activo' });
    const { decision, usage, llmCalled } = await classify(noSignal, makeCtx({ llm }).ctx);
    expect(decision).toMatchObject({
      categories: [],
      needsReview: true,
      source: 'none',
      ruleId: null,
      model: null,
    });
    expect(decision.reason).toContain('no hay modelo de LLM activo');
    expect(usage).toBeNull();
    expect(llmCalled).toBe(false);
  });

  it('sin LLM en el contexto: duda', async () => {
    const { decision } = await classify(noSignal, makeCtx().ctx);
    expect(decision.needsReview).toBe(true);
    expect(decision.reason).toContain('sin LLM');
  });

  it('con una regla fuerte el LLM no se llama aunque esté disponible', async () => {
    const llm = llmReturning(okOutcome({}));
    await classify(lateralInvoice, makeCtx({ llm }).ctx);
    expect(llm).not.toHaveBeenCalled();
  });

  it('fuente rule con modelo cuando una regla media y el LLM aportan categorías', async () => {
    const rules: RuleRecord[] = [
      { id: 'kw', type: 'palabra_clave', value: 'arcobeta', category: 'ARCOBETA', weight: 'medio' },
    ];
    const llm = llmReturning(
      okOutcome({
        'FOOD BOX': { applies: true, confidence: 0.9 },
        LATERAL: { applies: false, confidence: 0.9 },
      }),
    );
    const { decision } = await classify(
      makeEmail({ subject: 'arcobeta' }),
      makeCtx({ ruleList: rules, llm }).ctx,
    );
    expect(llm.mock.calls[0]?.[1]).toEqual(['FOOD BOX', 'LATERAL']);
    expect(decision).toMatchObject({
      categories: ['FOOD BOX', 'ARCOBETA'],
      source: 'rule',
      ruleId: 'kw',
      model: 'modelo-x',
    });
  });
});

describe('classify: lista maestra y categorías del equipo', () => {
  it('una categoría inexistente (ARCOBETA) no se devuelve y se registra en reason', async () => {
    const email = makeEmail({ attachments: [makeAttachment('ARCO BETA, S.L. B87694121')] });
    const { decision } = await classify(
      email,
      makeCtx({ availableCategories: ['FOOD BOX', 'LATERAL'] }).ctx,
    );
    expect(decision.categories).toEqual([]);
    expect(decision.reason).toContain('ARCOBETA');
    expect(decision.reason).toContain('no existe en la lista maestra');
    expect(decision.needsReview).toBe(false);
  });

  it('el LLM no recibe categorías inexistentes en el buzón', async () => {
    const llm = llmReturning(
      okOutcome({
        'FOOD BOX': { applies: false, confidence: 0.9 },
        LATERAL: { applies: false, confidence: 0.9 },
      }),
    );
    await classify(
      makeEmail({ bodyText: 'hola' }),
      makeCtx({ llm, availableCategories: ['FOOD BOX', 'LATERAL'] }).ctx,
    );
    expect(llm.mock.calls[0]?.[1]).toEqual(['FOOD BOX', 'LATERAL']);
  });

  it('reconoce la lista maestra sin distinguir mayúsculas y devuelve el nombre canónico', async () => {
    const { decision } = await classify(
      lateralInvoice,
      makeCtx({ availableCategories: ['Lateral'] }).ctx,
    );
    expect(decision.categories).toEqual(['LATERAL']);
  });

  it('sin ninguna categoría automatizada en el buzón no se decide nada', async () => {
    const llm = llmReturning(okOutcome({}));
    const { decision } = await classify(
      lateralInvoice,
      makeCtx({ availableCategories: ['ALQUILERES'], llm }).ctx,
    );
    expect(decision.categories).toEqual([]);
    expect(decision.needsReview).toBe(false);
    expect(decision.reason).toContain('ninguna de las categorías automatizadas');
    expect(llm).not.toHaveBeenCalled();
  });

  it('categoría ya puesta por el equipo: se respeta, no entra en el LLM ni fuerza revisión', async () => {
    const llm = llmReturning(
      okOutcome({
        LATERAL: { applies: false, confidence: 0.9 },
        ARCOBETA: { applies: false, confidence: 0.9 },
      }),
    );
    const email = makeEmail({ bodyText: 'sin señales', categories: ['Food Box', 'ALQUILERES'] });
    const { decision } = await classify(email, makeCtx({ llm }).ctx);
    expect(llm.mock.calls[0]?.[1]).toEqual(['LATERAL', 'ARCOBETA']);
    expect(decision.categories).toEqual([]);
    expect(decision.needsReview).toBe(false);
    expect(decision.reason).toContain('ya puesta por el equipo');
  });

  it('con todo en duda salvo lo puesto por el equipo y sin LLM, no pide revisión por lo ya etiquetado', async () => {
    const email = makeEmail({
      bodyText: 'sin señales',
      categories: ['FOOD BOX', 'LATERAL', 'ARCOBETA'],
    });
    const { decision } = await classify(email, makeCtx().ctx);
    expect(decision.needsReview).toBe(false);
  });

  it('nunca propone quitar categorías: si una regla descarta una puesta por el equipo, simplemente no se devuelve', async () => {
    const email = makeEmail({
      categories: ['FOOD BOX'],
      attachments: [makeAttachment('LATERAL IBERIA SL')],
    });
    const { decision } = await classify(email, makeCtx().ctx);
    expect(decision.categories).toEqual(['LATERAL']);
  });

  it('el modo se copia a la decisión', async () => {
    const { decision } = await classify(lateralInvoice, makeCtx({ mode: 'live' }).ctx);
    expect(decision.mode).toBe('live');
  });
});

describe('classify: remitente interno con pie de firma del grupo', () => {
  const internalDomains = ['ejemplo.com', 'grupo.example'];
  const signature = 'Un saludo,\nMarta\nFOODBOX, S.A. - CIF A87240420\nC/ Núñez Morgado 6, Madrid';

  it('la firma interna no activa FOOD BOX: solo cuenta el adjunto del reenvío', async () => {
    const email = makeEmail({
      fromAddress: 'admin@ejemplo.com',
      bodyText: `Te reenvío la factura.\n${signature}`,
      attachments: [makeAttachment('Cliente: LATERAL IBERIA, S.L. CIF B88300413')],
    });
    const { decision } = await classify(email, makeCtx({ internalDomains }).ctx);
    expect(decision.categories).toEqual(['LATERAL']);
    expect(decision.source).toBe('rule');
  });

  it('con el mismo cuerpo y remitente externo, el pie sí cuenta como señal fuerte', async () => {
    const email = makeEmail({
      fromAddress: 'facturas@proveedor.es',
      bodyText: `Factura para FOODBOX, S.A. - CIF A87240420`,
    });
    const { decision } = await classify(email, makeCtx({ internalDomains }).ctx);
    expect(decision.categories).toEqual(['FOOD BOX']);
  });

  it('un reenvío interno sin adjunto usa el bloque reenviado, no la firma', async () => {
    const email = makeEmail({
      fromAddress: 'admin@ejemplo.com',
      bodyText: [
        'Mirad esto, por favor.',
        signature,
        '',
        '-----Mensaje original-----',
        'De: Proveedor <facturas@proveedor.es>',
        'Enviado: lunes, 28 de septiembre de 2026 10:00',
        'Asunto: Factura',
        '',
        'Factura a nombre de ARCO BETA, S.L., CIF B87694121',
      ].join('\n'),
    });
    const { decision } = await classify(email, makeCtx({ internalDomains }).ctx);
    expect(decision.categories).toEqual(['ARCOBETA']);
  });

  it('un correo interno cuyo único CIF es el de su firma no decide nada por reglas', async () => {
    const email = makeEmail({
      fromAddress: 'admin@ejemplo.com',
      bodyText: `Hola\n${signature}`,
    });
    const { decision } = await classify(email, makeCtx({ internalDomains }).ctx);
    expect(decision.categories).toEqual([]);
    expect(decision.source).toBe('none');
  });
});
