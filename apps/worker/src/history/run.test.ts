import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadHistoryConfig } from './config';
import { FakeMailbox, type FakeMessage } from './fake-mailbox';
import { runHistoryPipeline } from './run';
import { historyPaths, readJsonl } from './store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'history-run-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function mailbox(): FakeMailbox {
  const messages: FakeMessage[] = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`,
    folderId: i % 2 ? 'inbox' : 'archivo',
    subject: i === 3 ? 'Lateral Arturo Soria' : `pedido ${i}`,
    fromAddress: 'p@proveedor.es',
    receivedDateTime: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
    categories: i % 4 === 0 ? ['LATERAL'] : i % 4 === 1 ? ['FOOD BOX', 'Pte ok'] : [],
    bodyText: i === 3 ? 'Facturar a LATERAL IBERIA, S.L. B88300413' : 'texto',
  }));
  return new FakeMailbox(
    [
      { id: 'inbox', displayName: 'Bandeja de entrada' },
      { id: 'archivo', displayName: 'Archivo' },
    ],
    messages,
    7,
  );
}

describe('runHistoryPipeline', () => {
  it('importa, muestrea, extrae, separa por fecha e informa de discrepancias', async () => {
    const box = mailbox();
    const config = loadHistoryConfig({ HISTORY_SAMPLE_SIZE: '12' }, dir);
    const result = await runHistoryPipeline({
      config: { ...config, dataDir: dir },
      graph: box.client(),
      mailbox: 'p@x.es',
      now: new Date('2026-10-02T10:00:00Z'),
      log: () => {},
    });

    expect(result.imported).toBe(20);
    expect(result.sample.ARCOBETA).toEqual({ available: 0, selected: 0 });
    expect(result.extraction).toEqual({ written: 12, alreadyDone: 0, failed: 0 });
    expect(result.evalDev + result.evalTest).toBe(12);
    expect(result.evalTest).toBeGreaterThan(0);

    const paths = historyPaths(dir);
    const dev = await readJsonl<{
      email: { receivedAt: string; categories: string[] };
      expected: string[];
    }>(paths.evalDev);
    const test = await readJsonl<{ email: { receivedAt: string } }>(paths.evalTest);
    // La prueba es siempre posterior al desarrollo y las etiquetas van en expected, no en email.
    expect(Math.max(...dev.map((c) => Date.parse(c.email.receivedAt)))).toBeLessThan(
      Math.min(...test.map((c) => Date.parse(c.email.receivedAt))),
    );
    expect(dev.every((c) => c.email.categories.length === 0)).toBe(true);
    expect(dev.some((c) => c.expected.includes('FOOD BOX'))).toBe(true);
    expect(dev.concat(test as never).some((c) => c.expected.includes('Pte ok'))).toBe(false);
  });

  it('reutiliza la muestra y no vuelve a extraer lo ya hecho', async () => {
    const box = mailbox();
    const config = { ...loadHistoryConfig({ HISTORY_SAMPLE_SIZE: '12' }, dir), dataDir: dir };
    const base = { config, graph: box.client(), mailbox: 'p@x.es', log: () => {} };
    await runHistoryPipeline({ ...base, now: new Date('2026-10-02T10:00:00Z') });
    const second = await runHistoryPipeline({ ...base, now: new Date('2026-10-03T10:00:00Z') });
    expect(second.extraction).toEqual({ written: 0, alreadyDone: 12, failed: 0 });
  });

  it('un correo que ya no existe se cuenta como fallido y no impide seguir', async () => {
    const box = mailbox();
    const config = { ...loadHistoryConfig({ HISTORY_SAMPLE_SIZE: '20' }, dir), dataDir: dir };
    box.onRequest = (path) =>
      path.endsWith('/messages/m5') ? new Response('', { status: 404 }) : undefined;
    const result = await runHistoryPipeline({
      config,
      graph: box.client(),
      mailbox: 'p@x.es',
      now: new Date('2026-10-02T10:00:00Z'),
      log: () => {},
    });
    expect(result.extraction).toEqual({ written: 19, alreadyDone: 0, failed: 1 });
  });

  it('sin importar ni extraer no necesita Graph y regenera el informe', async () => {
    const box = mailbox();
    const config = { ...loadHistoryConfig({ HISTORY_SAMPLE_SIZE: '20' }, dir), dataDir: dir };
    await runHistoryPipeline({
      config,
      graph: box.client(),
      mailbox: 'p@x.es',
      now: new Date('2026-10-02T10:00:00Z'),
      log: () => {},
    });
    const offline = await runHistoryPipeline({
      config,
      skipImport: true,
      skipExtract: true,
      log: () => {},
    });
    expect(offline.discrepancies).toBe(1);
    expect(await readFile(historyPaths(dir).discrepancies, 'utf8')).toContain(
      'Lateral Arturo Soria',
    );
    await expect(runHistoryPipeline({ config, log: () => {} })).rejects.toThrow(/Graph/);
  });
});
