'use client';

import { useActionState, useState } from 'react';

import { changeModelAction, testModelAction, type TestState } from '@/app/(panel)/modelos/actions';
import { IDLE, type ActionState } from '@/lib/action-state';
import { LLM_PROVIDERS, privacyNotice, type LlmProviderId } from '@/lib/llm-providers';

import { TestResultView } from './test-result';
import { buttonClass, inputClass, labelClass, Notice } from './ui';

export function ModelForm({
  initialProvider,
  initialModel,
}: {
  initialProvider: LlmProviderId;
  initialModel: string;
}) {
  const [provider, setProvider] = useState<LlmProviderId>(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [state, action, pending] = useActionState<ActionState, FormData>(changeModelAction, IDLE);
  const [test, testAction, testing] = useActionState<TestState, FormData>(testModelAction, {
    status: 'idle',
  });
  const busy = pending || testing;

  const info = LLM_PROVIDERS.find((p) => p.id === provider);
  const notice = privacyNotice(provider, model);

  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="provider" className={labelClass}>
            Proveedor
          </label>
          <select
            id="provider"
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProviderId)}
            className={inputClass}
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="model" className={labelClass}>
            Modelo
          </label>
          <input
            id="model"
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="model-examples"
            required
            autoComplete="off"
            spellCheck={false}
            aria-describedby="model-help"
            className={inputClass}
          />
          <datalist id="model-examples">
            {info?.examples.map((example) => (
              <option key={example} value={example} />
            ))}
          </datalist>
          <p id="model-help" className="mt-1 text-xs text-muted">
            Identificador del modelo tal como lo espera el proveedor. La clave de API vive en{' '}
            <code>{info?.keyVariable}</code> del worker y no se edita aquí.
          </p>
        </div>
      </div>

      {notice && (
        <Notice
          tone={notice.level === 'warning' ? 'warning' : 'info'}
          title="Privacidad de los datos"
        >
          {notice.text}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {pending ? 'Guardando...' : 'Activar este modelo'}
        </button>
        <button
          type="submit"
          formAction={testAction}
          disabled={busy}
          className={buttonClass.secondary}
          aria-describedby="probar-help"
        >
          {testing ? 'Probando...' : 'Probar'}
        </button>
        <span id="probar-help" className="text-sm text-muted">
          Prueba este proveedor y modelo sin activarlo; puede tardar hasta 60 s.
        </span>
      </div>

      <details className="rounded-md border border-border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Correo de ejemplo para «Probar»</summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted">
            El correo va directo al modelo, sin reglas ni hilo, y no se guarda: viaja por la cola de
            trabajos, que lo borra en cuanto el panel lee el resultado (como mucho a los 5 minutos).
            Si dejas el texto vacío se usa un correo sintético con el CIF de una sociedad del grupo.
            No pegues datos que no quieras enviar al proveedor elegido.
          </p>
          <div>
            <label htmlFor="testSubject" className={labelClass}>
              Asunto (opcional)
            </label>
            <input
              id="testSubject"
              name="testSubject"
              maxLength={300}
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="testBody" className={labelClass}>
              Texto del correo o de la factura (opcional)
            </label>
            <textarea
              id="testBody"
              name="testBody"
              rows={6}
              maxLength={20000}
              className={inputClass}
            />
          </div>
        </div>
      </details>

      <div aria-live="polite">
        {testing && <Notice tone="info">Probando el modelo, espera un momento...</Notice>}
        {!testing && test.status === 'error' && <Notice tone="error">{test.message}</Notice>}
        {!testing && test.status === 'done' && <TestResultView result={test.result} />}
      </div>

      <div aria-live="polite">
        {state.status === 'ok' && <Notice tone="success">{state.message}</Notice>}
        {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      </div>
    </form>
  );
}
