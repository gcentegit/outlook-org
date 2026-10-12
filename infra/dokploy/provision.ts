/**
 * Alta idempotente del proyecto `clasificador.arcofood` en Dokploy (sin Compose).
 *
 *   node provision.ts                # --dry-run (por defecto): solo muestra qué haría
 *   node provision.ts --apply        # crea y actualiza lo que falte o difiera
 *   node provision.ts --check        # como --dry-run, pero sale con código 2 si hay diferencias
 *
 * Lee `DOKPLOY_URL` y `DOKPLOY_API_KEY` del entorno (el resto de variables, en el README de esta
 * carpeta). Sin ellas, `--dry-run` enseña lo que se crearía en un Dokploy vacío. Los valores secretos
 * nunca se imprimen. Se puede ejecutar las veces que haga falta: solo cambia lo que difiere.
 *
 * No despliega web ni worker (los despliega el flujo de publicación con la etiqueta exacta de la
 * imagen). Sí arranca PostgreSQL y docling la primera vez, porque no dependen de ninguna versión.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── Especificación deseada ─────────────────────────────────────────────────────────────────────

export const PROJECT_NAME = 'clasificador.arcofood';
export const ENVIRONMENT_NAME = 'production';
/** Dominio del panel por defecto; `PANEL_DOMAIN` lo cambia (por ejemplo, uno temporal). */
export const DOMAIN_HOST = 'clasificador.arcofood.com';
export const DEFAULT_BACKUP_DESTINATION = 'S3 Minio Dokploy Proyectos';
export const CERT_MOUNT_PATH = '/run/secrets/graph-cert.pem';
export const CERT_FILE_NAME = 'graph-cert.pem';
export const DOCLING_PORT = 5001;
export const DOCLING_IMAGE = 'ghcr.io/docling-project/docling-serve-cpu:v1.36.0';
export const POSTGRES_IMAGE = 'postgres:16-alpine';
export const DB_NAME = 'clasificador';
export const DB_USER = 'clasificador';

const MiB = 1024 * 1024;
const SECOND_NS = 1_000_000_000;

export interface HealthCheck {
  Test: string[];
  Interval: number;
  Timeout: number;
  StartPeriod: number;
  Retries: number;
}

const healthCheck = (
  test: string[],
  intervalS: number,
  timeoutS: number,
  startPeriodS: number,
  retries: number,
): HealthCheck => ({
  Test: test,
  Interval: intervalS * SECOND_NS,
  Timeout: timeoutS * SECOND_NS,
  StartPeriod: startPeriodS * SECOND_NS,
  Retries: retries,
});

const nodeFetchProbe = (port: number, path: string): string[] => [
  'CMD',
  'node',
  '-e',
  `fetch('http://127.0.0.1:${port}${path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
];

export type ServiceKey = 'web' | 'worker' | 'docling';

export interface AppSpec {
  key: ServiceKey;
  name: string;
  /** Memoria en bytes (Dokploy los pasa tal cual a Docker; no acepta sufijos). */
  memoryReservation: number;
  memoryLimit: number;
  healthCheck: HealthCheck;
  /** Puerto interno del contenedor (el dominio de la web apunta a él). */
  port: number;
}

export const APPS: Record<ServiceKey, AppSpec> = {
  web: {
    key: 'web',
    name: 'clasificador-web',
    memoryReservation: 256 * MiB,
    memoryLimit: 512 * MiB,
    healthCheck: healthCheck(nodeFetchProbe(3000, '/api/health'), 30, 5, 30, 3),
    port: 3000,
  },
  worker: {
    key: 'worker',
    name: 'clasificador-worker',
    memoryReservation: 256 * MiB,
    memoryLimit: 1024 * MiB,
    // /livez: arrancado y con el bucle avanzando; no mide la frescura de la sincronización con Graph
    // (eso es /health, para Uptime Kuma), así que una caída de Graph no reinicia el contenedor en bucle.
    healthCheck: healthCheck(nodeFetchProbe(8080, '/livez'), 30, 5, 120, 3),
    port: 8080,
  },
  docling: {
    key: 'docling',
    name: 'clasificador-docling',
    memoryReservation: 1536 * MiB,
    memoryLimit: 4096 * MiB,
    healthCheck: healthCheck(
      ['CMD', 'curl', '-fsS', `http://localhost:${DOCLING_PORT}/health`],
      30,
      5,
      60,
      5,
    ),
    port: DOCLING_PORT,
  },
};

export const POSTGRES_SPEC = {
  name: 'clasificador-db',
  memoryReservation: 256 * MiB,
  memoryLimit: 1024 * MiB,
  healthCheck: healthCheck(
    ['CMD-SHELL', `pg_isready -U ${DB_USER} -d ${DB_NAME}`],
    10,
    5,
    30,
    5,
  ),
};

export const BACKUP_SPEC = {
  schedule: '0 3 * * *',
  prefix: 'clasificador',
  keepLatestCount: 7,
};

// ── Configuración de la ejecución ──────────────────────────────────────────────────────────────

export interface ProvisionConfig {
  /** Propietario de las imágenes en GHCR (`ghcr.io/<owner>/clasificador-web`). */
  ghcrOwner: string;
  /** Imagen inicial al crear cada aplicación; después la fija el flujo de publicación. */
  webImage?: string;
  workerImage?: string;
  /** Credenciales para descargar imágenes privadas de GHCR (solo al crear). */
  registryUsername?: string;
  registryPassword?: string;
  /** Contraseña de PostgreSQL; solo hace falta al crearlo o para escribir `DATABASE_URL`. */
  dbPassword?: string;
  backupDestinationName: string;
  /** Dominio público del panel; por defecto `DOMAIN_HOST`. */
  domainHost?: string;
  /** Contenido PEM del certificado de la app de Entra; si falta no se toca el montaje. */
  certPem?: string;
  /** Variables de entorno del proceso: de aquí salen los secretos que se copian a Dokploy. */
  processEnv: Record<string, string | undefined>;
}

/** Secretos y valores que, si están en el entorno del script, se copian a la aplicación. */
const PASSTHROUGH: Record<ServiceKey, { key: string; secret: boolean }[]> = {
  web: [
    { key: 'BETTER_AUTH_SECRET', secret: true },
    { key: 'MS_CLIENT_ID', secret: false },
    { key: 'MS_CLIENT_SECRET', secret: true },
    { key: 'MS_TENANT_ID', secret: false },
  ],
  worker: [
    { key: 'GRAPH_TENANT_ID', secret: false },
    { key: 'GRAPH_CLIENT_ID', secret: false },
    { key: 'ANTHROPIC_API_KEY', secret: true },
    { key: 'OPENROUTER_API_KEY', secret: true },
    { key: 'GOOGLE_GENERATIVE_AI_API_KEY', secret: true },
    { key: 'OPENAI_COMPATIBLE_BASE_URL', secret: false },
    { key: 'OPENAI_COMPATIBLE_API_KEY', secret: true },
    { key: 'UPTIME_KUMA_PUSH_URL', secret: true },
    // Dominios de correo del grupo (sin valor por defecto: sin ellos no hay remitentes internos).
    { key: 'INTERNAL_EMAIL_DOMAINS', secret: false },
    // Opcionales: sin ellas el worker usa sus valores por defecto.
    { key: 'ATTACHMENT_MAX_BYTES', secret: false },
    { key: 'ATTACHMENT_MAX_PAGES', secret: false },
    { key: 'DOCLING_TIMEOUT_SECONDS', secret: false },
  ],
  docling: [],
};

export interface EnvEntry {
  key: string;
  value: string;
  secret: boolean;
}

export interface ServiceHosts {
  /** `appName` real de cada servicio en Dokploy (Dokploy puede añadir un sufijo al crearlo). */
  db: string;
  docling: string;
}

/** Direcciones reales del buzón y del administrador: solo existen en el entorno de quien ejecuta. */
function requireWorkerIdentity(env: Record<string, string | undefined>): {
  mailbox: string;
  adminEmail: string;
} {
  const mailbox = env.MAILBOX?.trim();
  const adminEmail = env.ADMIN_EMAIL?.trim();
  const missing = [!mailbox && 'MAILBOX', !adminEmail && 'ADMIN_EMAIL'].filter(Boolean);
  if (!mailbox || !adminEmail) {
    throw new Error(
      `Faltan variables de entorno obligatorias para el worker de producción: ${missing.join(', ')}. ` +
        'MAILBOX es el buzón que se clasifica y ADMIN_EMAIL el administrador inicial del panel.',
    );
  }
  return { mailbox, adminEmail };
}

/** Variables que gestiona el script en cada aplicación; el resto de las que haya se respeta. */
export function buildEnv(
  key: ServiceKey,
  hosts: ServiceHosts,
  config: ProvisionConfig,
): EnvEntry[] {
  const plain = (k: string, value: string): EnvEntry => ({ key: k, value, secret: false });
  const entries: EnvEntry[] = [plain('TZ', 'Europe/Madrid')];

  if (key !== 'docling') {
    if (config.dbPassword) {
      const url = `postgresql://${DB_USER}:${encodeURIComponent(config.dbPassword)}@${hosts.db}:5432/${DB_NAME}`;
      entries.push({ key: 'DATABASE_URL', value: url, secret: true });
    }
    entries.push(plain('SYNC_STALE_SECONDS', '300'));
  }
  if (key === 'worker') {
    // Solo el worker tiene el certificado y las credenciales de Graph: el panel lee y crea
    // categorías del buzón a través de él.
    const { mailbox, adminEmail } = requireWorkerIdentity(config.processEnv);
    entries.push(
      plain('MAILBOX', mailbox),
      plain('ADMIN_EMAIL', adminEmail),
      plain('GRAPH_CERT_PATH', CERT_MOUNT_PATH),
    );
    entries.push(
      plain('MODE', 'shadow'),
      plain('DOCLING_URL', `http://${hosts.docling}:${DOCLING_PORT}`),
      plain('HEALTH_PORT', '8080'),
      plain('POLL_INTERVAL_SECONDS', '90'),
      plain('WORKER_CONCURRENCY', '2'),
      plain('CLASSIFY_CONFIDENCE_THRESHOLD', '0.8'),
    );
  }
  if (key === 'web') {
    entries.push(plain('BETTER_AUTH_URL', `https://${config.domainHost ?? DOMAIN_HOST}`));
  }
  for (const { key: name, secret } of PASSTHROUGH[key]) {
    const value = config.processEnv[name];
    if (value) entries.push({ key: name, value, secret });
  }
  return entries;
}

// ── Cálculo de diferencias (funciones puras) ───────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** JSON con las claves ordenadas, para comparar objetos sin importar el orden. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Campos de `desired` que difieren de `actual` (la memoria se compara como texto). */
export function diffFields(
  desired: Record<string, unknown>,
  actual: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, after] of Object.entries(desired)) {
    const before = actual[field];
    const same =
      typeof after === 'string' || typeof after === 'number'
        ? String(before ?? '') === String(after)
        : stable(before) === stable(after);
    if (!same) changes.push({ field, before: before ?? null, after });
  }
  return changes;
}

export interface MergedEnv {
  text: string;
  /** Claves añadidas o con valor distinto; los valores nunca se incluyen. */
  changed: { key: string; kind: 'add' | 'change'; secret: boolean }[];
}

/** Aplica `entries` sobre el `env` actual conservando el resto de líneas, comentarios incluidos. */
export function mergeEnv(current: string | null | undefined, entries: EnvEntry[]): MergedEnv {
  const lines = (current ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const changed: MergedEnv['changed'] = [];
  for (const entry of entries) {
    const line = `${entry.key}=${entry.value}`;
    const index = lines.findIndex((l) => l.startsWith(`${entry.key}=`));
    if (index === -1) {
      lines.push(line);
      changed.push({ key: entry.key, kind: 'add', secret: entry.secret });
    } else if (lines[index] !== line) {
      lines[index] = line;
      changed.push({ key: entry.key, kind: 'change', secret: entry.secret });
    }
  }
  return { text: lines.length ? `${lines.join('\n')}\n` : '', changed };
}

export interface ApplicationInfo {
  applicationId: string;
  appName: string;
  name?: string;
  env?: string | null;
  buildArgs?: string | null;
  buildSecrets?: string | null;
  createEnvFile?: boolean;
  sourceType?: string | null;
  dockerImage?: string | null;
  autoDeploy?: boolean | null;
  replicas?: number | null;
  memoryLimit?: string | null;
  memoryReservation?: string | null;
  healthCheckSwarm?: unknown;
  applicationStatus?: string | null;
}

/** Campos de `application.update` que deben cambiar (la imagen no: la fija el flujo de publicación). */
export function diffApplication(spec: AppSpec, actual: ApplicationInfo): FieldChange[] {
  return diffFields(
    {
      sourceType: 'docker',
      autoDeploy: false,
      replicas: 1,
      memoryReservation: String(spec.memoryReservation),
      memoryLimit: String(spec.memoryLimit),
      healthCheckSwarm: spec.healthCheck,
    },
    actual as unknown as Record<string, unknown>,
  );
}

export interface PostgresInfo {
  postgresId: string;
  appName: string;
  dockerImage?: string | null;
  memoryLimit?: string | null;
  memoryReservation?: string | null;
  healthCheckSwarm?: unknown;
  externalPort?: number | null;
  env?: string | null;
  applicationStatus?: string | null;
  backups?: BackupInfo[];
}

export function diffPostgres(actual: PostgresInfo): FieldChange[] {
  return diffFields(
    {
      memoryReservation: String(POSTGRES_SPEC.memoryReservation),
      memoryLimit: String(POSTGRES_SPEC.memoryLimit),
      healthCheckSwarm: POSTGRES_SPEC.healthCheck,
      // La base de datos solo se alcanza por la red interna de Docker.
      externalPort: null,
    },
    actual as unknown as Record<string, unknown>,
  );
}

export interface BackupInfo {
  backupId: string;
  schedule?: string;
  prefix?: string;
  destinationId?: string;
  database?: string;
  databaseType?: string;
  enabled?: boolean | null;
  keepLatestCount?: number | null;
  serviceName?: string | null;
  metadata?: unknown;
}

export function diffBackup(destinationId: string, actual: BackupInfo): FieldChange[] {
  return diffFields(
    {
      schedule: BACKUP_SPEC.schedule,
      prefix: BACKUP_SPEC.prefix,
      destinationId,
      database: DB_NAME,
      databaseType: 'postgres',
      enabled: true,
      keepLatestCount: BACKUP_SPEC.keepLatestCount,
    },
    actual as unknown as Record<string, unknown>,
  );
}

export interface DomainInfo {
  domainId: string;
  host: string;
  path?: string | null;
  port?: number | null;
  https?: boolean;
  certificateType?: string;
}

export function diffDomain(port: number, actual: DomainInfo): FieldChange[] {
  return diffFields(
    { path: '/', port, https: true, certificateType: 'letsencrypt' },
    actual as unknown as Record<string, unknown>,
  );
}

export interface MountInfo {
  mountId: string;
  type?: string;
  mountPath?: string;
  filePath?: string | null;
  content?: string | null;
}

// ── Acceso a la API ────────────────────────────────────────────────────────────────────────────

export interface Api {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

/** Acepta `https://panel`, `https://panel/` o `https://panel/api`. */
export function apiBase(url: string): string {
  return `${url.replace(/\/+$/, '').replace(/\/api$/, '')}/api`;
}

export function createApi(url: string, apiKey: string, fetchImpl: typeof fetch = fetch): Api {
  const base = apiBase(url);
  async function call<T>(method: 'GET' | 'POST', path: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(`${base}/${path}`, {
      method,
      ...init,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Dokploy ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  return {
    get: (path, query) =>
      call('GET', `${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {}),
    post: (path, body) => call('POST', path, { body: JSON.stringify(body) }),
  };
}

// ── Reconciliación ─────────────────────────────────────────────────────────────────────────────

interface ProjectSummary {
  projectId: string;
  name: string;
  environments?: {
    environmentId: string;
    name: string;
    applications?: { applicationId: string; name: string }[];
    postgres?: { postgresId: string; name: string }[];
  }[];
}

interface Destination {
  destinationId: string;
  name: string;
}

export interface ReconcileResult {
  /** Operaciones de escritura (hechas con --apply o pendientes en --dry-run). */
  changes: number;
  /** Servicios ya desplegados cuya configuración cambió y necesitan un redespliegue. */
  needsRedeploy: string[];
  warnings: string[];
}

export interface ReconcileOptions {
  /** Sin API (sin credenciales) se asume un Dokploy vacío. */
  api: Api | null;
  apply: boolean;
  config: ProvisionConfig;
  log: (line: string) => void;
}

const PLACEHOLDER_ID = '<id nuevo>';

function show(value: unknown): string {
  const text = typeof value === 'string' ? value : stable(value);
  return text.length > 70 ? `${text.slice(0, 67)}...` : text;
}

/**
 * Compara lo deseado con el estado real de Dokploy y lo corrige (con `apply`) o lo describe.
 * Ejecutarlo dos veces seguidas no hace ninguna escritura la segunda vez.
 */
export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const { api, apply, config, log } = options;
  const result: ReconcileResult = { changes: 0, needsRedeploy: [], warnings: [] };
  const live = api !== null;
  const mode = apply ? '' : ' (simulado)';

  /** Una escritura: se hace con --apply; si no, solo se cuenta y se muestra. */
  async function write<T>(
    endpoint: string,
    body: Record<string, unknown>,
    description: string,
    fallback: T,
  ): Promise<T> {
    result.changes++;
    log(`  ${apply ? '*' : '~'} ${description}`);
    if (!apply || !api) return fallback;
    return api.post<T>(endpoint, body);
  }
  const unchanged = (what: string): void => log(`  = ${what}`);
  const describeChanges = (changes: FieldChange[]): string =>
    changes.map((c) => `${c.field}: ${show(c.before)} → ${show(c.after)}`).join('; ');

  if (!config.dbPassword) {
    result.warnings.push(
      'Sin CLASIFICADOR_DB_PASSWORD no se escribe DATABASE_URL en web ni worker (ni se puede crear PostgreSQL).',
    );
  }

  // 1. Proyecto y entorno
  log(`Proyecto ${PROJECT_NAME} (entorno ${ENVIRONMENT_NAME})${mode}`);
  let projects: ProjectSummary[] = [];
  if (api) projects = await api.get<ProjectSummary[]>('project.all');
  const project = projects.find((p) => p.name === PROJECT_NAME);
  let environmentId = PLACEHOLDER_ID;
  const environment = project?.environments?.find((e) => e.name === ENVIRONMENT_NAME);
  if (project && !environment) {
    throw new Error(`El proyecto ${PROJECT_NAME} existe pero no tiene el entorno ${ENVIRONMENT_NAME}.`);
  }
  if (!project) {
    const created = await write<{ project: { projectId: string }; environment: { environmentId: string; name?: string } }>(
      'project.create',
      { name: PROJECT_NAME, description: 'Clasificador del buzón de Proveedores (FOOD BOX, LATERAL, ARCOBETA)' },
      `crear el proyecto ${PROJECT_NAME}`,
      { project: { projectId: PLACEHOLDER_ID }, environment: { environmentId: PLACEHOLDER_ID } },
    );
    environmentId = created.environment.environmentId;
    if (created.environment.name && created.environment.name !== ENVIRONMENT_NAME) {
      result.warnings.push(
        `El entorno creado por Dokploy se llama "${created.environment.name}", no "${ENVIRONMENT_NAME}".`,
      );
    }
  } else {
    environmentId = environment!.environmentId;
    unchanged('proyecto y entorno existen');
  }

  // 2. PostgreSQL nativo
  log(`\nPostgreSQL ${POSTGRES_SPEC.name}${mode}`);
  const existingPg = environment?.postgres?.find((p) => p.name === POSTGRES_SPEC.name);
  let pg: PostgresInfo | null = null;
  if (existingPg && api) {
    pg = await api.get<PostgresInfo>('postgres.one', { postgresId: existingPg.postgresId });
  }
  let pgId = pg?.postgresId ?? PLACEHOLDER_ID;
  let pgApp = pg?.appName ?? `<appName de ${POSTGRES_SPEC.name}>`;
  let pgFresh = false;
  if (!pg) {
    if (apply && !config.dbPassword) {
      throw new Error('Para crear PostgreSQL falta CLASIFICADOR_DB_PASSWORD (solo letras y números).');
    }
    const created = await write<{ postgresId: string; appName: string }>(
      'postgres.create',
      {
        name: POSTGRES_SPEC.name,
        appName: POSTGRES_SPEC.name,
        databaseName: DB_NAME,
        databaseUser: DB_USER,
        databasePassword: config.dbPassword ?? '',
        dockerImage: POSTGRES_IMAGE,
        environmentId,
        description: 'Base de datos del clasificador y cola pg-boss',
      },
      `crear ${POSTGRES_SPEC.name} (${POSTGRES_IMAGE})`,
      { postgresId: PLACEHOLDER_ID, appName: pgApp },
    );
    pgId = created.postgresId;
    pgApp = created.appName ?? pgApp;
    pgFresh = true;
    if (apply && api) {
      pg = await api.get<PostgresInfo>('postgres.one', { postgresId: pgId });
      pgApp = pg.appName;
    }
  }
  const pgChanges = pg ? diffPostgres(pg) : diffPostgres({ postgresId: pgId, appName: pgApp });
  if (pgChanges.length > 0) {
    const patch = Object.fromEntries(pgChanges.filter((c) => c.field !== 'externalPort').map((c) => [c.field, c.after]));
    if (Object.keys(patch).length > 0) {
      await write(
        'postgres.update',
        { postgresId: pgId, ...patch },
        `${POSTGRES_SPEC.name}: ${describeChanges(pgChanges.filter((c) => c.field !== 'externalPort'))}`,
        null,
      );
    }
    if (pgChanges.some((c) => c.field === 'externalPort')) {
      await write(
        'postgres.saveExternalPort',
        { postgresId: pgId, externalPort: null },
        `${POSTGRES_SPEC.name}: dejar de publicar el puerto (externalPort → null)`,
        null,
      );
    }
    if (!pgFresh && pg?.applicationStatus && pg.applicationStatus !== 'idle') {
      result.needsRedeploy.push(POSTGRES_SPEC.name);
    }
  } else {
    unchanged(`${POSTGRES_SPEC.name}: memoria, comprobación de salud y puerto correctos`);
  }

  // 2b. Copia de seguridad diaria al destino existente
  let destinationId = PLACEHOLDER_ID;
  if (api) {
    const destinations = await api.get<Destination[]>('destination.all');
    const destination = destinations.find((d) => d.name === config.backupDestinationName);
    if (!destination) {
      throw new Error(
        `No existe el destino de copias "${config.backupDestinationName}" en Dokploy ` +
          `(destinos: ${destinations.map((d) => d.name).join(', ') || 'ninguno'}).`,
      );
    }
    destinationId = destination.destinationId;
  }
  const backup = pg?.backups?.find((b) => b.databaseType === 'postgres' && b.prefix === BACKUP_SPEC.prefix) ??
    pg?.backups?.find((b) => b.databaseType === 'postgres');
  if (!backup) {
    await write(
      'backup.create',
      {
        postgresId: pgId,
        schedule: BACKUP_SPEC.schedule,
        prefix: BACKUP_SPEC.prefix,
        destinationId,
        database: DB_NAME,
        databaseType: 'postgres',
        backupType: 'database',
        enabled: true,
        keepLatestCount: BACKUP_SPEC.keepLatestCount,
      },
      `copia diaria (${BACKUP_SPEC.schedule}) a "${config.backupDestinationName}", ${BACKUP_SPEC.keepLatestCount} copias`,
      null,
    );
  } else {
    const changes = diffBackup(destinationId, backup);
    if (changes.length === 0) unchanged('copia de seguridad diaria correcta');
    else {
      await write(
        'backup.update',
        {
          backupId: backup.backupId,
          schedule: BACKUP_SPEC.schedule,
          prefix: BACKUP_SPEC.prefix,
          destinationId,
          database: DB_NAME,
          databaseType: 'postgres',
          enabled: true,
          keepLatestCount: BACKUP_SPEC.keepLatestCount,
          serviceName: backup.serviceName ?? null,
          metadata: backup.metadata ?? null,
        },
        `copia de seguridad: ${describeChanges(changes)}`,
        null,
      );
    }
  }
  if (pgFresh || (pg?.applicationStatus ?? 'idle') === 'idle') {
    await write('postgres.deploy', { postgresId: pgId }, `desplegar ${POSTGRES_SPEC.name} (primera vez)`, null);
  }

  // 3. Aplicaciones: docling primero (el worker necesita su appName), después worker y web
  const appNames: Partial<Record<ServiceKey, string>> = {};
  const appIds: Partial<Record<ServiceKey, string>> = {};
  const existingApps = environment?.applications ?? [];
  const doclingKnown = existingApps.find((a) => a.name === APPS.docling.name);
  let doclingAppName = `<appName de ${APPS.docling.name}>`;
  if (doclingKnown && api) {
    doclingAppName = (await api.get<ApplicationInfo>('application.one', { applicationId: doclingKnown.applicationId })).appName;
  }

  for (const key of ['docling', 'worker', 'web'] as const) {
    const spec = APPS[key];
    log(`\nApplication ${spec.name}${mode}`);
    const known = existingApps.find((a) => a.name === spec.name);
    let app: ApplicationInfo | null = null;
    if (known && api) {
      app = await api.get<ApplicationInfo>('application.one', { applicationId: known.applicationId });
    }
    let fresh = false;
    let appId = app?.applicationId ?? PLACEHOLDER_ID;
    if (!app) {
      const image = initialImage(key, config);
      const created = await write<{ applicationId: string; appName?: string }>(
        'application.create',
        { name: spec.name, appName: spec.name, environmentId, sourceType: 'docker', description: spec.name },
        `crear ${spec.name}`,
        { applicationId: PLACEHOLDER_ID },
      );
      appId = created.applicationId;
      fresh = true;
      await write(
        'application.saveDockerProvider',
        {
          applicationId: appId,
          dockerImage: image,
          username: config.registryUsername ?? null,
          password: config.registryPassword ?? null,
          registryUrl: key === 'docling' || !config.registryUsername ? null : 'ghcr.io',
        },
        `imagen inicial ${image}`,
        null,
      );
      if (apply && api) app = await api.get<ApplicationInfo>('application.one', { applicationId: appId });
    }
    appIds[key] = appId;
    const appName = app?.appName ?? `<appName de ${spec.name}>`;
    appNames[key] = appName;
    if (key === 'docling') doclingAppName = appName;

    const changes = diffApplication(spec, app ?? { applicationId: appId, appName });
    if (changes.length > 0) {
      await write(
        'application.update',
        { applicationId: appId, ...Object.fromEntries(changes.map((c) => [c.field, c.after])) },
        `${spec.name}: ${describeChanges(changes)}`,
        null,
      );
    } else {
      unchanged('memoria, comprobación de salud, autoDeploy apagado y réplicas correctos');
    }

    // Variables de entorno: solo las gestionadas; se conservan las demás.
    const merged = mergeEnv(
      app?.env,
      buildEnv(key, { db: pgApp, docling: doclingAppName }, config),
    );
    if (merged.changed.length > 0) {
      await write(
        'application.saveEnvironment',
        {
          applicationId: appId,
          env: merged.text,
          buildArgs: app?.buildArgs ?? null,
          buildSecrets: app?.buildSecrets ?? null,
          createEnvFile: app?.createEnvFile ?? true,
        },
        `variables de entorno: ${merged.changed
          .map((c) => `${c.kind === 'add' ? '+' : '~'}${c.key}${c.secret ? ' (secreto)' : ''}`)
          .join(', ')}`,
        null,
      );
    } else {
      unchanged('variables de entorno gestionadas correctas');
    }

    // Certificado de Graph como fichero montado: solo el worker lo necesita. La web (expuesta a
    // Internet) no debe llevarlo: si ya lo tiene de una versión anterior, se avisa de que lo quite.
    if (key === 'worker') {
      await reconcileCertMount(spec.name, appId, live && !fresh, config, api, write, unchanged, result);
    } else if (key === 'web' && live && !fresh && api) {
      const mounts = await api.get<MountInfo[]>('mounts.listByServiceId', { serviceType: 'application', serviceId: appId });
      if (mounts.some((m) => m.mountPath === CERT_MOUNT_PATH)) {
        result.warnings.push(
          `${spec.name}: tiene montado el certificado de Graph en ${CERT_MOUNT_PATH} y ya no lo necesita; elimina el montaje en Dokploy (el script no borra nada).`,
        );
      }
    }

    // Dominio solo en la web.
    if (key === 'web') {
      const host = config.domainHost ?? DOMAIN_HOST;
      const domains =
        live && !fresh ? await api!.get<DomainInfo[]>('domain.byApplicationId', { applicationId: appId }) : [];
      const domain = domains.find((d) => d.host === host);
      if (!domain) {
        await write(
          'domain.create',
          {
            host,
            path: '/',
            port: spec.port,
            https: true,
            certificateType: 'letsencrypt',
            applicationId: appId,
            domainType: 'application',
          },
          `dominio ${host} → puerto ${spec.port} con Let's Encrypt`,
          null,
        );
      } else {
        const domainChanges = diffDomain(spec.port, domain);
        if (domainChanges.length === 0) unchanged(`dominio ${host} correcto`);
        else {
          await write(
            'domain.update',
            { domainId: domain.domainId, host, path: '/', port: spec.port, https: true, certificateType: 'letsencrypt' },
            `dominio ${host}: ${describeChanges(domainChanges)}`,
            null,
          );
        }
      }
      const others = domains.filter((d) => d.host !== host);
      if (others.length > 0) {
        result.warnings.push(`${spec.name} tiene dominios no gestionados: ${others.map((d) => d.host).join(', ')}.`);
      }
    } else if (live && !fresh) {
      const domains = await api!.get<DomainInfo[]>('domain.byApplicationId', { applicationId: appId });
      if (domains.length > 0) {
        result.warnings.push(`${spec.name} no debería tener dominio y tiene: ${domains.map((d) => d.host).join(', ')}.`);
      }
    }

    // Despliegue: solo la infraestructura sin versión propia (docling) y solo la primera vez.
    if (key === 'docling') {
      if (fresh || (app?.applicationStatus ?? 'idle') === 'idle') {
        await write(
          'application.deploy',
          { applicationId: appId, title: 'Primer despliegue', description: 'Alta con provision.ts' },
          `desplegar ${spec.name} (primera vez)`,
          null,
        );
      } else if (changes.length > 0 || merged.changed.length > 0) {
        result.needsRedeploy.push(spec.name);
      }
    } else if (!fresh && app?.applicationStatus && app.applicationStatus !== 'idle') {
      if (changes.length > 0 || merged.changed.length > 0) result.needsRedeploy.push(spec.name);
    }
  }

  return result;
}

function initialImage(key: ServiceKey, config: ProvisionConfig): string {
  if (key === 'docling') return DOCLING_IMAGE;
  const explicit = key === 'web' ? config.webImage : config.workerImage;
  return explicit ?? `ghcr.io/${config.ghcrOwner}/clasificador-${key}:latest`;
}

async function reconcileCertMount(
  appName: string,
  appId: string,
  readable: boolean,
  config: ProvisionConfig,
  api: Api | null,
  write: <T>(e: string, b: Record<string, unknown>, d: string, f: T) => Promise<T>,
  unchanged: (what: string) => void,
  result: ReconcileResult,
): Promise<void> {
  const mounts =
    readable && api
      ? await api.get<MountInfo[]>('mounts.listByServiceId', { serviceType: 'application', serviceId: appId })
      : [];
  const mount = mounts.find((m) => m.mountPath === CERT_MOUNT_PATH);
  if (!config.certPem) {
    if (!mount) {
      result.warnings.push(
        `${appName}: falta el certificado de Graph en ${CERT_MOUNT_PATH}; define GRAPH_CERT_PEM_FILE y vuelve a ejecutar.`,
      );
    } else unchanged(`certificado montado en ${CERT_MOUNT_PATH} (contenido no comprobado)`);
    return;
  }
  if (!mount) {
    await write(
      'mounts.create',
      {
        type: 'file',
        mountPath: CERT_MOUNT_PATH,
        filePath: CERT_FILE_NAME,
        content: config.certPem,
        serviceId: appId,
        serviceType: 'application',
      },
      `montar el certificado de Graph en ${CERT_MOUNT_PATH} (contenido secreto)`,
      null,
    );
  } else if (mount.content !== config.certPem || mount.type !== 'file') {
    await write(
      'mounts.update',
      { mountId: mount.mountId, type: 'file', mountPath: CERT_MOUNT_PATH, filePath: CERT_FILE_NAME, content: config.certPem },
      `actualizar el certificado montado en ${CERT_MOUNT_PATH} (contenido secreto)`,
      null,
    );
  } else {
    unchanged(`certificado montado en ${CERT_MOUNT_PATH} correcto`);
  }
}

// ── Línea de órdenes ───────────────────────────────────────────────────────────────────────────

export function configFromEnv(env: Record<string, string | undefined>): ProvisionConfig {
  const pemFile = env.GRAPH_CERT_PEM_FILE;
  const dbPassword = env.CLASIFICADOR_DB_PASSWORD;
  // Dokploy rechaza otros caracteres, y así la URL de conexión no necesita escapes.
  if (dbPassword !== undefined && !/^[A-Za-z0-9]{16,}$/.test(dbPassword)) {
    throw new Error('CLASIFICADOR_DB_PASSWORD debe tener al menos 16 caracteres, solo letras y números.');
  }
  const panelDomain = env.PANEL_DOMAIN?.trim().toLowerCase();
  if (panelDomain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(panelDomain)) {
    throw new Error('PANEL_DOMAIN debe ser un nombre de dominio, sin https:// ni ruta (p. ej. panel.ejemplo.com).');
  }
  return {
    ghcrOwner: env.GHCR_OWNER || '<GHCR_OWNER>',
    ...(env.WEB_IMAGE ? { webImage: env.WEB_IMAGE } : {}),
    ...(env.WORKER_IMAGE ? { workerImage: env.WORKER_IMAGE } : {}),
    ...(env.GHCR_USERNAME ? { registryUsername: env.GHCR_USERNAME } : {}),
    ...(env.GHCR_TOKEN ? { registryPassword: env.GHCR_TOKEN } : {}),
    ...(dbPassword ? { dbPassword } : {}),
    backupDestinationName: env.BACKUP_DESTINATION_NAME || DEFAULT_BACKUP_DESTINATION,
    ...(panelDomain ? { domainHost: panelDomain } : {}),
    ...(pemFile ? { certPem: readFileSync(pemFile, 'utf8') } : {}),
    processEnv: env,
  };
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const known = new Set(['--dry-run', '--apply', '--check']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(`Opción desconocida: ${unknown.join(' ')}. Usa --dry-run (por defecto), --apply o --check.`);
    return 1;
  }
  const apply = argv.includes('--apply');
  if (apply && argv.some((a) => a === '--dry-run' || a === '--check')) {
    console.error('--apply no se combina con --dry-run ni con --check.');
    return 1;
  }

  const url = env.DOKPLOY_URL;
  const key = env.DOKPLOY_API_KEY;
  if (apply && (!url || !key)) {
    console.error('--apply necesita DOKPLOY_URL y DOKPLOY_API_KEY en el entorno.');
    return 1;
  }
  const api = url && key ? createApi(url, key) : null;
  if (!api) {
    console.log('Sin DOKPLOY_URL/DOKPLOY_API_KEY: se muestra lo que se crearía en un Dokploy vacío.\n');
  }
  if (apply && env.GHCR_OWNER === undefined) {
    console.error('--apply necesita GHCR_OWNER (propietario de las imágenes en GHCR).');
    return 1;
  }

  const result = await reconcile({ api, apply, config: configFromEnv(env), log: console.log });
  console.log('');
  for (const w of result.warnings) console.log(`AVISO: ${w}`);
  if (result.needsRedeploy.length > 0) {
    console.log(
      `Cambios que necesitan un redespliegue para surtir efecto: ${result.needsRedeploy.join(', ')} ` +
        '(en web y worker, desplegando de nuevo la etiqueta actual).',
    );
  }
  if (result.changes === 0) console.log('Sin diferencias: Dokploy ya coincide con lo descrito.');
  else console.log(apply ? `${result.changes} cambio(s) aplicados.` : `${result.changes} cambio(s) pendientes (no se ha escrito nada).`);
  return !apply && argv.includes('--check') && result.changes > 0 ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
