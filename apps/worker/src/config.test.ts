import { describe, expect, it } from 'vitest';

import { assertSupportedMode, loadConfig, resolveGraphSettings } from './config';

describe('loadConfig', () => {
  it('aplica los valores por defecto', () => {
    const c = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5442/db' });
    expect(c.HEALTH_PORT).toBe(8080);
    expect(c.SYNC_STALE_SECONDS).toBe(300);
    expect(c.APP_VERSION).toBe('dev');
  });

  it('falla si falta DATABASE_URL o no es una URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'no-es-url' })).toThrow(/DATABASE_URL/);
  });
});

describe('modo y sincronización', () => {
  const env = { DATABASE_URL: 'postgresql://u:p@localhost:5442/db' };

  it('arranca en modo sombra, con polling de 90 s y concurrencia 2', () => {
    const c = loadConfig(env);
    expect(c.MODE).toBe('shadow');
    expect(c.POLL_INTERVAL_SECONDS).toBe(90);
    expect(c.WORKER_CONCURRENCY).toBe(2);
    expect(c.UPTIME_KUMA_PUSH_URL).toBeUndefined();
    expect(() => assertSupportedMode(c)).not.toThrow();
  });

  it('se niega a arrancar con MODE=live y lo explica', () => {
    const c = loadConfig({ ...env, MODE: 'live' });
    expect(() => assertSupportedMode(c)).toThrow(/MODE=live no está soportado/);
  });

  it('rechaza un MODE desconocido y un polling fuera de rango', () => {
    expect(() => loadConfig({ ...env, MODE: 'prueba' })).toThrow(/MODE/);
    expect(() => loadConfig({ ...env, POLL_INTERVAL_SECONDS: '1' })).toThrow(
      /POLL_INTERVAL_SECONDS/,
    );
    expect(() => loadConfig({ ...env, WORKER_CONCURRENCY: '0' })).toThrow(/WORKER_CONCURRENCY/);
  });

  it('sin dominios internos configurados la lista queda vacía; los indicados, en minúsculas', () => {
    expect(loadConfig(env).INTERNAL_EMAIL_DOMAINS).toEqual([]);
    expect(
      loadConfig({ ...env, INTERNAL_EMAIL_DOMAINS: ' Lateral.example, ARCOBETA.com ,' })
        .INTERNAL_EMAIL_DOMAINS,
    ).toEqual(['lateral.example', 'arcobeta.com']);
  });

  it('el administrador inicial es opcional y debe ser un email', () => {
    expect(loadConfig(env).ADMIN_EMAIL).toBeUndefined();
    expect(loadConfig({ ...env, ADMIN_EMAIL: 'ana@ejemplo.com' }).ADMIN_EMAIL).toBe(
      'ana@ejemplo.com',
    );
    expect(() => loadConfig({ ...env, ADMIN_EMAIL: 'no-es-email' })).toThrow(/ADMIN_EMAIL/);
  });

  it('una variable vacía cuenta como no definida', () => {
    const c = loadConfig({ ...env, UPTIME_KUMA_PUSH_URL: '', MAILBOX: '' });
    expect(c.UPTIME_KUMA_PUSH_URL).toBeUndefined();
    expect(c.MAILBOX).toBeUndefined();
  });
});

describe('resolveGraphSettings', () => {
  it('lista las variables que faltan', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5442/db',
      MAILBOX: 'p@x.com',
    });
    expect(resolveGraphSettings(c)).toEqual({
      missing: ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CERT_PATH'],
    });
  });

  it('devuelve los ajustes cuando están todas', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5442/db',
      GRAPH_TENANT_ID: 't',
      GRAPH_CLIENT_ID: 'c',
      GRAPH_CERT_PATH: '/run/secrets/graph-cert.pem',
      MAILBOX: 'p@x.com',
    });
    expect(resolveGraphSettings(c)).toEqual({
      settings: {
        tenantId: 't',
        clientId: 'c',
        certPath: '/run/secrets/graph-cert.pem',
        mailbox: 'p@x.com',
      },
    });
  });
});
