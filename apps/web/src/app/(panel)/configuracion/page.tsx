import { prisma } from '@clasificador/db';
import { CATEGORIES } from '@clasificador/shared';
import type { Metadata } from 'next';

import { AddUserForm, CategoryModeRow, RemoveUserButton } from '@/components/settings-forms';
import { Card, cellClass, DataTable, Notice, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { listAllowedUsers } from '@/server/allowed-users';
import { getCategoryModes } from '@/server/category-modes';

export const metadata: Metadata = { title: 'Configuración' };

export default async function SettingsPage() {
  // Primero el acceso: no se lee nada de la base de datos hasta saber que la persona está autorizada.
  const me = await requireUser();
  const [modes, users] = await Promise.all([
    getCategoryModes(prisma()),
    listAllowedUsers(prisma()),
  ]);

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Modo de cada categoría y usuarios que pueden entrar al panel."
      />
      <div className="space-y-6">
        <Card
          title="Modo por categoría"
          description="En modo sombra el servicio solo registra lo que haría; en live aplica la categoría en Outlook sin quitar nunca las que ya puso una persona. Activa live categoría a categoría, empezando por la que mejor acierte."
        >
          {!modes.available && (
            <div className="mb-4">
              <Notice tone="warning" title="Interruptores no disponibles">
                Falta la tabla <code>CategorySetting</code> (migración pendiente). Mientras tanto
                todas las categorías están en modo sombra y no se pueden cambiar.
              </Notice>
            </div>
          )}
          {modes.available && (
            <div className="mb-4">
              <Notice tone="info" title="Live todavía no aplica categorías">
                El servicio funciona solo en sombra: el modo se guarda aquí, pero el worker aún no
                escribe categorías en Outlook y se limita a registrar un aviso si alguna está en
                live. La activación real llega con la evaluación final.
              </Notice>
            </div>
          )}
          <ul className="space-y-3">
            {CATEGORIES.map((category) => (
              <CategoryModeRow
                key={category}
                category={category}
                mode={modes.available ? modes.modes[category] : 'shadow'}
                disabled={!modes.available}
              />
            ))}
          </ul>
        </Card>

        <Card
          title="Usuarios autorizados"
          description="Solo estas cuentas de Microsoft pueden ver el panel. El alta es por email; en el primer acceso se vincula la cuenta de Microsoft (no basta con tener el mismo email). Quitar a alguien le corta el acceso en su siguiente petición; para cambiarle de cuenta de Microsoft, dale de baja y de alta."
        >
          <DataTable
            caption="Usuarios autorizados"
            headers={[
              { label: 'Email' },
              { label: 'Cuenta de Microsoft' },
              { label: 'Alta' },
              { label: 'Acciones' },
            ]}
          >
            {users.map((user) => (
              <tr key={user.id}>
                <th scope="row" className={`${cellClass} break-all font-medium`}>
                  {user.email}
                  {user.email === me.email && <span className="font-normal text-muted"> (tú)</span>}
                </th>
                <td className={`${cellClass} whitespace-nowrap`}>
                  {user.linked ? 'Vinculada' : 'Pendiente del primer acceso'}
                </td>
                <td className={`${cellClass} whitespace-nowrap`}>
                  {formatDateTime(user.createdAt)}
                </td>
                <td className={cellClass}>
                  {user.email !== me.email && <RemoveUserButton id={user.id} email={user.email} />}
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="mt-6 border-t border-border pt-4">
            <AddUserForm />
          </div>
        </Card>
      </div>
    </>
  );
}
