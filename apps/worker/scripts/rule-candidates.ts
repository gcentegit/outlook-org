/**
 * Propone reglas medias a partir del conjunto de desarrollo del histórico (ver import-history.ts):
 * remitentes, dominios y palabras clave del asunto (n-gramas de 1-3 palabras, sin palabras vacías)
 * con al menos RULE_MIN_OCCURRENCES apariciones y RULE_MIN_PURITY de una misma categoría.
 *
 * Escribe una tabla Markdown para revisar con el usuario y un JSON (rule-candidates.json) que
 * `--apply` carga en la tabla Rule como reglas INACTIVAS. Ambos van a HISTORY_DATA_DIR (por
 * defecto data/history/, ignorado por git): las candidatas incluyen direcciones de correo de
 * terceros y no deben acabar en un repositorio.
 *
 * Uso (desde apps/worker):
 *   tsx --env-file-if-exists=../../.env scripts/rule-candidates.ts [--min-occurrences 5] [--min-purity 0.98]
 *   tsx --env-file-if-exists=../../.env scripts/rule-candidates.ts --apply   (usa DATABASE_URL)
 *
 * --apply carga el JSON ya generado sin recalcularlo y no cambia las reglas que ya existan.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import {
  applyCandidates,
  formatCandidatesMarkdown,
  genericDomains,
  internalDomains,
  historyPaths,
  isDevelopment,
  loadHistoryConfig,
  proposeCandidates,
  readJsonFile,
  readMessages,
  writeJsonFile,
  type RuleCandidate,
} from '../src/history';

const repoRoot = resolve(import.meta.dirname, '../../..');

const candidatesFileSchema = z.array(
  z.object({
    id: z.string(),
    type: z.enum(['remitente', 'dominio', 'palabra_clave']),
    value: z.string().min(1),
    category: z.enum(['FOOD BOX', 'LATERAL', 'ARCOBETA']),
    weight: z.literal('medio'),
    active: z.literal(false),
    total: z.number(),
    hits: z.number(),
    purity: z.number(),
  }),
);

const splitSchema = z.object({ splitDate: z.string().nullable() });

/** Sello de fecha y hora de Madrid, AAMMDD-HHMM. */
function stamp(now = new Date()): string {
  return now
    .toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' })
    .replace(/^20(\d\d)-(\d\d)-(\d\d) (\d\d):(\d\d).*$/, '$1$2$3-$4$5');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'min-occurrences': { type: 'string' },
      'min-purity': { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  const env = { ...process.env };
  if (values['min-occurrences']) env.RULE_MIN_OCCURRENCES = values['min-occurrences'];
  if (values['min-purity']) env.RULE_MIN_PURITY = values['min-purity'];
  const config = loadHistoryConfig(env, repoRoot);
  const paths = historyPaths(config.dataDir);

  if (values.apply) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('--apply requiere DATABASE_URL');
    const candidates = await readJsonFile(paths.ruleCandidates, candidatesFileSchema);
    if (!candidates)
      throw new Error(`No existe ${paths.ruleCandidates}: ejecuta primero sin --apply.`);
    const { createPrismaClient } = await import('@clasificador/db');
    const db = createPrismaClient(url);
    try {
      const { created, existing, skipped } = await applyCandidates(db, candidates, {
        genericDomains: genericDomains(config),
        internalDomains: internalDomains(config),
      });
      console.log(
        `Reglas cargadas (inactivas): ${created} nuevas, ${existing} ya existían` +
          `${skipped > 0 ? `, ${skipped} descartadas (dominio genérico o interno)` : ''}.`,
      );
    } finally {
      await db.$disconnect();
    }
    return;
  }

  const split = await readJsonFile(paths.split, splitSchema);
  if (!split) throw new Error(`No existe ${paths.split}: ejecuta primero import-history.ts.`);
  const dev = (await readMessages(config.dataDir)).filter((m) =>
    isDevelopment(m.receivedAt, split.splitDate),
  );
  if (dev.length === 0) throw new Error('El conjunto de desarrollo está vacío.');

  const options = {
    minOccurrences: config.RULE_MIN_OCCURRENCES,
    minPurity: config.RULE_MIN_PURITY,
    genericDomains: genericDomains(config),
    internalDomains: internalDomains(config),
  };
  const candidates: RuleCandidate[] = proposeCandidates(dev, options);
  await writeJsonFile(paths.ruleCandidates, candidates);

  await mkdir(config.dataDir, { recursive: true });
  const reportPath = join(config.dataDir, `rule-candidates-${stamp()}.md`);
  await writeFile(
    reportPath,
    formatCandidatesMarkdown(candidates, {
      devMessages: dev.length,
      options,
      generatedAt: new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }),
    }),
  );
  console.log(`${candidates.length} candidatas sobre ${dev.length} correos de desarrollo.`);
  console.log(`Tabla: ${reportPath}`);
  console.log(`JSON:  ${paths.ruleCandidates}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
