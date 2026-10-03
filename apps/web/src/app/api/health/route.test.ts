import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health', () => {
  it('devuelve status ok, la versión y el commit', async () => {
    vi.stubEnv('APP_VERSION', '0.1.0');
    vi.stubEnv('APP_COMMIT', 'a1b2c3d');
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: '0.1.0', commit: 'a1b2c3d' });
  });
});
