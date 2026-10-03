import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('usa dev como versión por defecto', () => {
    expect(loadConfig({}).APP_VERSION).toBe('dev');
  });

  it('respeta APP_VERSION y rechaza una cadena vacía', () => {
    expect(loadConfig({ APP_VERSION: 'a1b2c3d' }).APP_VERSION).toBe('a1b2c3d');
    expect(() => loadConfig({ APP_VERSION: '' })).toThrow(/APP_VERSION/);
  });
});
