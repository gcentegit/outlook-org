/**
 * Prueba de extracción sobre una carpeta de ficheros locales.
 *
 * Para cada PDF/imagen mide el tiempo de docling, el método (texto/OCR) y si aparece alguno de
 * los siete CIF de docs/sociedades-categorias.md. Imprime una tabla y escribe un informe en
 * HISTORY_DATA_DIR (por defecto data/history/, ignorado por git): lista los nombres de los ficheros
 * probados, que pueden ser facturas reales de terceros.
 *
 * Uso: pnpm --filter @clasificador/worker exec tsx scripts/extraction-test.ts <carpeta> [--pages N] [--url URL]
 * (por defecto: 2 páginas y DOCLING_URL o http://localhost:5101).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { normalizeCif } from '@clasificador/shared';

import { convertWithDocling, detectAttachmentKind } from '../src/extract/docling';

const repoRoot = resolve(import.meta.dirname, '../../..');

interface Row {
  file: string;
  method: string;
  seconds: number | null;
  chars: number;
  cifs: string[];
  error?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Los siete CIF de la tabla "Sociedad → categoría" (columna 2). */
async function loadCifs(): Promise<Map<string, string>> {
  const md = await readFile(join(repoRoot, 'docs/sociedades-categorias.md'), 'utf8');
  const cifs = new Map<string, string>();
  for (const m of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*([A-Z]\d{8})\s*\|/gm)) cifs.set(m[2]!, m[1]!);
  if (cifs.size !== 7)
    throw new Error(`Se esperaban 7 CIF en sociedades-categorias.md y hay ${cifs.size}.`);
  return cifs;
}

const fmt = (n: number | null): string => (n === null ? '-' : n.toFixed(1));

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) {
    console.error('Uso: extraction-test.ts <carpeta> [--pages N] [--url URL]');
    process.exit(2);
  }
  const maxPages = Number(arg('--pages') ?? 2);
  const url = arg('--url') ?? process.env.DOCLING_URL ?? 'http://localhost:5101';
  const cifs = await loadCifs();

  const names = (await readdir(dir)).sort();
  const rows: Row[] = [];
  for (const name of names) {
    const detected = detectAttachmentKind(name, '');
    if (!detected || (detected.kind !== 'pdf' && detected.kind !== 'image')) continue;
    const bytes = await readFile(join(dir, name));
    const started = performance.now();
    try {
      const { markdown, method } = await convertWithDocling(
        { ...detected, bytes },
        { url, maxPages, timeoutSeconds: 180 },
      );
      const normalized = normalizeCif(markdown);
      rows.push({
        file: name,
        method,
        seconds: (performance.now() - started) / 1000,
        chars: markdown.length,
        cifs: [...cifs.keys()].filter((cif) => normalized.includes(cif)),
      });
    } catch (err) {
      rows.push({
        file: name,
        method: 'error',
        seconds: null,
        chars: 0,
        cifs: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (rows.length === 0) throw new Error(`No hay PDF ni imágenes en ${dir}.`);

  const ok = rows.filter((r) => r.method !== 'error');
  const withCif = rows.filter((r) => r.cifs.length > 0).length;
  const mean = ok.length ? ok.reduce((s, r) => s + (r.seconds ?? 0), 0) / ok.length : 0;

  console.table(
    rows.map((r) => ({
      fichero: r.file,
      método: r.method,
      'tiempo (s)': fmt(r.seconds),
      caracteres: r.chars,
      'CIF de sociedad': r.cifs.join(', ') || '(ninguno)',
    })),
  );
  console.log(`CIF detectado en ${withCif}/${rows.length}; tiempo medio ${mean.toFixed(1)} s.`);

  const stamp = new Date()
    .toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' })
    .replace(/^20(\d\d)-(\d\d)-(\d\d) (\d\d):(\d\d).*$/, '$1$2$3-$4$5');
  const report = [
    `# Prueba de extracción (${basename(dir)})`,
    '',
    `- Carpeta: \`${dir}\``,
    `- docling: ${url}, ${maxPages} página(s) por PDF, OCR RapidOCR`,
    `- CIF de sociedad detectado en **${withCif} de ${rows.length}** ficheros; tiempo medio **${mean.toFixed(1)} s** (incluye la primera llamada en frío).`,
    '',
    '| Fichero | Método | Tiempo (s) | Caracteres | CIF de sociedad detectado |',
    '| --- | --- | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r.file} | ${r.method} | ${fmt(r.seconds)} | ${r.chars} | ${
          r.error
            ? `error: ${r.error}`
            : r.cifs.map((c) => `${c} (${cifs.get(c)})`).join(', ') || '(ninguno)'
        } |`,
    ),
    '',
  ].join('\n');
  const outDir = resolve(repoRoot, process.env.HISTORY_DATA_DIR || 'data/history');
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `extraction-test-${stamp}.md`);
  await writeFile(out, report);
  console.log(`Informe: ${out}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
