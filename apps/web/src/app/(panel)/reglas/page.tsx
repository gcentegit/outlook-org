import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';

import { NewRuleForm, RuleActions } from '@/components/rule-forms';
import { Badge, Card, cellClass, DataTable, numberCellClass, PageHeader } from '@/components/ui';
import { formatDateTime, formatInt } from '@/lib/format';
import { RULE_TYPES } from '@/lib/rule-form';
import { requireUser } from '@/lib/session';
import { getCategoryModes } from '@/server/category-modes';
import { getRules, type RuleRow } from '@/server/rules';

export const metadata: Metadata = { title: 'Reglas' };

const TYPE_LABELS = Object.fromEntries(RULE_TYPES.map((t) => [t.type, t.label])) as Record<
  RuleRow['type'],
  string
>;

export default async function RulesPage() {
  await requireUser();
  const [rules, modes] = await Promise.all([getRules(prisma()), getCategoryModes(prisma())]);
  const liveCategories = modes.available
    ? Object.entries(modes.modes)
        .filter(([, mode]) => mode === 'live')
        .map(([category]) => category)
    : [];

  return (
    <>
      <PageHeader
        title="Reglas"
        description="Reglas con las que el clasificador decide sin LLM. Una regla fuerte (CIF o razón social) decide la categoría sola; una media (remitente, dominio o palabra clave) solo si nada más fuerte responde. Los cambios se aplican a los correos que lleguen desde ahora; con «Revisar Bandeja» una regla activa vuelve a decidir los correos de la Bandeja de entrada con los que coincide."
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
              { label: 'Acción' },
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
                  {rule.updatedBy && (
                    <p className="mt-1 text-xs text-muted">
                      {rule.updatedBy}
                      <br />
                      {formatDateTime(rule.updatedAt)}
                    </p>
                  )}
                </td>
                <td className={numberCellClass}>{formatInt(rule.decided)}</td>
                <td className={cellClass}>
                  <RuleActions
                    id={rule.id}
                    active={rule.active}
                    label={`${TYPE_LABELS[rule.type]} «${rule.value}» de ${rule.category}`}
                    category={rule.category}
                    live={liveCategories.includes(rule.category)}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-3 text-xs text-muted">
          «Correos decididos» cuenta la decisión vigente de cada correo, sin las que tuvieron un
          fallo técnico. Si coinciden varias reglas, cuenta la que decidió. Debajo del estado, quién
          cambió la regla por última vez desde el panel.
        </p>
      </Card>
      <Card
        title="Crear una regla"
        description="La regla nace activa. Si ya existe la misma, desactivada, actívala en la tabla en lugar de crearla."
        className="mt-6"
      >
        <NewRuleForm liveCategories={liveCategories} />
      </Card>
    </>
  );
}
