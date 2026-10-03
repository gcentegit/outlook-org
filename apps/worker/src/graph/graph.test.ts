import { describe, expect, it, vi } from 'vitest';

import { GraphClient, GraphError, retryDelayMs } from './client';
import { downloadAttachment, getMessage, listFileAttachments } from './messages';

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

function makeClient(responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>(
    async () => responses.shift() ?? new Response('', { status: 500 }),
  );
  const sleep = vi.fn(async (_ms: number) => {});
  const client = new GraphClient({
    getToken: async () => 'tok',
    fetchImpl,
    sleep,
    baseUrl: 'https://g.test/v1.0',
  });
  return { client, fetchImpl, sleep };
}

describe('GraphClient', () => {
  it('envía el token y pide solo los campos necesarios del mensaje', async () => {
    const { client, fetchImpl } = makeClient([
      json({
        id: 'm1',
        subject: 'x',
        hasAttachments: false,
        receivedDateTime: '2026-10-02T08:00:00Z',
      }),
    ]);
    await getMessage(client, 'buzon@ejemplo.com', 'AAA=/1');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/users/buzon%40ejemplo.com/messages/AAA%3D%2F1?$select=');
    expect(String(url)).toContain('conversationId');
    expect(String(url)).not.toContain('attachments');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('respeta Retry-After en 429 y 503 y reintenta', async () => {
    const { client, sleep, fetchImpl } = makeClient([
      new Response('', { status: 429, headers: { 'Retry-After': '7' } }),
      new Response('', { status: 503, headers: { 'Retry-After': '2' } }),
      json({ ok: true }),
    ]);
    await expect(client.getJson('/x')).resolves.toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([7000, 2000]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('se rinde tras agotar los reintentos y no reintenta errores definitivos', async () => {
    const { client, fetchImpl } = makeClient(
      Array.from(
        { length: 6 },
        () => new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
      ),
    );
    await expect(client.getJson('/x')).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    const { client: c2, fetchImpl: f2 } = makeClient([new Response('nope', { status: 404 })]);
    await expect(c2.getJson('/y')).rejects.toBeInstanceOf(GraphError);
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it('no espera un Retry-After desmesurado', async () => {
    const { client, sleep } = makeClient([
      new Response('', { status: 429, headers: { 'Retry-After': '3600' } }),
    ]);
    await expect(client.getJson('/x')).rejects.toMatchObject({ status: 429 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retryDelayMs admite segundos, fecha HTTP y ausencia de cabecera', () => {
    expect(retryDelayMs('3', 0)).toBe(3000);
    expect(
      retryDelayMs('Fri, 02 Oct 2026 10:00:10 GMT', 0, Date.parse('2026-10-02T10:00:00Z')),
    ).toBe(10_000);
    expect(retryDelayMs(null, 2)).toBe(4000);
  });

  it('sigue @odata.nextLink hasta el final', async () => {
    const { client, fetchImpl } = makeClient([
      json({ value: [1, 2], '@odata.nextLink': 'https://g.test/v1.0/next?$skiptoken=abc' }),
      json({ value: [3] }),
    ]);
    await expect(client.getAll<number>('/col')).resolves.toEqual([1, 2, 3]);
    expect(String(fetchImpl.mock.calls[1]![0])).toBe('https://g.test/v1.0/next?$skiptoken=abc');
  });
});

describe('adjuntos', () => {
  it('lista solo fileAttachment no inline, a través de varias páginas', async () => {
    const att = (id: string, extra: object) => ({
      id,
      name: `${id}.pdf`,
      contentType: 'application/pdf',
      size: 10,
      ...extra,
    });
    const { client } = makeClient([
      json({
        value: [
          att('a', { '@odata.type': '#microsoft.graph.fileAttachment', isInline: false }),
          att('logo', { '@odata.type': '#microsoft.graph.fileAttachment', isInline: true }),
        ],
        '@odata.nextLink': 'https://g.test/v1.0/p2',
      }),
      json({
        value: [
          att('item', { '@odata.type': '#microsoft.graph.itemAttachment', isInline: false }),
          att('b', { '@odata.type': '#microsoft.graph.fileAttachment', isInline: false }),
        ],
      }),
    ]);
    const list = await listFileAttachments(client, 'p@x.es', 'm1');
    expect(list.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('descarga el contenido binario por /$value', async () => {
    const { client, fetchImpl } = makeClient([new Response(Buffer.from('%PDF-1.4'))]);
    const bytes = await downloadAttachment(client, 'p@x.es', 'm1', 'a1');
    expect(bytes.toString()).toBe('%PDF-1.4');
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(
      /\/messages\/m1\/attachments\/a1\/\$value$/,
    );
  });
});
