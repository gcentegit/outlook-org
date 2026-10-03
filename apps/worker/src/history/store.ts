import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { z } from 'zod';

import { historyMessageSchema, type HistoryMessage } from './types';

/** Rutas de los ficheros de datos del histórico, todos bajo una misma carpeta. */
export function historyPaths(dataDir: string) {
  return {
    messages: join(dataDir, 'messages.jsonl'),
    importState: join(dataDir, 'import-state.json'),
    progressDir: join(dataDir, 'progress'),
    progressFile: (folderId: string) =>
      join(dataDir, 'progress', `${createHash('sha1').update(folderId).digest('hex')}.json`),
    split: join(dataDir, 'split.json'),
    sample: join(dataDir, 'sample.json'),
    evalCases: join(dataDir, 'eval-cases.jsonl'),
    evalDev: join(dataDir, 'eval-dev.jsonl'),
    evalTest: join(dataDir, 'eval-test.jsonl'),
    discrepancies: join(dataDir, 'discrepancias.md'),
    ruleCandidates: join(dataDir, 'rule-candidates.json'),
  };
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readJsonFile<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.infer<S> | null> {
  const text = await readText(path);
  if (text === null) return null;
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${path}: contenido no válido (${parsed.error.message})`);
  return parsed.data;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Se escribe a un temporal y se renombra para no dejar un fichero de progreso a medias.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

export async function appendJsonl(path: string, rows: readonly unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

/** Líneas JSONL ya parseadas; una línea corrupta indica fichero y número de línea. */
export async function readJsonl<T = unknown>(
  path: string,
  validate?: (value: unknown) => T,
): Promise<T[]> {
  const text = await readText(path);
  if (text === null) return [];
  const rows: T[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const value: unknown = JSON.parse(line);
      rows.push(validate ? validate(value) : (value as T));
    } catch (err) {
      throw new Error(
        `${path}:${i + 1}: línea no válida (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  });
  return rows;
}

/** Correos importados, sin repetidos: una página reintentada tras un corte puede haberse escrito dos veces. */
export async function readMessages(dataDir: string): Promise<HistoryMessage[]> {
  const rows = await readJsonl(historyPaths(dataDir).messages, (v) =>
    historyMessageSchema.parse(v),
  );
  const byId = new Map<string, HistoryMessage>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
