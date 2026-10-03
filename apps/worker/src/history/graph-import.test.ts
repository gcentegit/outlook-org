import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeMailbox, type FakeFolder, type FakeMessage } from './fake-mailbox';
import { importHistory, listAllFolders } from './graph-import';
import { historyPaths, readMessages } from './store';

const folders: FakeFolder[] = [
  { id: 'inbox', displayName: 'Bandeja de entrada' },
  { id: 'archivo', displayName: 'Archivo' },
  { id: 'a347', displayName: '347', parentId: 'archivo' },
  { id: 'a347-2025', displayName: '2025', parentId: 'a347' },
  { id: 'enviados', displayName: 'Elementos enviados' },
];

const msg = (
  id: string,
  folderId: string,
  date: string,
  categories: string[] = [],
): FakeMessage => ({
  id,
  folderId,
  subject: `asunto ${id}`,
  fromAddress: 'a@proveedor.es',
  receivedDateTime: date,
  categories,
});

const SINCE = new Date('2026-04-01T00:00:00Z');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'history-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('listAllFolders', () => {
  it('recorre subcarpetas con su ruta y respeta las carpetas omitidas', async () => {
    const mailbox = new FakeMailbox(folders, []);
    const all = await listAllFolders(mailbox.client(), 'p@x.es');
    expect(all.map((f) => f.path)).toEqual([
      'Bandeja de entrada',
      'Archivo',
      'Archivo/347',
      'Archivo/347/2025',
      'Elementos enviados',
    ]);
    const skipped = await listAllFolders(mailbox.client(), 'p@x.es', ['Elementos enviados']);
    expect(skipped.map((f) => f.id)).not.toContain('enviados');
  });
});

describe('importHistory', () => {
  const messages = [
    msg('m1', 'inbox', '2026-09-30T10:00:00Z', ['LATERAL', 'Pte ok']),
    msg('m2', 'inbox', '2026-09-29T10:00:00Z'),
    msg('m3', 'inbox', '2026-09-28T10:00:00Z', ['FOOD BOX']),
    msg('m4', 'inbox', '2026-03-01T10:00:00Z', ['FOOD BOX']), // anterior al corte
    msg('m5', 'a347-2025', '2026-05-02T10:00:00Z', ['ARCOBETA']),
    msg('m6', 'archivo', '2026-06-02T10:00:00Z'),
  ];

  it('importa todas las carpetas, pagina y aplica el filtro por fecha', async () => {
    const mailbox = new FakeMailbox(folders, messages, 2);
    const result = await importHistory({
      graph: mailbox.client(),
      mailbox: 'p@x.es',
      dataDir: dir,
      since: SINCE,
      log: () => {},
    });
    const stored = await readMessages(dir);
    expect(stored.map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3', 'm5', 'm6']);
    expect(result.messagesWritten).toBe(5);
    expect(stored.find((m) => m.id === 'm5')?.folderPath).toBe('Archivo/347/2025');
    expect(stored.find((m) => m.id === 'm1')?.categories).toEqual(['LATERAL', 'Pte ok']);
    // La bandeja tiene 3 correos en el rango y páginas de 2: dos peticiones.
    expect(mailbox.requests.filter((r) => r.includes('/mailFolders/inbox/messages'))).toHaveLength(
      2,
    );
    // Ni cuerpo ni adjuntos en el listado.
    expect(mailbox.requests.some((r) => r.includes('attachments') || r.includes('body'))).toBe(
      false,
    );
  });

  it('se reanuda desde el último nextLink y no repite carpetas terminadas', async () => {
    const mailbox = new FakeMailbox(folders, messages, 2);
    let inboxCalls = 0;
    mailbox.onRequest = (path) => {
      if (path.endsWith('/mailFolders/inbox/messages') && ++inboxCalls === 2) {
        return new Response('caído', { status: 500 });
      }
      return undefined;
    };
    const run = () =>
      importHistory({
        graph: mailbox.client(),
        mailbox: 'p@x.es',
        dataDir: dir,
        since: SINCE,
        log: () => {},
      });
    await expect(run()).rejects.toThrow(/500/);
    expect((await readMessages(dir)).map((m) => m.id).sort()).toEqual(['m1', 'm2']);

    mailbox.requests.length = 0;
    mailbox.onRequest = undefined;
    await run();
    expect((await readMessages(dir)).map((m) => m.id).sort()).toEqual([
      'm1',
      'm2',
      'm3',
      'm5',
      'm6',
    ]);
    // La primera página de la bandeja (sin $skiptoken) no se pidió otra vez.
    const inboxRequests = mailbox.requests.filter((r) => r.includes('/mailFolders/inbox/messages'));
    expect(inboxRequests).toHaveLength(1);
    expect(inboxRequests[0]).toContain('skiptoken=2');

    // Tercera ejecución: todo terminado, solo se listan carpetas.
    mailbox.requests.length = 0;
    const third = await run();
    expect(third.messagesWritten).toBe(0);
    expect(mailbox.requests.some((r) => r.includes('/messages'))).toBe(false);
    expect((await readdir(historyPaths(dir).progressDir)).length).toBe(5);
  });

  it('mantiene el corte de la primera ejecución salvo con restart', async () => {
    const mailbox = new FakeMailbox(folders, messages);
    const base = { graph: mailbox.client(), mailbox: 'p@x.es', dataDir: dir, log: () => {} };
    await importHistory({ ...base, since: SINCE });
    const later = await importHistory({ ...base, since: new Date('2026-09-01T00:00:00Z') });
    expect(later.since).toBe(SINCE.toISOString());

    const restarted = await importHistory({
      ...base,
      since: new Date('2026-09-01T00:00:00Z'),
      restart: true,
    });
    expect(restarted.since).toBe('2026-09-01T00:00:00.000Z');
    expect((await readMessages(dir)).map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('omite una carpeta que Graph no deja abrir (404) y sigue con las demás', async () => {
    const mailbox = new FakeMailbox(folders, messages);
    mailbox.onRequest = (path) =>
      path.endsWith('/mailFolders/archivo/messages')
        ? new Response('', { status: 404 })
        : undefined;
    await importHistory({
      graph: mailbox.client(),
      mailbox: 'p@x.es',
      dataDir: dir,
      since: SINCE,
      log: () => {},
    });
    expect((await readMessages(dir)).map((m) => m.id)).not.toContain('m6');
    expect((await readMessages(dir)).map((m) => m.id)).toContain('m5');
  });
});
