import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';

import { CategoryForm } from '@/components/category-form';
import { Card, cellClass, DataTable, Notice, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { colorHex, colorName } from '@/lib/outlook-colors';
import { requireUser } from '@/lib/session';
import { missingCategories } from '@/server/master-categories';
import { readMasterCategories } from '@/server/master-categories-service';

export const metadata: Metadata = { title: 'Categorías' };

function Swatch({ preset }: { preset: string }) {
  const hex = colorHex(preset);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-4 w-4 rounded border border-border"
        style={hex ? { backgroundColor: hex } : undefined}
      />
      {colorName(preset)}
    </span>
  );
}

export default async function CategoriesPage() {
  await requireUser();
  const [listing, audit] = await Promise.all([
    readMasterCategories(),
    prisma().categoryAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const connected = listing.status === 'ok';
  const missing = listing.status === 'ok' ? missingCategories(listing.categories) : [];

  return (
    <>
      <PageHeader
        title="Categorías del buzón"
        description="Lista maestra de categorías de Outlook del buzón compartido de Proveedores. El panel solo las consulta y crea nuevas: no renombra ni borra, porque los correos guardan la categoría como texto y quedarían etiquetas huérfanas."
      />
      <div className="space-y-6">
        {listing.status === 'unconfigured' && (
          <Notice tone="warning" title="Sin conexión con el buzón">
            {listing.message}
          </Notice>
        )}
        {listing.status === 'error' && (
          <Notice tone="error" title="No se pudo leer la lista de categorías">
            {listing.message}
          </Notice>
        )}
        {missing.length > 0 && (
          <Notice tone="warning" title="Faltan categorías del clasificador">
            El buzón no tiene {missing.join(', ')}. El clasificador no las crea por su cuenta:
            créalas aquí abajo o a mano en Outlook antes de activar el servicio.
          </Notice>
        )}

        {listing.status === 'ok' && (
          <Card title={`Categorías de ${listing.mailbox}`}>
            {listing.categories.length === 0 ? (
              <p className="text-sm text-muted">El buzón no tiene categorías.</p>
            ) : (
              <DataTable
                caption="Categorías de la lista maestra del buzón"
                headers={[{ label: 'Nombre' }, { label: 'Color' }]}
              >
                {listing.categories.map((category) => (
                  <tr key={category.id}>
                    <th scope="row" className={`${cellClass} font-medium`}>
                      {category.displayName}
                    </th>
                    <td className={cellClass}>
                      <Swatch preset={category.color} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
        )}

        <Card
          title="Crear una categoría"
          description="Se crea en el buzón a través del worker, que es quien tiene el certificado de la app del buzón: el panel no lo tiene."
        >
          <CategoryForm disabled={!connected} />
        </Card>

        <Card
          title="Registro de creaciones"
          description="Últimas 20 categorías creadas desde el panel."
        >
          {audit.length === 0 ? (
            <p className="text-sm text-muted">Todavía no se ha creado ninguna desde el panel.</p>
          ) : (
            <DataTable
              caption="Categorías creadas desde el panel"
              headers={[
                { label: 'Fecha' },
                { label: 'Categoría' },
                { label: 'Color' },
                { label: 'Creada por' },
              ]}
            >
              {audit.map((row) => (
                <tr key={row.id}>
                  <td className={`${cellClass} whitespace-nowrap`}>
                    {formatDateTime(row.createdAt)}
                  </td>
                  <th scope="row" className={`${cellClass} font-medium`}>
                    {row.name}
                  </th>
                  <td className={cellClass}>
                    <Swatch preset={row.color} />
                  </td>
                  <td className={`${cellClass} break-all`}>{row.createdBy}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
