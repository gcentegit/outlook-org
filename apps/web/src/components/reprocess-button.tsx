import Link from 'next/link';

import { reprocessFlaggedAction } from '@/app/(panel)/actions';
import { formatInt } from '@/lib/format';

import { ActionButton } from './action-button';

/**
 * Vuelve a encolar los correos marcados para reprocesar. Los que esperan al modelo de lenguaje se
 * cuentan aparte: sin él configurado, reprocesarlos los deja igual.
 */
export function ReprocessButton({ count, waitingLlm }: { count: number; waitingLlm: number }) {
  const waiting =
    waitingLlm === count
      ? count === 1
        ? 'Espera'
        : 'Todos esperan'
      : waitingLlm === 1
        ? '1 de ellos espera'
        : `${formatInt(waitingLlm)} esperan`;
  return (
    <ActionButton
      action={reprocessFlaggedAction}
      label={count === 1 ? 'Reprocesar el marcado' : `Reprocesar los ${formatInt(count)} marcados`}
      pendingLabel="Pidiendo el reproceso..."
    >
      {waitingLlm > 0 && (
        <span className="text-sm text-muted">
          {waiting} al modelo de lenguaje, que no está configurado: seguirán marcados hasta
          configurarlo en{' '}
          <Link href="/modelos" className="underline">
            Modelos
          </Link>
          .
        </span>
      )}
    </ActionButton>
  );
}
