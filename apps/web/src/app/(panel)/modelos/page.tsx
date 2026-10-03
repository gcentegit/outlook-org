import { prisma } from '@clasificador/db';
import type { Metadata } from 'next';

import { ModelForm } from '@/components/model-form';
import { Card, Notice, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { LLM_PROVIDER_IDS, LLM_PROVIDERS, type LlmProviderId } from '@/lib/llm-providers';
import { requireUser } from '@/lib/session';
import { getActiveLlm } from '@/server/llm-settings';

export const metadata: Metadata = { title: 'Modelos' };

const isProviderId = (value: string): value is LlmProviderId =>
  (LLM_PROVIDER_IDS as readonly string[]).includes(value);

export default async function ModelsPage() {
  await requireUser();
  const active = await getActiveLlm(prisma());
  const activeProvider = active && isProviderId(active.provider) ? active.provider : null;
  const label = LLM_PROVIDERS.find((p) => p.id === active?.provider)?.label ?? active?.provider;

  return (
    <>
      <PageHeader
        title="Modelos"
        description="Proveedor y modelo de LLM que resuelven los correos que las reglas no deciden. El cambio lo recoge el worker en el siguiente trabajo, sin redesplegar."
      />
      <div className="space-y-6">
        <Card title="Selección activa">
          {active ? (
            <p className="text-sm">
              <strong>{label}</strong> / <code className="break-all">{active.model}</code>
              <span className="text-muted">
                {' '}
                · cambiado el {formatDateTime(active.updatedAt)}
                {active.updatedBy ? ` por ${active.updatedBy}` : ''}
              </span>
              {!activeProvider && (
                <span className="mt-2 block text-danger">
                  El proveedor guardado no es uno de los soportados: el worker no podrá usarlo.
                </span>
              )}
            </p>
          ) : (
            <Notice tone="warning">
              No hay ningún modelo activo: el clasificador solo usará reglas hasta que elijas uno.
            </Notice>
          )}
        </Card>

        <Card title="Cambiar de modelo">
          <ModelForm
            initialProvider={activeProvider ?? 'anthropic'}
            initialModel={active?.model ?? LLM_PROVIDERS[0]?.examples[0] ?? ''}
          />
        </Card>
      </div>
    </>
  );
}
