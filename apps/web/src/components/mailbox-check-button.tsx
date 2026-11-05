import { checkMailboxAction } from '@/app/(panel)/actions';

import { ActionButton } from './action-button';

/** Pide al worker que compruebe ya que llega al buzón y explica el resultado. */
export function MailboxCheckButton() {
  return (
    <ActionButton
      action={checkMailboxAction}
      label="Comprobar conexión con el buzón"
      pendingLabel="Comprobando la conexión..."
    >
      <span className="text-sm text-muted">
        El worker lee la Bandeja de entrada con sus credenciales, como la sincronización. Solo lee.
      </span>
    </ActionButton>
  );
}
