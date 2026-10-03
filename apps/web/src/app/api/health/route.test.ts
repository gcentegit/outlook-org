import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health', () => {
  it('devuelve status ok y la versión', async () => {
    vi.stubEnv('APP_VERSION', 'a1b2c3d');
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: 'a1b2c3d' });
  });
});
