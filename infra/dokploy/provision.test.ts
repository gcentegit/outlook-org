import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APPS,
  BACKUP_SPEC,
  CERT_MOUNT_PATH,
  DOMAIN_HOST,
  POSTGRES_SPEC,
  PROJECT_NAME,
  apiBase,
  buildEnv,
  configFromEnv,
  diffApplication,
  diffBackup,
  diffDomain,
  diffFields,
  diffPostgres,
  main,
  mergeEnv,
  reconcile,
  stable,
  type Api,
  type ProvisionConfig,
} from './provision.ts';

const PASSWORD = 'abcdefghijklmnop1234';
const PEM = '-----BEGIN CERTIFICATE-----\nSECRETO\n-----END CERTIFICATE-----\n';

const baseConfig = (over: Partial<ProvisionConfig> = {}): ProvisionConfig => ({
  ghcrOwner: 'gcentegit',
  dbPassword: PASSWORD,
  backupDestinationName: 'S3 Minio Dokploy Proyectos',
  certPem: PEM,
  processEnv: {
    GRAPH_TENANT_ID: 'tenant',
    ANTHROPIC_API_KEY: 'sk-ant-secreta',
    MAILBOX: 'buzon@ejemplo.com',
    ADMIN_EMAIL: 'admin@ejemplo.com',
  },
  ...over,
});

function omit(config: ProvisionConfig, key: keyof ProvisionConfig): ProvisionConfig {
  const copy = { ...config };
  delete copy[key];
  return copy;
}

type Rec = Record<string, unknown> & { appName: string };

/** Dokploy simulado en memoria: lo justo para comprobar la idempotencia. */
class FakeDokploy implements Api {
  projects: { projectId: string; name: string; environmentId: string }[] = [];
  apps = new Map<string, Rec>();
  databases = new Map<string, Rec>();
  domains = new Map<string, Rec[]>();
  mounts = new Map<string, Rec[]>();
  destinations = [{ destinationId: 'dest1', name: 'S3 Minio Dokploy Proyectos' }];
  writes: { endpoint: string; body: Record<string, unknown> }[] = [];
  private seq = 0;
  private id = (prefix: string): string => `${prefix}${++this.seq}`;

  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    switch (path) {
      case 'project.all':
        return this.projects.map((p) => ({
          projectId: p.projectId,
          name: p.name,
          environments: [
            {
              environmentId: p.environmentId,
              name: 'production',
              applications: [...this.apps.values()].map((a) => ({ applicationId: a.applicationId, name: a.name })),
              postgres: [...this.databases.values()].map((d) => ({ postgresId: d.postgresId, name: d.name })),
            },
          ],
        })) as T;
      case 'application.one':
        return this.apps.get(query.applicationId!) as T;
      case 'postgres.one':
        return this.databases.get(query.postgresId!) as T;
      case 'destination.all':
        return this.destinations as T;
      case 'domain.byApplicationId':
        return (this.domains.get(query.applicationId!) ?? []) as T;
      case 'mounts.listByServiceId':
        return (this.mounts.get(query.serviceId!) ?? []) as T;
      default:
        throw new Error(`GET no simulado: ${path}`);
    }
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const b = body as Record<string, unknown>;
    this.writes.push({ endpoint: path, body: b });
    switch (path) {
      case 'project.create': {
        const project = { projectId: this.id('proj'), name: b.name as string, environmentId: this.id('env') };
        this.projects.push(project);
        return { project, environment: { environmentId: project.environmentId, name: 'production' } } as T;
      }
      case 'application.create': {
        const applicationId = this.id('app');
        const rec = { applicationId, name: b.name as string, appName: `${String(b.appName)}-x7k2`, applicationStatus: 'idle', env: null, healthCheckSwarm: null, memoryLimit: null, memoryReservation: null, autoDeploy: true, replicas: 1, sourceType: 'docker', buildArgs: null, buildSecrets: null, createEnvFile: true };
        this.apps.set(applicationId, rec);
        return rec as T;
      }
      case 'application.saveDockerProvider':
        Object.assign(this.apps.get(b.applicationId as string)!, { dockerImage: b.dockerImage });
        return null as T;
      case 'application.update': {
        const { applicationId, ...fields } = b;
        Object.assign(this.apps.get(applicationId as string)!, fields);
        return null as T;
      }
      case 'application.saveEnvironment':
        this.apps.get(b.applicationId as string)!.env = b.env;
        return null as T;
      case 'application.deploy':
        this.apps.get(b.applicationId as string)!.applicationStatus = 'running';
        return null as T;
      case 'postgres.create': {
        const postgresId = this.id('pg');
        const rec = { postgresId, name: b.name as string, appName: `${String(b.appName)}-q9z1`, applicationStatus: 'idle', externalPort: null, memoryLimit: null, memoryReservation: null, healthCheckSwarm: null, backups: [] as Rec[] };
        this.databases.set(postgresId, rec);
        return rec as T;
      }
      case 'postgres.update': {
        const { postgresId, ...fields } = b;
        Object.assign(this.databases.get(postgresId as string)!, fields);
        return null as T;
      }
      case 'postgres.deploy':
        this.databases.get(b.postgresId as string)!.applicationStatus = 'running';
        return null as T;
      case 'backup.create': {
        const db = this.databases.get(b.postgresId as string)!;
        (db.backups as Rec[]).push({ backupId: this.id('bk'), appName: '', ...b });
        return null as T;
      }
      case 'domain.create': {
        const list = this.domains.get(b.applicationId as string) ?? [];
        list.push({ domainId: this.id('dom'), appName: '', ...b });
        this.domains.set(b.applicationId as string, list);
        return null as T;
      }
      case 'mounts.create': {
        const list = this.mounts.get(b.serviceId as string) ?? [];
        list.push({ mountId: this.id('mnt'), appName: '', ...b });
        this.mounts.set(b.serviceId as string, list);
        return null as T;
      }
      default:
        throw new Error(`POST no simulado: ${path}`);
    }
  }
}

const run = (api: FakeDokploy | null, apply: boolean, config = baseConfig()) => {
  const lines: string[] = [];
  return reconcile({ api, apply, config, log: (l) => lines.push(l) }).then((result) => ({ result, lines, output: lines.join('\n') }));
};

const appByName = (api: FakeDokploy, name: string): Rec => [...api.apps.values()].find((a) => a.name === name)!;

describe('funciones de diferencias', () => {
  it('stable ignora el orden de las claves', () => {
    expect(stable({ a: 1, b: { c: 2, d: 3 } })).toBe(stable({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stable(undefined)).toBe(stable(null));
  });

  it('diffFields compara números y textos por valor y objetos sin importar el orden', () => {
    expect(
      diffFields(
        { memoryLimit: '536870912', replicas: 1, healthCheckSwarm: { A: 1, B: 2 }, externalPort: null },
        { memoryLimit: 536870912, replicas: '1', healthCheckSwarm: { B: 2, A: 1 }, externalPort: null },
      ),
    ).toEqual([]);
    expect(diffFields({ autoDeploy: false }, { autoDeploy: true })).toEqual([{ field: 'autoDeploy', before: true, after: false }]);
    expect(diffFields({ memoryLimit: '1' }, {})).toEqual([{ field: 'memoryLimit', before: null, after: '1' }]);
  });

  it('diffApplication: una aplicación correcta no tiene diferencias y una por defecto las tiene todas', () => {
    const ok = {
      applicationId: 'a', appName: 'x', sourceType: 'docker', autoDeploy: false, replicas: 1,
      memoryReservation: String(APPS.web.memoryReservation), memoryLimit: String(APPS.web.memoryLimit),
      healthCheckSwarm: APPS.web.healthCheck,
    };
    expect(diffApplication(APPS.web, ok)).toEqual([]);
    const defaults = { applicationId: 'a', appName: 'x', autoDeploy: true, memoryLimit: null, healthCheckSwarm: null };
    expect(diffApplication(APPS.web, defaults).map((c) => c.field).sort()).toEqual(
      ['autoDeploy', 'healthCheckSwarm', 'memoryLimit', 'memoryReservation', 'replicas', 'sourceType'],
    );
  });

  it('diffPostgres exige puerto no publicado, memoria y comprobación de salud', () => {
    const changes = diffPostgres({ postgresId: 'p', appName: 'x', externalPort: 5432 });
    expect(changes.map((c) => c.field).sort()).toEqual(['externalPort', 'healthCheckSwarm', 'memoryLimit', 'memoryReservation']);
  });

  it('diffBackup detecta destino, calendario o número de copias distintos', () => {
    const ok = { backupId: 'b', schedule: BACKUP_SPEC.schedule, prefix: BACKUP_SPEC.prefix, destinationId: 'd', database: 'clasificador', databaseType: 'postgres', enabled: true, keepLatestCount: 7 };
    expect(diffBackup('d', ok)).toEqual([]);
    expect(diffBackup('otro', { ...ok, keepLatestCount: 3, enabled: false }).map((c) => c.field).sort()).toEqual(['destinationId', 'enabled', 'keepLatestCount']);
  });

  it('diffDomain compara puerto, HTTPS y certificado', () => {
    expect(diffDomain(3000, { domainId: 'd', host: DOMAIN_HOST, path: '/', port: 3000, https: true, certificateType: 'letsencrypt' })).toEqual([]);
    expect(diffDomain(3000, { domainId: 'd', host: DOMAIN_HOST, path: '/', port: 80, https: false, certificateType: 'none' })).toHaveLength(3);
  });

  it('apiBase admite la URL con o sin /api y barra final', () => {
    for (const url of ['https://p.example', 'https://p.example/', 'https://p.example/api', 'https://p.example/api/']) {
      expect(apiBase(url)).toBe('https://p.example/api');
    }
  });
});

describe('variables de entorno', () => {
  const hosts = { db: 'clasificador-db-q9z1', docling: 'clasificador-docling-x7k2' };

  it('el worker apunta a docling y a la base por su appName y arranca en modo sombra', () => {
    const env = Object.fromEntries(buildEnv('worker', hosts, baseConfig()).map((e) => [e.key, e.value]));
    expect(env.DOCLING_URL).toBe('http://clasificador-docling-x7k2:5001');
    expect(env.DATABASE_URL).toBe(`postgresql://clasificador:${PASSWORD}@clasificador-db-q9z1:5432/clasificador`);
    expect(env.MODE).toBe('shadow');
    expect(env.GRAPH_CERT_PATH).toBe(CERT_MOUNT_PATH);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-secreta');
    expect(env).not.toHaveProperty('APP_VERSION');
    expect(env).not.toHaveProperty('APP_COMMIT');
  });

  it('la web no recibe ninguna credencial de Graph ni el buzón; el worker sí', () => {
    const processEnv = {
      GRAPH_TENANT_ID: 't',
      GRAPH_CLIENT_ID: 'c',
      MAILBOX: 'otro@ejemplo.com',
      ADMIN_EMAIL: 'admin@ejemplo.com',
      GRAPH_CERT_PATH: '/x.pem',
    };
    const web = buildEnv('web', hosts, baseConfig({ processEnv })).map((e) => e.key);
    expect(web.filter((k) => k.startsWith('GRAPH_') || k === 'MAILBOX')).toEqual([]);
    const worker = buildEnv('worker', hosts, baseConfig({ processEnv }));
    const keys = worker.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CERT_PATH', 'MAILBOX']));
    expect(worker.find((e) => e.key === 'MAILBOX')?.value).toBe('otro@ejemplo.com');
  });

  it('el worker pasa el administrador inicial y los dominios internos del entorno', () => {
    const processEnv = {
      MAILBOX: 'buzon@ejemplo.com',
      ADMIN_EMAIL: 'ana@ejemplo.com',
      INTERNAL_EMAIL_DOMAINS: 'ejemplo.com,interno.example',
    };
    const env = Object.fromEntries(buildEnv('worker', hosts, baseConfig({ processEnv })).map((e) => [e.key, e.value]));
    expect(env.ADMIN_EMAIL).toBe('ana@ejemplo.com');
    expect(env.INTERNAL_EMAIL_DOMAINS).toBe('ejemplo.com,interno.example');
  });

  it('el worker de producción exige MAILBOX y ADMIN_EMAIL, y lo dice', () => {
    const only = (name: string) => baseConfig({ processEnv: { [name]: 'x@ejemplo.com' } });
    expect(() => buildEnv('worker', hosts, baseConfig({ processEnv: {} }))).toThrow(/MAILBOX, ADMIN_EMAIL/);
    expect(() => buildEnv('worker', hosts, only('MAILBOX'))).toThrow(/ADMIN_EMAIL/);
    expect(() => buildEnv('worker', hosts, only('ADMIN_EMAIL'))).toThrow(/MAILBOX/);
    expect(() => buildEnv('worker', hosts, baseConfig({ processEnv: { MAILBOX: ' ', ADMIN_EMAIL: 'a@ejemplo.com' } }))).toThrow(/MAILBOX/);
    // La web no los necesita.
    expect(() => buildEnv('web', hosts, baseConfig({ processEnv: {} }))).not.toThrow();
  });

  it('el HEALTHCHECK del worker mide la vida del proceso (/livez), no la frescura de la sincronización', () => {
    const probe = APPS.worker.healthCheck.Test.join(' ');
    expect(probe).toContain('/livez');
    expect(probe).not.toContain('/health');
    expect(APPS.worker.healthCheck.StartPeriod).toBeGreaterThanOrEqual(120 * 1_000_000_000);
    // La web sigue comprobando /api/health.
    expect(APPS.web.healthCheck.Test.join(' ')).toContain('/api/health');
  });

  it('incluye todas las variables de .env.example que leen la web y el worker', () => {
    const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const documented = new Set(
      [...readFileSync(join(repo, '.env.example'), 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(
        (m) => m[1]!,
      ),
    );
    // Se fijan en la imagen o en el compose, o solo valen en desarrollo: Dokploy no las gestiona.
    const unmanaged = new Set([
      'APP_VERSION',
      'APP_COMMIT',
      'AUTH_DEV_BYPASS',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'POSTGRES_HOST_PORT',
      'WEB_HOST_PORT',
      'DOCLING_HOST_PORT',
    ]);

    // El panel nombra las claves de LLM solo como texto de ayuda: las lee el worker.
    const webLabelsOnly = new Set([
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAI_COMPATIBLE_API_KEY',
    ]);

    /** Variables documentadas que aparecen como identificador en el código (sin pruebas) de una app. */
    const read = (app: 'web' | 'worker'): string[] => {
      const dir = join(repo, 'apps', app, 'src');
      const found = new Set<string>();
      for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file) || file.includes('generated')) continue;
        for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
          if (!documented.has(m[0]) || unmanaged.has(m[0])) continue;
          if (app === 'web' && webLabelsOnly.has(m[0])) continue;
          found.add(m[0]);
        }
      }
      return [...found];
    };

    // Con todas las variables presentes en el entorno del script, cada una debe acabar en la aplicación.
    const processEnv = Object.fromEntries([...documented].map((name) => [name, 'valor']));
    for (const app of ['web', 'worker'] as const) {
      const managed = new Set(buildEnv(app, hosts, baseConfig({ processEnv })).map((e) => e.key));
      const missing = read(app).filter((name) => !managed.has(name));
      expect(missing, `variables que lee ${app} y buildEnv no escribe`).toEqual([]);
    }
  });

  it('sin contraseña de BD no toca DATABASE_URL, y los secretos ausentes no se escriben', () => {
    const keys = buildEnv('web', hosts, omit(baseConfig(), 'dbPassword')).map((e) => e.key);
    expect(keys).not.toContain('DATABASE_URL');
    expect(keys).not.toContain('BETTER_AUTH_SECRET');
    expect(keys).toContain('BETTER_AUTH_URL');
  });

  it('mergeEnv conserva las demás líneas y solo marca lo que cambia', () => {
    const merged = mergeEnv('# nota\nMODE=shadow\nOTRA=1\n', [
      { key: 'MODE', value: 'shadow', secret: false },
      { key: 'TZ', value: 'Europe/Madrid', secret: false },
      { key: 'API_KEY', value: 'x', secret: true },
    ]);
    expect(merged.text).toBe('# nota\nMODE=shadow\nOTRA=1\nTZ=Europe/Madrid\nAPI_KEY=x\n');
    expect(merged.changed).toEqual([
      { key: 'TZ', kind: 'add', secret: false },
      { key: 'API_KEY', kind: 'add', secret: true },
    ]);
    expect(mergeEnv(merged.text, [{ key: 'TZ', value: 'UTC', secret: false }]).changed[0]?.kind).toBe('change');
  });

  it('configFromEnv rechaza contraseñas de BD débiles o con caracteres especiales', () => {
    expect(() => configFromEnv({ CLASIFICADOR_DB_PASSWORD: 'corta' })).toThrow(/al menos 16/);
    expect(() => configFromEnv({ CLASIFICADOR_DB_PASSWORD: 'abcdefghijklmnop1234@#' })).toThrow(/solo letras y números/);
    expect(configFromEnv({ CLASIFICADOR_DB_PASSWORD: PASSWORD }).dbPassword).toBe(PASSWORD);
  });
});

describe('reconcile', () => {
  it('sin API (sin credenciales) describe lo que crearía y no falla', async () => {
    const { result, output } = await run(null, false);
    expect(result.changes).toBeGreaterThan(10);
    expect(output).toContain(`crear el proyecto ${PROJECT_NAME}`);
    for (const name of ['clasificador-web', 'clasificador-worker', 'clasificador-docling', POSTGRES_SPEC.name]) {
      expect(output).toContain(`crear ${name}`);
    }
    expect(output).toContain(`dominio ${DOMAIN_HOST}`);
    expect(output).toContain('copia diaria (0 3 * * *)');
  });

  it('--apply sobre un Dokploy vacío crea todo, sin autoDeploy, y no despliega web ni worker', async () => {
    const api = new FakeDokploy();
    const { result } = await run(api, true);
    expect(result.warnings).toEqual([]);

    expect(api.projects).toHaveLength(1);
    for (const name of ['clasificador-web', 'clasificador-worker', 'clasificador-docling']) {
      const app = appByName(api, name);
      expect(app.autoDeploy).toBe(false);
      expect(app.memoryLimit).toBeTruthy();
      expect(app.healthCheckSwarm).toBeTruthy();
    }
    const worker = appByName(api, 'clasificador-worker');
    expect(String(worker.env)).toContain('DOCLING_URL=http://clasificador-docling-x7k2:5001');
    expect(String(worker.env)).toContain('@clasificador-db-q9z1:5432/clasificador');
    expect(String(worker.env)).toContain('MODE=shadow');
    expect(worker.dockerImage).toBe('ghcr.io/gcentegit/clasificador-worker:latest');
    expect(appByName(api, 'clasificador-docling').dockerImage).toContain('docling-serve-cpu:v1.36.0');

    const deployed = api.writes.filter((w) => w.endpoint.endsWith('.deploy'));
    expect(deployed.map((w) => w.endpoint).sort()).toEqual(['application.deploy', 'postgres.deploy']);
    expect(appByName(api, 'clasificador-web').applicationStatus).toBe('idle');
    expect(appByName(api, 'clasificador-worker').applicationStatus).toBe('idle');

    const domains = [...api.domains.values()].flat();
    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({ host: DOMAIN_HOST, https: true, certificateType: 'letsencrypt', port: 3000 });
    const [db] = [...api.databases.values()];
    const backups = db?.backups as Rec[];
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ schedule: '0 3 * * *', keepLatestCount: 7, destinationId: 'dest1' });
    expect(db?.externalPort).toBeNull();
    // El certificado de Graph solo se monta en el worker: la web, expuesta a Internet, no lo lleva.
    const mounts = [...api.mounts.entries()];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.[0]).toBe(appByName(api, 'clasificador-worker').applicationId);
  });

  it('es idempotente: una segunda ejecución con --apply no escribe nada', async () => {
    const api = new FakeDokploy();
    await run(api, true);
    // Los servicios ya desplegados se quedan en running, como en Dokploy.
    for (const app of api.apps.values()) if (app.name !== 'clasificador-docling') app.applicationStatus = 'running';
    api.writes.length = 0;
    const second = await run(api, true);
    expect(api.writes).toEqual([]);
    expect(second.result.changes).toBe(0);
    expect(second.result.needsRedeploy).toEqual([]);
  });

  it('--dry-run contra un estado con deriva solo cuenta y describe, sin escribir', async () => {
    const api = new FakeDokploy();
    await run(api, true);
    const web = appByName(api, 'clasificador-web');
    web.autoDeploy = true;
    web.memoryLimit = '1';
    web.applicationStatus = 'running';
    api.writes.length = 0;
    const { result, output } = await run(api, false);
    expect(api.writes).toEqual([]);
    expect(result.changes).toBe(1);
    expect(output).toMatch(/clasificador-web: autoDeploy: true → false; memoryLimit: 1 → 536870912/);
    expect(result.needsRedeploy).toEqual(['clasificador-web']);
  });

  it('--apply corrige solo lo que difiere y respeta las variables ajenas', async () => {
    const api = new FakeDokploy();
    await run(api, true);
    const worker = appByName(api, 'clasificador-worker');
    worker.env = `${String(worker.env)}OTRA_VARIABLE=conservar\nMODE=live\n`.replace('MODE=shadow\n', '');
    api.writes.length = 0;
    await run(api, true);
    expect(api.writes.map((w) => w.endpoint)).toEqual(['application.saveEnvironment']);
    expect(String(worker.env)).toContain('OTRA_VARIABLE=conservar');
    expect(String(worker.env)).toContain('MODE=shadow');
    expect(String(worker.env)).not.toContain('MODE=live');
  });

  it('no imprime contraseñas, certificados ni claves de API', async () => {
    const api = new FakeDokploy();
    const { output } = await run(api, true);
    for (const secret of [PASSWORD, 'SECRETO', 'sk-ant-secreta']) expect(output).not.toContain(secret);
    expect(output).toContain('ANTHROPIC_API_KEY (secreto)');
  });

  it('avisa de dominios no gestionados y de dominios en servicios que no deben tenerlos', async () => {
    const api = new FakeDokploy();
    await run(api, true);
    const web = appByName(api, 'clasificador-web');
    const worker = appByName(api, 'clasificador-worker');
    api.domains.get(web.applicationId as string)!.push({ domainId: 'x', appName: '', host: 'otro.example.com' });
    api.domains.set(worker.applicationId as string, [{ domainId: 'y', appName: '', host: 'w.example.com' }]);
    const { result } = await run(api, false);
    expect(result.warnings).toHaveLength(2);
  });

  it('sin certificado avisa en lugar de crear el montaje', async () => {
    const api = new FakeDokploy();
    const { result } = await run(api, true, omit(baseConfig(), 'certPem'));
    expect(result.warnings.filter((w) => w.includes('certificado de Graph'))).toHaveLength(1);
    expect(result.warnings[0]).toContain('clasificador-worker');
    expect([...api.mounts.values()].flat()).toHaveLength(0);
  });

  it('avisa si la web ya tiene montado el certificado de Graph de una versión anterior, sin borrarlo', async () => {
    const api = new FakeDokploy();
    await run(api, true);
    const web = appByName(api, 'clasificador-web');
    api.mounts.set(web.applicationId as string, [
      { mountId: 'm-web', appName: '', mountPath: '/run/secrets/graph-cert.pem', type: 'file', content: PEM },
    ]);
    api.writes.length = 0;
    const { result } = await run(api, true);
    expect(result.warnings.filter((w) => w.includes('clasificador-web') && w.includes('ya no lo necesita'))).toHaveLength(1);
    expect(api.writes).toEqual([]);
  });

  it('falla con un mensaje claro si no existe el destino de copias', async () => {
    const api = new FakeDokploy();
    api.destinations = [{ destinationId: 'd', name: 'Otro' }];
    await expect(run(api, false)).rejects.toThrow(/No existe el destino de copias "S3 Minio Dokploy Proyectos".*Otro/);
  });

  it('falla al crear PostgreSQL sin contraseña', async () => {
    await expect(run(new FakeDokploy(), true, omit(baseConfig(), 'dbPassword'))).rejects.toThrow(/CLASIFICADOR_DB_PASSWORD/);
  });
});

describe('main', () => {
  it('rechaza opciones desconocidas y --apply sin credenciales', async () => {
    const quiet = { error: console.error };
    console.error = () => {};
    try {
      expect(await main(['--borrar'], {})).toBe(1);
      expect(await main(['--apply'], {})).toBe(1);
      expect(await main(['--apply', '--check'], { DOKPLOY_URL: 'https://x', DOKPLOY_API_KEY: 'k' })).toBe(1);
    } finally {
      console.error = quiet.error;
    }
  });

  it('--dry-run sin credenciales termina bien y --check sale con 2 si hay diferencias', async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const env = { MAILBOX: 'buzon@ejemplo.com', ADMIN_EMAIL: 'admin@ejemplo.com' };
      expect(await main([], env)).toBe(0);
      expect(await main(['--check'], env)).toBe(2);
    } finally {
      console.log = log;
    }
  });

  it('sin MAILBOX ni ADMIN_EMAIL se detiene con un error que las nombra', async () => {
    const log = console.log;
    console.log = () => {};
    try {
      await expect(main([], {})).rejects.toThrow(/MAILBOX, ADMIN_EMAIL/);
    } finally {
      console.log = log;
    }
  });
});
