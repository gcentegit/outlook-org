import { describe, expect, it, vi } from 'vitest';

import { applyCategories, categoriesToApply, type AppliedCategoryStore } from './apply-categories';
import { GraphClient } from './client';

const MESSAGE_PATH = '/users/buzon%40ejemplo.com/messages/m1';

interface FakeMessage {
  categories: string[];
  etag: number;
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
      const body = { '@odata.etag': `W/"${message.etag}"`, categories: [...message.categories] };
      onRead?.();
      return Response.json(body);
    }
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
      applied.push(...categories);
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

  it('si el correo cambia en cada intento, se rinde con el error y no anota nada', async () => {
    const message = { categories: [], etag: 1 };
    const { graph, patches } = fakeMailbox(message, () => {
      message.etag++;
    });
    const store = memoryStore();
    await expect(
      applyCategories('m1', ['LATERAL'], { ...deps(graph, store), maxAttempts: 2 }),
    ).rejects.toThrow('412');
    expect(patches).toEqual([]);
    expect(store.applied).toEqual([]);
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
