import { prisma } from '@clasificador/db';
import { canonicalCategory, CATEGORIES } from '@clasificador/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CategoryForm, ServiceCategoryForm } from '@/components/category-form';
import { Badge, Card, cellClass, DataTable, Notice, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { colorHex, colorName } from '@/lib/outlook-colors';
import { requireUser } from '@/lib/session';
import { getCategoryModes } from '@/server/category-modes';
import { missingCategories } from '@/server/master-categories';
import { readMasterCategories } from '@/server/master-categories-service';
import { getServiceCategory } from '@/server/service-category';

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
  const [listing, audit, service, modes] = await Promise.all([
    readMasterCategories(),
    prisma().categoryAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    getServiceCategory(prisma()),
    getCategoryModes(prisma()),
  ]);
  const current = service?.name ?? null;
  const masterNames = listing.status === 'ok' ? listing.categories.map((c) => c.displayName) : [];
  // Las categorías del clasificador no sirven de marca: FOOD BOX acabaría en los correos de LATERAL.
  const markerOptions = masterNames.filter((name) => !canonicalCategory(name));
  const currentIsClassifier = current !== null && canonicalCategory(current) !== null;
  const activeMarker =
    current && !currentIsClassifier && masterNames.includes(current) ? current : null;
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
                      {category.displayName === activeMarker && (
                        <span className="ml-2">
                          <Badge tone="success">Marca del clasificador</Badge>
                        </span>
                      )}
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
          title="Marca del clasificador"
          description="Elige la categoría del buzón que sirve de marca, por ejemplo 🤖. No eliges a qué correos se pone: el clasificador la añade a todos los correos en los que escribe FOOD BOX, LATERAL o ARCOBETA, para distinguir en Outlook lo que puso él de lo que pone el equipo. Si alguien del equipo la quita de un correo, no se vuelve a poner. No cambia los correos ya categorizados."
        >
          {currentIsClassifier && (
            <div className="mb-4">
              <Notice tone="warning" title={`${current} no puede ser la marca`}>
                «{current}» es una de las categorías que pone el clasificador: si fuera la marca,
                acabaría en los correos de las otras. Por eso no se está añadiendo ninguna marca.
                Elige otra, por ejemplo 🤖, y guarda.
              </Notice>
            </div>
          )}
          {current &&
            !currentIsClassifier &&
            listing.status === 'ok' &&
            !masterNames.includes(current) && (
              <div className="mb-4">
                <Notice tone="warning" title="La categoría ya no está en el buzón">
                  «{current}» no está en la lista maestra: el clasificador no la escribe. Elige otra
                  o créala de nuevo.
                </Notice>
              </div>
            )}
          <ServiceCategoryForm options={markerOptions} current={current} disabled={!connected} />
          {service?.updatedBy && (
            <p className="mt-3 text-xs text-muted">
              Último cambio: {service.updatedBy}, {formatDateTime(service.updatedAt)}.
            </p>
          )}

          <h3 className="mt-6 text-sm font-semibold">A qué correos se añade</h3>
          <p className="mt-1 text-sm text-muted">
            Solo a los que el clasificador categoriza en el buzón, que dependen del modo de cada
            categoría. Se cambia en{' '}
            <Link href="/configuracion" className="underline">
              Configuración
            </Link>
            .
          </p>
          {modes.available ? (
            <ul className="mt-3 space-y-2">
              {CATEGORIES.map((category) => (
                <li key={category} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{category}</span>
                  {modes.modes[category] === 'live' ? (
                    <Badge tone="danger">Live</Badge>
                  ) : (
                    <Badge tone="success">Sombra</Badge>
                  )}
                  <span className="text-muted">
                    {modes.modes[category] === 'live'
                      ? activeMarker
                        ? `sí: lleva también «${activeMarker}».`
                        : 'sí, cuando haya una marca elegida.'
                      : 'no: en sombra el clasificador no escribe en el correo.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No se pudo leer el modo de las categorías: todas están en sombra.
            </p>
          )}
        </Card>

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
