import { describe, expect, it } from 'vitest';

import { isDevBypassActive, readMicrosoftLogin, readSyncStaleSeconds } from './panel-env';

describe('isDevBypassActive', () => {
  it('solo se activa con AUTH_DEV_BYPASS=true y NODE_ENV=development', () => {
    expect(isDevBypassActive({ AUTH_DEV_BYPASS: 'true', NODE_ENV: 'development' })).toBe(true);
  });

  it('la compilación de producción lo ignora aunque la variable esté puesta', () => {
    expect(isDevBypassActive({ AUTH_DEV_BYPASS: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(isDevBypassActive({ AUTH_DEV_BYPASS: 'true', NODE_ENV: 'test' })).toBe(false);
    expect(isDevBypassActive({ AUTH_DEV_BYPASS: 'true' })).toBe(false);
  });

  it('exige el valor exacto true', () => {
    expect(isDevBypassActive({ AUTH_DEV_BYPASS: '1', NODE_ENV: 'development' })).toBe(false);
    expect(isDevBypassActive({ NODE_ENV: 'development' })).toBe(false);
  });
});

describe('readMicrosoftLogin', () => {
  it('lista las variables que faltan', () => {
    expect(readMicrosoftLogin({ MS_CLIENT_ID: 'a', MS_CLIENT_SECRET: '  ' })).toEqual({
      configured: false,
      missing: ['MS_CLIENT_SECRET', 'MS_TENANT_ID'],
    });
  });

  it('devuelve las credenciales sin espacios cuando están todas', () => {
    expect(
      readMicrosoftLogin({ MS_CLIENT_ID: ' id ', MS_CLIENT_SECRET: 's', MS_TENANT_ID: 't' }),
    ).toEqual({ configured: true, clientId: 'id', clientSecret: 's', tenantId: 't' });
  });
});

describe('readSyncStaleSeconds', () => {
  it('usa 300 por defecto y respeta un entero positivo', () => {
    expect(readSyncStaleSeconds({})).toBe(300);
    expect(readSyncStaleSeconds({ SYNC_STALE_SECONDS: '120' })).toBe(120);
    expect(readSyncStaleSeconds({ SYNC_STALE_SECONDS: '-5' })).toBe(300);
  });
});
