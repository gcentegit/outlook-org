/**
 * Prepara los casos de evaluación contra la carpeta donde el equipo archivó cada correo.
 *
 * Toma del histórico importado (`messages.jsonl`) una muestra al azar, con semilla fija, de los
 * correos archivados en los árboles Foodbox y Lateral desde la fecha de corte de la fase 9 (los
 * anteriores sirvieron para sacar las reglas). Cada correo se lee de Graph y se extrae con el mismo
 * código que usa el worker (docling local). La verdad esperada es la categoría del árbol más las
 * etiquetas FOOD BOX, LATERAL o ARCOBETA que haya puesto el equipo.
 *
 * Solo lee el buzón. Escribe en HISTORY_DATA_DIR (por defecto data/history/, ignorado por git)
 * porque los casos llevan correos y facturas de terceros. Si el fichero de salida ya existe, sigue
 * donde lo dejó. El resultado se evalúa con `scripts/evaluate.ts`.
 *
 * Uso (desde apps/worker; docling local arriba):
 *   tsx --env-file-if-exists=../../.env scripts/build-eval-cases.ts [--per-tree 150] [--since FECHA]
 *     [--seed 1] [--out <ruta>]
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  canonicalCategory,
  TREE_FOLDERS,
  type Category,
  type ExtractedEmail,
} from '@clasificador/shared';

import { loadConfig, resolveGraphSettings } from '../src/config';
import { extractEmail } from '../src/extract/extract-email';
import { createGraphClient, GraphError } from '../src/graph/client';
import { createMemoryAttachmentCache } from '../src/history/extract-sample';

const repoRoot = resolve(import.meta.dirname, '../../..');

interface HistoryRow {
  id: string;
  folderPath: string;
  receivedAt: string;
  categories: string[] | string;
}

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma muestra. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Árbol de una sociedad donde está archivado, sin distinguir mayúsculas (igual que el worker). */
function treeOf(folderPath: string): (typeof TREE_FOLDERS)[number] | undefined {
  const [root, name] = folderPath.toLowerCase().split('/');
  return root === 'bandeja de entrada'
    ? TREE_FOLDERS.find((t) => t.name.toLowerCase() === name)
    : undefined;
}

function teamCategories(raw: HistoryRow['categories']): Category[] {
  const list = typeof raw === 'string' ? (JSON.parse(raw) as string[]) : raw;
  return list.map(canonicalCategory).filter((c): c is Category => c !== null);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'per-tree': { type: 'string', default: '150' },
      since: { type: 'string' },
      seed: { type: 'string', default: '1' },
      out: { type: 'string' },
    },
  });
  const perTree = Number(values['per-tree']);
  if (!Number.isInteger(perTree) || perTree <= 0) throw new Error('--per-tree debe ser > 0');

  const dataDir = resolve(repoRoot, process.env.HISTORY_DATA_DIR ?? 'data/history');
  const split = JSON.parse(await readFile(join(dataDir, 'split.json'), 'utf8')) as {
    splitDate: string;
  };
  const since = new Date(values.since ?? split.splitDate);
  if (Number.isNaN(since.getTime())) throw new Error('--since no es una fecha válida');
  const out = resolve(values.out ?? join(dataDir, 'evaluacion', 'casos.jsonl'));
  // Los casos llevan correos de terceros: nunca fuera de la carpeta de datos, ignorada por git.
  if (relative(dataDir, out).startsWith('..'))
    throw new Error(`--out debe estar dentro de ${dataDir}`);
  const seed = Number(values.seed);
  if (!Number.isInteger(seed)) throw new Error('--seed debe ser un número entero');

  const rows = (await readFile(join(dataDir, 'messages.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as HistoryRow)
    .filter((row) => new Date(row.receivedAt) >= since && treeOf(row.folderPath));

  const next = random(seed);
  const sample: HistoryRow[] = [];
  for (const tree of TREE_FOLDERS) {
    const inTree = rows.filter((row) => treeOf(row.folderPath) === tree);
    sample.push(...shuffled(inTree, next).slice(0, perTree));
  }

  await mkdir(dirname(out), { recursive: true });
  const done = new Set(
    (await readFile(out, 'utf8').catch(() => ''))
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => (JSON.parse(line) as { email: { messageId: string } }).email.messageId),
  );

  const config = loadConfig();
  const graphSettings = resolveGraphSettings(config);
  if ('missing' in graphSettings) throw new Error(`Faltan ${graphSettings.missing.join(', ')}`);
  const { mailbox, certPath, ...credentials } = graphSettings.settings;
  const deps = {
    graph: createGraphClient({ ...credentials, certPath: resolve(repoRoot, certPath) }),
    mailbox,
    db: createMemoryAttachmentCache(),
    docling: {
      url: config.DOCLING_URL,
      maxPages: config.ATTACHMENT_MAX_PAGES,
      timeoutSeconds: config.DOCLING_TIMEOUT_SECONDS,
    },
    maxAttachmentBytes: config.ATTACHMENT_MAX_BYTES,
    log: () => {},
  };

  let written = 0;
  let missing = 0;
  for (const [i, row] of sample.entries()) {
    if (done.has(row.id)) continue;
    let email: ExtractedEmail;
    try {
      email = await extractEmail(row.id, deps);
    } catch (err) {
      if (err instanceof GraphError && err.status === 404) {
        missing++;
        continue;
      }
      throw err;
    }
    const tree = treeOf(row.folderPath);
    const expected = [...new Set([tree?.category, ...teamCategories(row.categories)])].filter(
      (c): c is Category => c !== undefined,
    );
    // Sin las categorías de Outlook: el clasificador las tomaría por puestas por el equipo y no
    // preguntaría al LLM por ellas (igual que la evaluación del histórico).
    const line = { email: { ...email, categories: [] }, expected, tree: tree?.name };
    await appendFile(out, `${JSON.stringify(line)}\n`);
    written++;
    if ((i + 1) % 10 === 0) console.log(`${i + 1}/${sample.length}`);
  }
  console.log(
    `Muestra: ${sample.length} (${perTree} por árbol desde ${since.toISOString().slice(0, 10)}). ` +
      `Nuevos: ${written}; ya hechos: ${done.size}; ya no están en el buzón: ${missing}. → ${out}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
