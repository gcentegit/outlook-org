/** Resultado de una acción del servidor que devuelven los formularios (`useActionState`). */
export type ActionState = { status: 'idle' } | { status: 'ok' | 'error'; message: string };

export const IDLE: ActionState = { status: 'idle' };
