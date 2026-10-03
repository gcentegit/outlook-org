import { GraphClient } from '../graph/client';

export interface FakeAttachment {
  id: string;
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface FakeMessage {
  id: string;
  folderId: string;
  subject: string;
  fromAddress: string;
  fromName?: string;
  receivedDateTime: string;
  categories: string[];
  bodyText?: string;
  conversationId?: string;
  attachments?: FakeAttachment[];
}

export interface FakeFolder {
  id: string;
  displayName: string;
  parentId?: string;
}

const BASE = 'https://g.test/v1.0';
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

/**
 * Buzón simulado que responde como Graph (carpetas, subcarpetas, mensajes con paginación por
 * `@odata.nextLink`, filtro `receivedDateTime ge` y adjuntos). Se usa con el `GraphClient` real,
 * sin tocar Microsoft 365.
 */
export class FakeMailbox {
  /** Peticiones recibidas (ruta sin base), para comprobar qué se pidió y qué no. */
  readonly requests: string[] = [];
  /** Si se define, se ejecuta antes de responder; permite simular cortes. */
  onRequest?: (path: string) => Response | undefined;

  constructor(
    readonly folders: FakeFolder[],
    readonly messages: FakeMessage[],
    private readonly pageSize = 100,
  ) {}

  fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const path = decodeURIComponent(url.pathname.replace('/v1.0', ''));
    this.requests.push(`${path}${url.search}`);
    const injected = this.onRequest?.(path);
    if (injected) return injected;

    const folderList = /^\/users\/[^/]+\/mailFolders$/.exec(path);
    if (folderList) return json({ value: this.childrenOf(undefined) });
    const children = /^\/users\/[^/]+\/mailFolders\/([^/]+)\/childFolders$/.exec(path);
    if (children) return json({ value: this.childrenOf(children[1]) });

    const list = /^\/users\/[^/]+\/mailFolders\/([^/]+)\/messages$/.exec(path);
    if (list) return this.listMessages(list[1] as string, url);

    const attachmentValue =
      /^\/users\/[^/]+\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/.exec(path);
    if (attachmentValue) {
      const att = this.find(attachmentValue[1] as string)?.attachments?.find(
        (a) => a.id === attachmentValue[2],
      );
      return att
        ? new Response(new Uint8Array(att.bytes))
        : new Response('no existe', { status: 404 });
    }
    const attachments = /^\/users\/[^/]+\/messages\/([^/]+)\/attachments$/.exec(path);
    if (attachments) {
      const msg = this.find(attachments[1] as string);
      if (!msg) return new Response('no existe', { status: 404 });
      return json({
        value: (msg.attachments ?? []).map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: a.id,
          name: a.name,
          contentType: a.contentType,
          size: a.bytes.length,
          isInline: false,
        })),
      });
    }
    const one = /^\/users\/[^/]+\/messages\/([^/]+)$/.exec(path);
    if (one) {
      const msg = this.find(one[1] as string);
      return msg ? json(this.toGraph(msg, true)) : new Response('no existe', { status: 404 });
    }
    return new Response(`ruta no simulada: ${path}`, { status: 404 });
  };

  client(): GraphClient {
    return new GraphClient({
      getToken: async () => 'token-simulado',
      fetchImpl: this.fetch as typeof fetch,
      baseUrl: BASE,
      sleep: async () => {},
    });
  }

  private find(id: string): FakeMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  private childrenOf(parentId: string | undefined) {
    return this.folders
      .filter((f) => f.parentId === parentId)
      .map((f) => ({
        id: f.id,
        displayName: f.displayName,
        childFolderCount: this.folders.filter((c) => c.parentId === f.id).length,
      }));
  }

  private toGraph(m: FakeMessage, withBody: boolean) {
    return {
      id: m.id,
      subject: m.subject,
      from: { emailAddress: { address: m.fromAddress, name: m.fromName ?? m.fromAddress } },
      toRecipients: [],
      ...(withBody ? { body: { contentType: 'text', content: m.bodyText ?? '' } } : {}),
      categories: m.categories,
      hasAttachments: (m.attachments?.length ?? 0) > 0,
      receivedDateTime: m.receivedDateTime,
      internetMessageId: `<${m.id}@fake>`,
      conversationId: m.conversationId ?? `c-${m.id}`,
    };
  }

  private listMessages(folderId: string, url: URL): Response {
    const filter = url.searchParams.get('$filter') ?? '';
    const since = /receivedDateTime ge (\S+)/.exec(filter)?.[1];
    const all = this.messages
      .filter((m) => m.folderId === folderId)
      .filter((m) => !since || Date.parse(m.receivedDateTime) >= Date.parse(since))
      .sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
    const offset = Number(url.searchParams.get('$skiptoken') ?? 0);
    const page = all.slice(offset, offset + this.pageSize);
    const next = new URL(url.href);
    next.searchParams.set('$skiptoken', String(offset + this.pageSize));
    return json({
      value: page.map((m) => this.toGraph(m, false)),
      ...(offset + this.pageSize < all.length ? { '@odata.nextLink': next.href } : {}),
    });
  }
}
