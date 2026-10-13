import { describe, expect, it, vi } from 'vitest';

import { applyCategories, categoriesToApply, type AppliedCategoryStore } from './apply-categories';
import { GraphClient } from './client';

const MESSAGE_PATH = '/users/buzon%40ejemplo.com/messages/m1';

interface FakeMessage {
  categories: string[];
  etag: number;
  /** Graph no devuelve etag. */
  noEtag?: boolean;
  /** El PATCH falla siempre con este estado. */
  patchStatus?: number;
}

/**
 * Buzón simulado con un solo correo: GET devuelve categorías y etag; PATCH exige el etag con
 * `If-Match` (412 si no coincide). `onRead` permite que «otra persona» lo cambie justo tras leerlo.
 */
function fakeMailbox(message: FakeMessage, onRead?: () => void) {
  const patches: { categories: string[]; ifMatch: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    expect(u.split('?')[0]).toBe(`https://graph.test${MESSAGE_PATH}`);
    if ((init?.method ?? 'GET') === 'GET') {
      const body = {
        ...(message.noEtag ? {} : { '@odata.etag': `W/"${message.etag}"` }),
        categories: [...message.categories],
      };
      onRead?.();
      return Response.json(body);
    }
    if (message.patchStatus) return new Response('no', { status: message.patchStatus });
    const ifMatch = new Headers(init?.headers).get('If-Match');
    if (ifMatch !== `W/"${message.etag}"`) return new Response('cambió', { status: 412 });
    const { categories } = JSON.parse(String(init?.body)) as { categories: string[] };
    patches.push({ categories, ifMatch });
    message.categories = categories;
    message.etag++;
    return new Response(null, { status: 200 });
  });
  const graph = new GraphClient({
    getToken: async () => 't',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: 'https://graph.test',
    sleep: async () => {},
  });
  return { graph, patches };
}

function memoryStore(initial: string[] = []): AppliedCategoryStore & { applied: string[] } {
  const applied = [...initial];
  return {
    applied,
    listApplied: async () => [...applied],
    recordApplied: async (_id, categories) => {
      for (const c of categories) if (!applied.includes(c)) applied.push(c);
    },
    forgetApplied: async (_id, categories) => {
      for (const c of categories) applied.splice(applied.indexOf(c), 1);
    },
  };
}

const deps = (graph: GraphClient, store: AppliedCategoryStore) => ({
  graph,
  mailbox: 'buzon@ejemplo.com',
  store,
});

describe('applyCategories', () => {
  it('añade sin quitar las categorías que ya tiene el correo y lo anota', async () => {
    const message = { categories: ['Pagado'], etag: 1 };
    const { graph, patches } = fakeMailbox(message);
    const store = memoryStore();
    const result = await applyCategories('m1', ['FOOD BOX'], deps(graph, store));
    expect(result).toEqual({ added: ['FOOD BOX'], alreadyPresent: [], removedByTeam: [] });
    expect(patches).toEqual([{ categories: ['Pagado', 'FOOD BOX'], ifMatch: 'W/"1"' }]);
    expect(store.applied).toEqual(['FOOD BOX']);
  });

  it('no escribe si el correo ya tiene la categoría (sin distinguir mayúsculas)', async () => {
    const { graph, patches } = fakeMailbox({ categories: ['Food Box'], etag: 1 });
    const result = await applyCategories('m1', ['FOOD BOX'], deps(graph, memoryStore()));
    expect(result.alreadyPresent).toEqual(['FOOD BOX']);
    expect(patches).toEqual([]);
  });

  it('no vuelve a poner una categoría que el servicio puso y el equipo quitó', async () => {
    const { graph, patches } = fakeMailbox({ categories: ['Pagado'], etag: 1 });
    const result = await applyCategories(
      'm1',
      ['FOOD BOX', 'LATERAL'],
      deps(graph, memoryStore(['FOOD BOX'])),
    );
    expect(result).toEqual({ added: ['LATERAL'], alreadyPresent: [], removedByTeam: ['FOOD BOX'] });
    expect(patches[0]?.categories).toEqual(['Pagado', 'LATERAL']);
  });

  it('si otro cambia el correo entre la lectura y la escritura, vuelve a leer y no pisa su cambio', async () => {
    const message = { categories: ['Pagado'], etag: 1 };
    let changed = false;
    const { graph, patches } = fakeMailbox(message, () => {
      if (changed) return;
      changed = true;
      message.categories = ['Pagado', 'Revisar'];
      message.etag++;
    });
    const result = await applyCategories('m1', ['LATERAL'], deps(graph, memoryStore()));
    expect(result.added).toEqual(['LATERAL']);
    expect(patches).toEqual([{ categories: ['Pagado', 'Revisar', 'LATERAL'], ifMatch: 'W/"2"' }]);
  });

  it('si el correo cambia en cada intento, se rinde con el error y deja lo anotado (en la duda, no se reescribe)', async () => {
    const message = { categories: [], etag: 1 };
    const { graph, patches } = fakeMailbox(message, () => {
      message.etag++;
    });
    const store = memoryStore();
    await expect(
      applyCategories('m1', ['LATERAL'], { ...deps(graph, store), maxAttempts: 2 }),
    ).rejects.toThrow('412');
    expect(patches).toEqual([]);
    expect(store.applied).toEqual(['LATERAL']);
  });

  it('sin etag no escribe ni anota nada', async () => {
    const { graph, patches } = fakeMailbox({ categories: [], etag: 1, noEtag: true });
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow('etag');
    expect(patches).toEqual([]);
    expect(store.applied).toEqual([]);
  });

  it('si Graph rechaza la escritura, borra lo anotado y lanza el error', async () => {
    const { graph } = fakeMailbox({ categories: [], etag: 1, patchStatus: 403 });
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow('403');
    expect(store.applied).toEqual([]);
  });

  it('si Graph falla con un 5xx, lo anotado se queda: pudo aplicarse', async () => {
    const { graph } = fakeMailbox({ categories: [], etag: 1, patchStatus: 500 });
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow('500');
    expect(store.applied).toEqual(['LATERAL']);
  });

  it('un 409 también se trata como conflicto: vuelve a leer y escribe', async () => {
    const message: FakeMessage = { categories: ['Pagado'], etag: 1, patchStatus: 409 };
    let reads = 0;
    const { graph, patches } = fakeMailbox(message, () => {
      reads++;
      if (reads === 2) delete message.patchStatus;
    });
    const store = memoryStore();
    const result = await applyCategories('m1', ['LATERAL'], deps(graph, store));
    expect(result.added).toEqual(['LATERAL']);
    expect(patches).toEqual([{ categories: ['Pagado', 'LATERAL'], ifMatch: 'W/"1"' }]);
    expect(store.applied).toEqual(['LATERAL']);
  });
});

describe('categoriesToApply', () => {
  const master = ['Pagado', 'Food Box', 'LATERAL'];

  it('solo las categorías en live, con el nombre de la lista maestra', () => {
    expect(categoriesToApply(['FOOD BOX', 'LATERAL'], ['FOOD BOX'], master)).toEqual(['Food Box']);
  });

  it('sin categorías en live no escribe nada', () => {
    expect(categoriesToApply(['FOOD BOX', 'LATERAL'], [], master)).toEqual([]);
  });

  it('no escribe una categoría que no está en la lista maestra', () => {
    expect(categoriesToApply(['ARCOBETA'], ['ARCOBETA'], master)).toEqual([]);
  });
});
