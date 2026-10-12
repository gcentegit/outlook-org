import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';

import { Badge, Card, cellClass, DataTable, numberCellClass, PageHeader } from '@/components/ui';
import { formatInt } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { getRules, type RuleRow } from '@/server/rules';

export const metadata: Metadata = { title: 'Reglas' };

const TYPE_LABELS: Record<RuleRow['type'], string> = {
  cif: 'CIF',
  razon_social: 'Razón social',
  remitente: 'Remitente',
  dominio: 'Dominio',
  palabra_clave: 'Palabra clave',
};

export default async function RulesPage() {
  await requireUser();
  const rules = await getRules(prisma());

  return (
    <>
      <PageHeader
        title="Reglas"
        description="Reglas con las que el clasificador decide sin LLM. Una regla fuerte (CIF o razón social) decide la categoría sola; una media (remitente, dominio o palabra clave) solo si nada más fuerte responde. Solo lectura: para añadir o desactivar una regla, pídelo al administrador."
      />
      <Card>
        {rules.length === 0 ? (
          <p className="text-sm">No hay reglas.</p>
        ) : (
          <DataTable
            caption="Reglas del clasificador"
            headers={[
              { label: 'Categoría' },
              { label: 'Tipo' },
              { label: 'Valor' },
              { label: 'Peso' },
              { label: 'Estado' },
              { label: 'Correos decididos', align: 'right' },
            ]}
          >
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className={cellClass}>
                  <Badge>{rule.category}</Badge>
                </td>
                <td className={cellClass}>{TYPE_LABELS[rule.type]}</td>
                <td className={`${cellClass} break-all font-mono text-sm`}>{rule.value}</td>
                <td className={cellClass}>{rule.weight === 'fuerte' ? 'Fuerte' : 'Media'}</td>
                <td className={cellClass}>
                  {rule.active ? <Badge tone="success">Activa</Badge> : <Badge>Desactivada</Badge>}
                </td>
                <td className={numberCellClass}>{formatInt(rule.decided)}</td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-3 text-xs text-muted">
          «Correos decididos» cuenta la decisión vigente de cada correo, sin las que tuvieron un
          fallo técnico. Si coinciden varias reglas, cuenta la que decidió.
        </p>
      </Card>
    </>
  );
}
