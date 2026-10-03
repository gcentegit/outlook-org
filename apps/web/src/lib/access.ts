export interface PanelUser {
  email: string;
  name: string;
  /** Entró por el bypass de desarrollo, no por Microsoft. */
  devBypass: boolean;
}

/** Por qué una cuenta con sesión de Microsoft no entra. */
export type ForbiddenReason =
  /** Su email no está en AllowedUser. */
  | 'not-listed'
  /** La sesión no trae el identificador de la cuenta de Microsoft (`oid`). */
  | 'identity'
  /** El email está dado de alta pero vinculado a otra cuenta de Microsoft (otro `oid`). */
  | 'other-account';

export type Access =
  | { status: 'ok'; user: PanelUser }
  | { status: 'anonymous' }
  /** Tiene sesión de Microsoft pero no se le deja entrar. */
  | { status: 'forbidden'; email: string; reason: ForbiddenReason };

/** Cuenta de Microsoft de la sesión, tal como la dejó el login. */
export interface SessionIdentity {
  email: string;
  name: string;
  /** Identificador de objeto de la cuenta en Entra ID (`oid`, que better-auth guarda como `accountId`). */
  oid: string | null;
}

export interface AccessDeps {
  devBypass: boolean;
  /** Primer usuario autorizado (el más antiguo), para el bypass de desarrollo. */
  firstAllowedEmail: () => Promise<string | null>;
  /**
   * Comprueba la cuenta contra AllowedUser. Si el email está dado de alta pero aún sin `oid`, es
   * su primer acceso válido: guarda el `oid`; desde entonces se exige que coincida.
   */
  authorize: (identity: {
    email: string;
    oid: string;
  }) => Promise<'ok' | 'not-listed' | 'other-account'>;
  /** Usuario de la sesión de Microsoft, si hay cookie válida. */
  sessionUser: () => Promise<SessionIdentity | null>;
}

/**
 * Decide el acceso al panel. La lista `AllowedUser` es la única autoridad: una sesión válida de
 * Microsoft sin entrada en la lista no da acceso, y quitar a alguien de la lista se aplica en
 * la siguiente petición.
 *
 * El acceso se ata a la cuenta, no al email (que Microsoft no verifica y se puede editar): el `oid`
 * de la sesión debe coincidir con el guardado en `AllowedUser`, que se fija en el primer acceso
 * válido. Que el token sea del tenant configurado (`tid`) se exige al iniciar sesión (`auth.ts`).
 */
export async function resolveAccess(deps: AccessDeps): Promise<Access> {
  if (deps.devBypass) {
    const email = await deps.firstAllowedEmail();
    return email
      ? { status: 'ok', user: { email, name: email, devBypass: true } }
      : { status: 'anonymous' };
  }
  const session = await deps.sessionUser();
  if (!session) return { status: 'anonymous' };
  const email = session.email.trim().toLowerCase();

  if (!session.oid) return { status: 'forbidden', email, reason: 'identity' };

  const verdict = await deps.authorize({ email, oid: session.oid.trim().toLowerCase() });
  if (verdict !== 'ok') return { status: 'forbidden', email, reason: verdict };
  return { status: 'ok', user: { email, name: session.name || email, devBypass: false } };
}
