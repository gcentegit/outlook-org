import 'server-only';

import { betterAuth } from 'better-auth';

import { readMicrosoftLogin } from './panel-env';

/**
 * Instancia de better-auth sin base de datos (modo sin estado): la sesión viaja en una cookie
 * cifrada (JWE), así que no hacen falta tablas de usuario/sesión/cuenta. Quién puede entrar lo
 * decide siempre `AllowedUser`, que se consulta en cada petición (ver `session.ts`); quitar a
 * alguien de la lista le corta el acceso al instante aunque su cookie siga vigente.
 *
 * Microsoft Entra ID, un solo tenant. Se piden solo `openid`, `profile` y `email`: con
 * `disableDefaultScope` se descartan `User.Read` y `offline_access`, y con `disableProfilePhoto`
 * no se llama a Graph, de modo que la app de login no necesita User.Read. El email sale del
 * id_token (si Entra no emite `email`, se usa `preferred_username`, el UPN).
 *
 * `authority` solo se cambia para probar el flujo contra un Entra ID simulado.
 */
/** ¿El `tid` del token es el del tenant configurado? Se compara sin distinguir mayúsculas. */
export function isSameTenant(tid: unknown, expectedTenantId: string): boolean {
  return (
    typeof tid === 'string' && tid.trim().toLowerCase() === expectedTenantId.trim().toLowerCase()
  );
}

export function createAuth(options: { authority?: string } = {}) {
  const microsoft = readMicrosoftLogin();
  const baseURL = process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3110';
  return betterAuth({
    baseURL,
    // En producción es obligatoria (better-auth falla sin ella); en desarrollo usa un valor propio.
    ...(process.env.BETTER_AUTH_SECRET ? { secret: process.env.BETTER_AUTH_SECRET } : {}),
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 8 * 60 * 60,
        strategy: 'jwe',
        refreshCache: true,
      },
    },
    account: { storeStateStrategy: 'cookie', storeAccountCookie: true },
    // Los errores de OAuth vuelven al login, que los explica.
    onAPIError: { errorURL: '/login' },
    socialProviders: microsoft.configured
      ? {
          microsoft: {
            clientId: microsoft.clientId,
            clientSecret: microsoft.clientSecret,
            tenantId: microsoft.tenantId,
            ...(options.authority ? { authority: options.authority } : {}),
            disableDefaultScope: true,
            scope: ['openid', 'profile', 'email'],
            disableProfilePhoto: true,
            prompt: 'select_account',
            // El email por sí solo no identifica a nadie (Microsoft no lo verifica y es editable): el
            // acceso se ata al `oid` de la cuenta (better-auth lo guarda como `accountId`, ver
            // `session.ts`) y el token debe ser del tenant configurado (`tid`). Aquí se rechaza un
            // token de otro tenant: es el único momento en que se procesa un token de Microsoft. Un
            // email vacío hace que better-auth cancele el login y vuelva a /login con
            // `error=email_not_found` (lanzar un error daría un 500 en pantalla).
            mapProfileToUser: (profile) => {
              const { tid } = profile as { tid?: unknown };
              if (!isSameTenant(tid, microsoft.tenantId)) {
                return { email: '' };
              }
              const email = profile.email ?? profile.preferred_username;
              return email ? { email } : {};
            },
          },
        }
      : {},
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Se crea al primer uso (no al importar) para que la compilación no necesite el entorno. */
export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}
