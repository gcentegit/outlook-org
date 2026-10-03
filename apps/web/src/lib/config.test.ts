import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('usa dev como versión por defecto', () => {
    expect(loadConfig({}).APP_VERSION).toBe('dev');
  });

  it('usa dev como commit por defecto', () => {
    expect(loadConfig({}).APP_COMMIT).toBe('dev');
  });

  it('respeta APP_VERSION y APP_COMMIT y rechaza una cadena vacía', () => {
    const c = loadConfig({ APP_VERSION: '0.1.0', APP_COMMIT: 'a1b2c3d' });
    expect(c.APP_VERSION).toBe('0.1.0');
    expect(c.APP_COMMIT).toBe('a1b2c3d');
    expect(() => loadConfig({ APP_VERSION: '' })).toThrow(/APP_VERSION/);
    expect(() => loadConfig({ APP_COMMIT: '' })).toThrow(/APP_COMMIT/);
  });
});
