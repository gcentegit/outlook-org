import type { ExtractedEmail } from '@clasificador/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ClassifyResult } from '../classify';
import { makeEmail } from '../classify/test-fixtures';
import { GraphError } from '../graph/client';
import {
  DegradedDecisionError,
  processMessage,
  type DecisionStore,
  type ProcessMessageDeps,
} from './process-message';

const result = (email: ExtractedEmail): ClassifyResult => ({
  decision: {
    messageId: email.messageId,
    categories: ['LATERAL'],
    source: 'rule',
    ruleId: 'r1',
    model: null,
    confidence: 1,
    needsReview: false,
    reason: 'CIF de Lateral',
    mode: 'shadow',
  },
  usage: null,
  latencyMs: null,
  llmCalled: false,
  degraded: null,
});

function store(over: Partial<DecisionStore> = {}): DecisionStore {
  return {
    hasDecision: vi.fn(async () => false),
    saveDecision: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    ...over,
  };
}

function deps(over: Partial<ProcessMessageDeps> = {}): ProcessMessageDeps {
  return {
    mode: 'shadow',
    log: () => {},
    store: store(),
    extract: vi.fn(async (id: string) => makeEmail({ messageId: id })),
    availableCategories: vi.fn(async () => ['FOOD BOX', 'LATERAL', 'ARCOBETA']),
    classify: vi.fn(async (email) => result(email)),
    ...over,
  };
}

describe('processMessage', () => {
  it('extrae, clasifica con la lista maestra y guarda la decisión', async () => {
    const d = deps();
    expect(await processMessage('m1', d)).toBe('processed');
    expect(d.classify).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }), [
      'FOOD BOX',
      'LATERAL',
      'ARCOBETA',
    ]);
    expect(d.store.saveDecision).toHaveBeenCalledOnce();
    expect(d.store.saveDecision).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1' }),
      expect.anything(),
      { degradedReason: null },
    );
  });

  it('es idempotente: con decisión previa del mismo modo no extrae ni guarda', async () => {
    const d = deps({ store: store({ hasDecision: vi.fn(async () => true) }) });
    expect(await processMessage('m1', d)).toBe('already-decided');
    expect(d.extract).not.toHaveBeenCalled();
    expect(d.store.saveDecision).not.toHaveBeenCalled();
    expect(d.store.hasDecision).toHaveBeenCalledWith('m1', 'shadow');
  });

  it('dos ejecuciones simultáneas del mismo correo solo guardan una decisión', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps({
      extract: vi.fn(async (id: string) => {
        await gate;
        return makeEmail({ messageId: id });
      }),
    });
    const first = processMessage('m1', d);
    expect(await processMessage('m1', d)).toBe('already-decided');
    release();
    expect(await first).toBe('processed');
    expect(d.store.saveDecision).toHaveBeenCalledOnce();
  });

  it('un correo que ya no existe (404) se da por terminado sin guardar', async () => {
    const d = deps({
      extract: vi.fn(async () => {
        throw new GraphError('no existe', 404);
      }),
    });
    expect(await processMessage('m1', d)).toBe('gone');
    expect(d.store.saveDecision).not.toHaveBeenCalled();
    expect(d.store.forget).toHaveBeenCalledWith('m1');
  });

  it('otros errores de Graph se propagan para que pg-boss reintente', async () => {
    const d = deps({
      extract: vi.fn(async () => {
        throw new GraphError('Graph 503', 503);
      }),
    });
    await expect(processMessage('m1', d)).rejects.toThrow('Graph 503');
  });

  it('un error al guardar se propaga, y el correo queda libre para el reintento', async () => {
    const d = deps();
    vi.mocked(d.store.saveDecision).mockRejectedValueOnce(new Error('BD caída'));
    await expect(processMessage('m1', d)).rejects.toThrow('BD caída');
    expect(await processMessage('m1', d)).toBe('processed');
  });
});

describe('processMessage: fallos técnicos', () => {
  const degradedResult = (email: ExtractedEmail, transient: boolean): ClassifyResult => ({
    ...result(email),
    degraded: { reason: 'LLM fallido: tiempo agotado', transient },
  });

  it('un fallo pasajero con reintentos pendientes lanza y no guarda nada', async () => {
    const d = deps({ classify: vi.fn(async (email) => degradedResult(email, true)) });
    await expect(processMessage('m1', d, { isLast: false })).rejects.toBeInstanceOf(
      DegradedDecisionError,
    );
    expect(d.store.saveDecision).not.toHaveBeenCalled();
    expect(d.store.markFailed).not.toHaveBeenCalled();
  });

  it('en el último intento guarda la decisión degradada con el motivo y el correo queda para reprocesar', async () => {
    const d = deps({ classify: vi.fn(async (email) => degradedResult(email, true)) });
    expect(await processMessage('m1', d, { isLast: true })).toBe('degraded');
    expect(d.store.saveDecision).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      degradedReason: 'LLM fallido: tiempo agotado',
    });
    expect(d.store.markFailed).not.toHaveBeenCalled();
  });

  it('un fallo que no se arregla solo (sin clave, sin modelo) se guarda degradado sin reintentar', async () => {
    const d = deps({ classify: vi.fn(async (email) => degradedResult(email, false)) });
    expect(await processMessage('m1', d, { isLast: false })).toBe('degraded');
    expect(d.store.saveDecision).toHaveBeenCalledOnce();
  });

  it('docling caído al extraer cuenta como fallo pasajero', async () => {
    const d = deps({
      extract: vi.fn(async (id: string) =>
        makeEmail({ messageId: id, degradedReasons: ['f.pdf: docling no responde'] }),
      ),
    });
    await expect(processMessage('m1', d, { isLast: false })).rejects.toThrow(/docling no responde/);
    expect(await processMessage('m1', d, { isLast: true })).toBe('degraded');
    expect(d.store.saveDecision).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      degradedReason: 'f.pdf: docling no responde',
    });
  });

  it('si el último intento falla por otra causa, el correo queda fallido y el error se propaga', async () => {
    const d = deps({
      extract: vi.fn(async () => {
        throw new GraphError('Graph 503', 503);
      }),
    });
    await expect(processMessage('m1', d, { isLast: true })).rejects.toThrow('Graph 503');
    expect(d.store.markFailed).toHaveBeenCalledWith('m1');
    await expect(processMessage('m2', d, { isLast: false })).rejects.toThrow('Graph 503');
    expect(d.store.markFailed).toHaveBeenCalledTimes(1);
  });
});
