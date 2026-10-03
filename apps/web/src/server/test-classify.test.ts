import { TEST_CLASSIFY_QUEUE, sampleTestEmail } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import type { JobQueue } from './job-runner';
import { buildTestRequest, runTestClassify } from './test-classify';

const request = {
  provider: 'anthropic' as const,
  model: 'claude-haiku-4-5-20251001',
  email: sampleTestEmail(),
};

const okResult = {
  status: 'ok',
  message: null,
  decision: {
    messageId: 'prueba-del-panel',
    categories: ['LATERAL'],
    source: 'llm',
    ruleId: null,
    model: 'claude-haiku-4-5-20251001',
    confidence: 0.95,
    needsReview: false,
    reason: 'LATERAL sí según el LLM',
    mode: 'shadow',
  },
  usage: { inputTokens: 200, outputTokens: 40, costUsd: 0.0004 },
  latencyMs: 812,
};

function fakeQueue(overrides: Partial<JobQueue> = {}) {
  const queue = {
    send: vi.fn().mockResolvedValue('job-1'),
    getJobById: vi.fn().mockResolvedValue({ state: 'completed', output: okResult }),
    cancel: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies JobQueue;
  return queue;
}

/** Reloj simulado: cada espera avanza el tiempo, sin esperar de verdad. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('runTestClassify (panel)', () => {
  it('encola con el proveedor, el modelo y el correo, y devuelve el resultado validado', async () => {
    const queue = fakeQueue();
    const out = await runTestClassify(queue, request, clock());
    expect(queue.send).toHaveBeenCalledWith(TEST_CLASSIFY_QUEUE, request, expect.any(Object));
    expect(out).toEqual({ ok: true, result: okResult });
  });

  it('borra el trabajo en cuanto lee el resultado: el texto pegado no se queda en la cola', async () => {
    const queue = fakeQueue();
    await runTestClassify(queue, request, clock());
    expect(queue.deleteJob).toHaveBeenCalledWith(TEST_CLASSIFY_QUEUE, 'job-1');
  });

  it('espera con sondeo hasta que el trabajo termina', async () => {
    const getJobById = vi
      .fn()
      .mockResolvedValueOnce({ state: 'created' })
      .mockResolvedValueOnce({ state: 'active' })
      .mockResolvedValueOnce({ state: 'completed', output: okResult });
    const out = await runTestClassify(fakeQueue({ getJobById }), request, clock());
    expect(getJobById).toHaveBeenCalledTimes(3);
    expect(out.ok).toBe(true);
  });

  it('un proveedor no disponible llega como resultado con su motivo', async () => {
    const unavailable = {
      status: 'unavailable',
      message: 'Falta ANTHROPIC_API_KEY para el proveedor anthropic',
      decision: null,
      usage: null,
      latencyMs: null,
    };
    const queue = fakeQueue({
      getJobById: vi.fn().mockResolvedValue({ state: 'completed', output: unavailable }),
    });
    expect(await runTestClassify(queue, request, clock())).toEqual({
      ok: true,
      result: unavailable,
    });
  });

  it('si el worker no responde en 60 s cancela el trabajo y lo dice', async () => {
    const queue = fakeQueue({ getJobById: vi.fn().mockResolvedValue({ state: 'created' }) });
    const out = await runTestClassify(queue, request, clock());
    expect(out).toMatchObject({ ok: false });
    expect(out.ok === false && out.message).toContain('60 s');
    expect(queue.cancel).toHaveBeenCalledWith(TEST_CLASSIFY_QUEUE, 'job-1');
    expect(queue.deleteJob).toHaveBeenCalledWith(TEST_CLASSIFY_QUEUE, 'job-1');
  });

  it('un trabajo fallido se explica sin esperar al tiempo máximo', async () => {
    const getJobById = vi
      .fn()
      .mockResolvedValue({ state: 'failed', output: { message: 'petición no válida' } });
    const out = await runTestClassify(fakeQueue({ getJobById }), request, clock());
    expect(out.ok === false && out.message).toContain('petición no válida');
    expect(getJobById).toHaveBeenCalledTimes(1);
  });

  it('si no se puede encolar (cola inexistente o BD caída) devuelve un mensaje, no lanza', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = fakeQueue({ send: vi.fn().mockRejectedValue(new Error('queue not found')) });
    const out = await runTestClassify(queue, request, clock());
    expect(out.ok === false && out.message).toContain('worker');
    expect(queue.getJobById).not.toHaveBeenCalled();
  });

  it('un resultado con otra forma se rechaza', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = fakeQueue({
      getJobById: vi.fn().mockResolvedValue({ state: 'completed', output: { raro: true } }),
    });
    expect((await runTestClassify(queue, request, clock())).ok).toBe(false);
  });
});

describe('buildTestRequest', () => {
  const base = { provider: 'google', model: 'gemini-2.5-flash', subject: '', body: '' };

  it('sin texto pegado usa el correo sintético con un CIF de la tabla', () => {
    const built = buildTestRequest(base);
    expect(built).toMatchObject({ ok: true });
    if (built.ok) {
      expect(built.request.email).toEqual(sampleTestEmail());
      expect(built.request).toMatchObject({ provider: 'google', model: 'gemini-2.5-flash' });
    }
  });

  it('con texto pegado lo usa tal cual y respeta el asunto escrito', () => {
    const built = buildTestRequest({ ...base, subject: ' Mi asunto ', body: ' Cliente X ' });
    expect(built.ok && built.request.email).toEqual({ subject: 'Mi asunto', body: 'Cliente X' });
  });

  it('solo asunto: conserva el asunto y usa el cuerpo sintético', () => {
    const built = buildTestRequest({ ...base, subject: 'Otro' });
    expect(built.ok && built.request.email).toEqual({
      subject: 'Otro',
      body: sampleTestEmail().body,
    });
  });

  it('rechaza proveedor desconocido, modelo vacío y textos demasiado largos', () => {
    expect(buildTestRequest({ ...base, provider: 'x' })).toMatchObject({ ok: false });
    expect(buildTestRequest({ ...base, provider: null })).toMatchObject({ ok: false });
    expect(buildTestRequest({ ...base, model: '  ' })).toMatchObject({ ok: false });
    expect(buildTestRequest({ ...base, body: 'a'.repeat(20_001) })).toMatchObject({ ok: false });
    expect(buildTestRequest({ ...base, subject: 'a'.repeat(301) })).toMatchObject({ ok: false });
  });
});
