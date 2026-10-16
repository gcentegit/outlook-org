/**
 * Comprueba en el buzón real, con un único correo de prueba, lo que la escritura de categorías da
 * por supuesto antes de activar el modo real:
 *   1. Graph devuelve el etag con `$select=categories`.
 *   2. Un PATCH con un etag viejo se rechaza (412 o 409) y no cambia nada.
 *   3. Un PATCH con el etag actual añade la categoría sin quitar las que ya tenía.
 * Al terminar, bien o mal, deja el correo con las categorías que tenía al empezar.
 *
 * Escribe en el buzón: solo se ejecuta con autorización del usuario y sobre un correo de prueba de
 * la Bandeja de entrada cuyo asunto se pasa entero (debe haber exactamente uno). La categoría tiene
 * que existir en la lista maestra: el script no la crea.
 *
 * Uso (desde apps/worker; necesita GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CERT_PATH y MAILBOX):
 *   tsx --env-file-if-exists=../../.env scripts/write-check.ts --subject "<asunto>" --category LATERAL
 */
import { parseArgs } from 'node:util';

import { createGraphClient, GraphError } from '../src/graph/client';
import { resolveGraphSettings } from '../src/config';

interface Categorized {
  id: string;
  '@odata.etag'?: string;
  categories?: string[];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { subject: { type: 'string' }, category: { type: 'string' } },
  });
  if (!values.subject || !values.category) {
    throw new Error('Uso: write-check.ts --subject "<asunto>" --category <categoría>');
  }
  const resolved = resolveGraphSettings(process.env as never);
  if ('missing' in resolved) throw new Error(`Faltan variables: ${resolved.missing.join(', ')}`);
  const { mailbox } = resolved.settings;
  const graph = createGraphClient(resolved.settings);
  const user = `/users/${encodeURIComponent(mailbox)}`;

  const master = await graph.getAll<{ displayName: string }>(`${user}/outlook/masterCategories`);
  const category = master.find(
    (c) => c.displayName.toLowerCase() === values.category!.trim().toLowerCase(),
  )?.displayName;
  if (!category) throw new Error(`«${values.category}» no está en la lista maestra del buzón.`);

  const filter = `subject eq '${values.subject.replaceAll("'", "''")}'`;
  const found = await graph.getAll<Categorized>(
    `${user}/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$select=id,categories`,
  );
  if (found.length !== 1) {
    throw new Error(
      `Hay ${found.length} correos con ese asunto en la Bandeja; tiene que haber uno.`,
    );
  }
  const path = `${user}/messages/${encodeURIComponent(found[0]!.id)}`;
  const read = () => graph.getJson<Categorized>(`${path}?$select=categories`);

  const initial = await read();
  const original = initial.categories ?? [];
  const etag = initial['@odata.etag'];
  console.log(
    `1. Etag con $select=categories: ${etag ? 'sí' : 'NO'}. Categorías: ${fmt(original)}`,
  );
  if (!etag) throw new Error('Sin etag la escritura no se puede proteger: no se sigue.');
  if (original.includes(category))
    throw new Error(`El correo ya tiene «${category}»: quítasela antes.`);

  try {
    // Se reescriben las mismas categorías para que el etag leído quede viejo sin cambiar nada.
    await graph.patchJson(path, { categories: original }, { ifMatch: etag });
    const fresh = await read();
    if (fresh['@odata.etag'] === etag) {
      throw new Error(
        'Reescribir las mismas categorías no cambia el etag: no se puede probar el 2.',
      );
    }
    try {
      await graph.patchJson(path, { categories: [...original, category] }, { ifMatch: etag });
      console.log('2. PATCH con etag viejo: ACEPTADO (no se protege la escritura). No se sigue.');
      return;
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      const after = await read();
      const unchanged = fmt(after.categories ?? []) === fmt(original);
      console.log(
        `2. PATCH con etag viejo: ${err.status}; categorías ${unchanged ? 'sin cambios' : 'CAMBIADAS'}.`,
      );
    }
    const current = await read();
    await graph.patchJson(
      path,
      { categories: [...(current.categories ?? []), category] },
      { ifMatch: current['@odata.etag'] ?? '' },
    );
    const written = (await read()).categories ?? [];
    const kept = original.every((c) => written.includes(c));
    console.log(
      `3. PATCH con etag actual: ${fmt(written)}; ${kept ? 'conserva las que tenía' : 'HA QUITADO ALGUNA'}.`,
    );
  } finally {
    const last = await read();
    await graph.patchJson(path, { categories: original }, { ifMatch: last['@odata.etag'] });
    console.log(`Restaurado: ${fmt((await read()).categories ?? [])}`);
  }
}

const fmt = (categories: readonly string[]): string =>
  categories.length > 0 ? categories.join(', ') : '(ninguna)';

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
