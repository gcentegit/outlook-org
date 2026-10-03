import { ClientCertificateCredential } from '@azure/identity';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const RETRYABLE_STATUS = new Set([429, 503, 504]);
/** Tope de espera por reintento: un Retry-After mayor se considera un fallo, no una pausa. */
const MAX_RETRY_WAIT_MS = 60_000;

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GraphClientOptions {
  /** Devuelve un token de acceso válido para Graph (la caché es cosa de quien lo implementa). */
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Reintentos ante 429/503/504 (por defecto 4). */
  maxRetries?: number;
  /** Espera entre reintentos; inyectable para las pruebas. */
  sleep?: (ms: number) => Promise<void>;
}

/** Cliente mínimo de Microsoft Graph: GET con token, reintentos que respetan `Retry-After` y paginación. */
export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GraphClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? GRAPH_BASE_URL;
    this.maxRetries = options.maxRetries ?? 4;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Petición ya validada (lanza `GraphError` si no es 2xx). `pathOrUrl` admite una ruta o la URL
   * absoluta de un `@odata.nextLink`. Solo los GET se reintentan ante 429/503/504: repetir un POST
   * podría duplicar lo que crea.
   */
  private async request(
    pathOrUrl: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  ): Promise<Response> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    const maxRetries = init.method === 'GET' ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${await this.options.getToken()}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      if (res.ok) return res;
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
        const wait = retryDelayMs(res.headers.get('Retry-After'), attempt);
        if (wait <= MAX_RETRY_WAIT_MS) {
          await res.body?.cancel();
          await this.sleep(wait);
          continue;
        }
      }
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new GraphError(`Graph ${res.status} en ${url.split('?')[0]}: ${detail}`, res.status);
    }
  }

  async getJson<T>(pathOrUrl: string): Promise<T> {
    return (await (await this.request(pathOrUrl)).json()) as T;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    return (await (await this.request(path, { method: 'POST', body })).json()) as T;
  }

  async getBytes(pathOrUrl: string): Promise<Buffer> {
    return Buffer.from(await (await this.request(pathOrUrl)).arrayBuffer());
  }

  /** Recorre todas las páginas de una colección siguiendo `@odata.nextLink`. */
  async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: { value: T[]; '@odata.nextLink'?: string } = await this.getJson(next);
      items.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return items;
  }
}

/** `Retry-After` puede ser segundos o una fecha HTTP; sin cabecera, retroceso exponencial desde 1 s. */
export function retryDelayMs(
  header: string | null,
  attempt: number,
  now: number = Date.now(),
): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return 1000 * 2 ** attempt;
}

export interface GraphCertificateConfig {
  tenantId: string;
  clientId: string;
  /** Ruta al certificado PEM (clave privada y certificado) de la aplicación registrada en Entra. */
  certPath: string;
}

/** Cliente de Graph con permisos de aplicación autenticado por certificado (@azure/identity). */
export function createGraphClient(config: GraphCertificateConfig): GraphClient {
  const credential = new ClientCertificateCredential(
    config.tenantId,
    config.clientId,
    config.certPath,
  );
  return new GraphClient({
    getToken: async () => {
      const token = await credential.getToken(GRAPH_SCOPE);
      if (!token) throw new Error('Entra ID no devolvió un token para Graph.');
      return token.token;
    },
  });
}
