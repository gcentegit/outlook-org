import { describe, expect, it, vi } from 'vitest';

import {
  applyCategories,
  categoriesToApply,
  markerCategory,
  type AppliedCategoryStore,
} from './apply-categories';
import { GraphClient } from './client';

const MESSAGE_PATH = '/users/buzon%40ejemplo.com/messages/m1';

interface FakeMessage {
  categories: string[];
  etag: number;
  /** Graph no devuelve etag. */
  noEtag?: boolean;
  /** El PATCH falla siempre con este estado. */
  patchStatus?: number;
  /** El PATCH se aplica, pero la respuesta no llega: corte de red. */
  patchLost?: boolean;
  /** El PATCH no llega a Graph: corte de red. */
  patchNetworkError?: boolean;
  /** Las lecturas posteriores a un PATCH fallan (red caída). */
  readFailsAfterPatch?: boolean;
}

/**
 * Buzón simulado con un solo correo: GET devuelve categorías y etag; PATCH exige el etag con
 * `If-Match` (412 si no coincide). `onRead` permite que «otra persona» lo cambie justo tras leerlo.
 */
function fakeMailbox(message: FakeMessage, onRead?: () => void) {
  const patches: { categories: string[]; ifMatch: string | null }[] = [];
  let patched = false;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    expect(u.split('?')[0]).toBe(`https://graph.test${MESSAGE_PATH}`);
    if ((init?.method ?? 'GET') === 'GET') {
      if (patched && message.readFailsAfterPatch) throw new TypeError('fetch failed');
      const body = {
        ...(message.noEtag ? {} : { '@odata.etag': `W/"${message.etag}"` }),
        categories: [...message.categories],
      };
      onRead?.();
      return Response.json(body);
    }
    patched = true;
    if (message.patchNetworkError) throw new TypeError('fetch failed');
    if (message.patchStatus) return new Response('no', { status: message.patchStatus });
    const ifMatch = new Headers(init?.headers).get('If-Match');
    if (ifMatch !== `W/"${message.etag}"`) return new Response('cambió', { status: 412 });
    const { categories } = JSON.parse(String(init?.body)) as { categories: string[] };
    patches.push({ categories, ifMatch });
    message.categories = categories;
    message.etag++;
    if (message.patchLost) throw new TypeError('fetch failed');
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

  it('si el correo cambia en cada intento, se rinde con el error y borra lo que no llegó a escribir', async () => {
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

  it('si Graph falla con un 5xx, vuelve a leer: lo que no está se borra para reintentarlo', async () => {
    const { graph } = fakeMailbox({ categories: [], etag: 1, patchStatus: 500 });
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow('500');
    expect(store.applied).toEqual([]);
  });

  it('si la escritura se aplicó pero la respuesta se perdió, queda anotada', async () => {
    const message: FakeMessage = { categories: ['Pagado'], etag: 1, patchLost: true };
    const { graph } = fakeMailbox(message);
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow(
      'fetch failed',
    );
    expect(message.categories).toEqual(['Pagado', 'LATERAL']);
    expect(store.applied).toEqual(['LATERAL']);
  });

  it('un corte de red antes de escribir no deja anotada una categoría que no está', async () => {
    const { graph } = fakeMailbox({ categories: [], etag: 1, patchNetworkError: true });
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow(
      'fetch failed',
    );
    expect(store.applied).toEqual([]);
  });

  it('si tampoco se puede volver a leer, borra lo anotado para reintentarlo', async () => {
    const message: FakeMessage = {
      categories: [],
      etag: 1,
      patchNetworkError: true,
      readFailsAfterPatch: true,
    };
    const { graph } = fakeMailbox(message);
    const store = memoryStore(['FOOD BOX']);
    await expect(applyCategories('m1', ['LATERAL'], deps(graph, store))).rejects.toThrow(
      'fetch failed',
    );
    // Lo escrito en pasadas anteriores no se toca.
    expect(store.applied).toEqual(['FOOD BOX']);
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

describe('applyCategories con la categoría del servicio', () => {
  const BOT = '🤖 Clasificador';
  const withMarker = (graph: GraphClient, store: AppliedCategoryStore) => ({
    ...deps(graph, store),
    marker: BOT,
  });

  it('la añade junto a la categoría que escribe, en el mismo PATCH', async () => {
    const message = { categories: ['Pagado'], etag: 1 };
    const { graph, patches } = fakeMailbox(message);
    const store = memoryStore();
    const result = await applyCategories('m1', ['FOOD BOX'], withMarker(graph, store));
    expect(result.added).toEqual(['FOOD BOX', BOT]);
    expect(patches).toEqual([{ categories: ['Pagado', 'FOOD BOX', BOT], ifMatch: 'W/"1"' }]);
    expect(store.applied).toEqual(['FOOD BOX', BOT]);
  });

  it('no la añade si el servicio no escribe ninguna categoría', async () => {
    const { graph, patches } = fakeMailbox({ categories: ['Food Box'], etag: 1 });
    const result = await applyCategories('m1', ['FOOD BOX'], withMarker(graph, memoryStore()));
    expect(result).toEqual({ added: [], alreadyPresent: ['FOOD BOX'], removedByTeam: [] });
    expect(patches).toEqual([]);
  });

  it('no la duplica si el correo ya la tiene', async () => {
    const { graph, patches } = fakeMailbox({ categories: [BOT], etag: 1 });
    const result = await applyCategories('m1', ['LATERAL'], withMarker(graph, memoryStore()));
    expect(result).toEqual({ added: ['LATERAL'], alreadyPresent: [BOT], removedByTeam: [] });
    expect(patches[0]?.categories).toEqual([BOT, 'LATERAL']);
  });

  it('no la vuelve a poner si el equipo la quitó', async () => {
    const { graph, patches } = fakeMailbox({ categories: ['FOOD BOX'], etag: 1 });
    const result = await applyCategories(
      'm1',
      ['FOOD BOX', 'LATERAL'],
      withMarker(graph, memoryStore(['FOOD BOX', BOT])),
    );
    expect(result).toEqual({
      added: ['LATERAL'],
      alreadyPresent: ['FOOD BOX'],
      removedByTeam: [BOT],
    });
    expect(patches[0]?.categories).toEqual(['FOOD BOX', 'LATERAL']);
  });

  it('si Graph rechaza la escritura, tampoco queda anotada', async () => {
    const { graph } = fakeMailbox({ categories: [], etag: 1, patchStatus: 403 });
    const store = memoryStore();
    await expect(applyCategories('m1', ['LATERAL'], withMarker(graph, store))).rejects.toThrow(
      '403',
    );
    expect(store.applied).toEqual([]);
  });
});

describe('markerCategory', () => {
  const master = ['Pagado', 'FOOD BOX', '🤖 Clasificador'];

  it('devuelve el nombre exacto de la lista maestra (sin distinguir mayúsculas ni espacios)', () => {
    expect(markerCategory(' 🤖 clasificador ', master)).toBe('🤖 Clasificador');
  });

  it('sin configurar o si no está en la lista maestra, no hay categoría', () => {
    expect(markerCategory(undefined, master)).toBeNull();
    expect(markerCategory('🤖 Otra', master)).toBeNull();
  });

  it('una categoría del clasificador no puede ser la marca, aunque esté en la lista maestra', () => {
    expect(markerCategory('FOOD BOX', master)).toBeNull();
    expect(markerCategory(' food box ', master)).toBeNull();
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
