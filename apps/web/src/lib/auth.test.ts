import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveAccess } from './access';
import { createAuth } from './auth';

/**
 * Flujo completo de login contra un Entra ID simulado (claves, token y JWKS locales): comprueba
 * que better-auth en modo sin estado deja una sesión legible y que la lista AllowedUser decide.
 */

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '00000000-aaaa-bbbb-cccc-000000000000';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (value: object | Buffer): string =>
  Buffer.from(value instanceof Buffer ? value : JSON.stringify(value)).toString('base64url');

let server: Server;
let authority = '';
let claims: { email?: string; preferred_username: string; tid?: string; oid?: string } = {
  preferred_username: '',
};

function idToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({
    iss: `${authority}/${TENANT}/v2.0`,
    aud: CLIENT,
    tid: TENANT,
    oid: 'oid-123',
    name: 'Persona de Prueba',
    iat: now,
    exp: now + 3600,
    ...claims,
  });
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64(signature)}`;
}

beforeAll(async () => {
  vi.stubEnv('MS_TENANT_ID', TENANT);
  vi.stubEnv('MS_CLIENT_ID', CLIENT);
  vi.stubEnv('MS_CLIENT_SECRET', 'secreto-falso');
  vi.stubEnv('BETTER_AUTH_SECRET', 'secreto-de-prueba-secreto-de-prueba-123456');
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3110');

  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.includes('/discovery/v2.0/keys')) {
      res.end(JSON.stringify({ keys: [jwk] }));
    } else if (req.url?.includes('/oauth2/v2.0/token')) {
      req.resume();
      req.on('end', () => {
        res.end(
          JSON.stringify({
            token_type: 'Bearer',
            expires_in: 3600,
            access_token: 'token-de-acceso',
            id_token: idToken(),
          }),
        );
      });
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  authority = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  server.close();
});

const cookiesOf = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

/**
 * Recorre el login con Microsoft y devuelve el usuario de la sesión resultante. `allowed` son los
 * emails dados de alta; `linked` simula el `oid` ya guardado de cada uno (null = primer acceso).
 */
async function signIn(allowed: string[], linked: Record<string, string | null> = {}) {
  const auth = createAuth({ authority });
  const start = await auth.handler(
    new Request('http://localhost:3110/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3110' },
      body: JSON.stringify({ provider: 'microsoft', callbackURL: '/' }),
    }),
  );
  const { url } = (await start.json()) as { url: string };
  const authorize = new URL(url);
  const state = authorize.searchParams.get('state');
  const callback = await auth.handler(
    new Request(`http://localhost:3110/api/auth/callback/microsoft?code=abc&state=${state}`, {
      headers: { cookie: cookiesOf(start) },
    }),
  );
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookiesOf(callback) }),
  });
  const bound = { ...linked };
  const access = await resolveAccess({
    devBypass: false,
    firstAllowedEmail: async () => allowed[0] ?? null,
    authorize: async ({ email, oid }) => {
      if (!allowed.includes(email)) return 'not-listed';
      if (bound[email]) return bound[email] === oid ? 'ok' : 'other-account';
      bound[email] = oid;
      return 'ok';
    },
    sessionUser: async () => {
      if (!session?.user.email) return null;
      const accounts = await auth.api.listUserAccounts({
        headers: new Headers({ cookie: cookiesOf(callback) }),
      });
      return {
        email: session.user.email,
        name: session.user.name,
        oid: accounts.find((a) => a.providerId === 'microsoft')?.accountId ?? null,
      };
    },
  });
  return { authorize, callback, access, session, bound };
}

describe('login con Microsoft (Entra ID simulado)', () => {
  it('pide solo openid, profile y email contra el tenant configurado', async () => {
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
    const { authorize } = await signIn(['ana@ejemplo.com']);
    expect(authorize.pathname).toBe(`/${TENANT}/oauth2/v2.0/authorize`);
    expect(authorize.searchParams.get('scope')).toBe('openid profile email');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3110/api/auth/callback/microsoft',
    );
  });

  it('un usuario de la lista entra', async () => {
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
    const { callback, access } = await signIn(['ana@ejemplo.com']);
    expect(callback.status).toBe(302);
    expect(access).toMatchObject({ status: 'ok', user: { email: 'ana@ejemplo.com' } });
  });

  it('si Entra no emite el claim email se usa el UPN (preferred_username)', async () => {
    claims = { preferred_username: 'Ana@ejemplo.com' };
    const { access } = await signIn(['ana@ejemplo.com']);
    expect(access).toMatchObject({ status: 'ok', user: { email: 'ana@ejemplo.com' } });
  });

  it('una cuenta del tenant que no está en la lista queda prohibida', async () => {
    claims = { email: 'intruso@ejemplo.com', preferred_username: 'intruso@ejemplo.com' };
    const { access } = await signIn(['ana@ejemplo.com']);
    expect(access).toEqual({
      status: 'forbidden',
      email: 'intruso@ejemplo.com',
      reason: 'not-listed',
    });
  });
});

describe('identidad: oid y tid de Microsoft', () => {
  it('el oid del id_token llega a la sesión como accountId de la cuenta', async () => {
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
    const { access, bound } = await signIn(['ana@ejemplo.com']);
    expect(access.status).toBe('ok');
    expect(bound['ana@ejemplo.com']).toBe('oid-123');
  });

  it('el primer acceso válido guarda el oid y el siguiente exige que coincida', async () => {
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
    const same = await signIn(['ana@ejemplo.com'], { 'ana@ejemplo.com': 'oid-123' });
    expect(same.access.status).toBe('ok');

    // Otra cuenta con el mismo email (p. ej. alguien edita su atributo mail) no entra.
    claims = {
      email: 'ana@ejemplo.com',
      preferred_username: 'ana@ejemplo.com',
      oid: 'oid-impostor',
    };
    const other = await signIn(['ana@ejemplo.com'], { 'ana@ejemplo.com': 'oid-123' });
    expect(other.access).toEqual({
      status: 'forbidden',
      email: 'ana@ejemplo.com',
      reason: 'other-account',
    });
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
  });

  it('un token de otro tenant se rechaza al iniciar sesión: no hay sesión ni acceso', async () => {
    claims = {
      email: 'ana@ejemplo.com',
      preferred_username: 'ana@ejemplo.com',
      tid: '99999999-0000-0000-0000-000000000000',
    };
    const { access, session, callback } = await signIn(['ana@ejemplo.com']);
    expect(session).toBeNull();
    expect(access).toEqual({ status: 'anonymous' });
    expect(callback.headers.get('location')).toBe('/login?error=email_not_found');
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
  });

  it('un token sin tid también se rechaza', async () => {
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com', tid: '' };
    const { access } = await signIn(['ana@ejemplo.com']);
    expect(access).toEqual({ status: 'anonymous' });
    claims = { email: 'ana@ejemplo.com', preferred_username: 'ana@ejemplo.com' };
  });
});
