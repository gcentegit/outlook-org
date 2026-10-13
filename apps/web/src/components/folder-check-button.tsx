import { checkFoldersAction } from '@/app/(panel)/actions';
import { formatDateTime } from '@/lib/format';

import { ActionButton } from './action-button';

/** Pide al worker que compare ya con las carpetas donde el equipo archiva cada correo. */
export function FolderCheckButton({ lastCheck }: { lastCheck: Date | null }) {
  return (
    <ActionButton
      action={checkFoldersAction}
      label="Comparar con las carpetas"
      pendingLabel="Pidiendo la comparación..."
    >
      <span className="text-sm text-muted">
        Última comparación: {lastCheck ? formatDateTime(lastCheck) : 'todavía ninguna'}. Se repite
        sola cada hora.
      </span>
    </ActionButton>
  );
}
