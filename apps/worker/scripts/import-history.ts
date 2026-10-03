/**
 * Importa el histórico del buzón y prepara el conjunto de evaluación.
 *
 *  1. Recorre todas las carpetas (subcarpetas incluidas) de los últimos N meses y guarda metadatos
 *     y categorías en JSONL, sin adjuntos. Reanudable: si se corta, se vuelve a lanzar igual.
 *  2. Elige una muestra estratificada (FOOD BOX, LATERAL, ARCOBETA, varias, ninguna) y extrae el
 *     texto de sus adjuntos con docling.
 *  3. Separa la muestra 70 % desarrollo / 30 % prueba por fecha (la prueba, lo más reciente).
 *  4. Lista las discrepancias entre las reglas fuertes y las etiquetas del equipo.
 *
 * Todo se escribe bajo HISTORY_DATA_DIR (por defecto data/history/, ignorado por git: son correos
 * de terceros). Solo lee del buzón.
 *
 * Uso (desde apps/worker):
 *   tsx --env-file-if-exists=../../.env scripts/import-history.ts [--months 6] [--sample-size 1500]
 *     [--skip-import] [--skip-extract] [--restart] [--resample]
 *
 * Variables: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CERT_PATH, MAILBOX, DOCLING_URL y las
 * HISTORY_* de src/history/config.ts.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createGraphClient } from '../src/graph/client';
import { loadGraphEnv, loadHistoryConfig, runHistoryPipeline } from '../src/history';

const repoRoot = resolve(import.meta.dirname, '../../..');

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      months: { type: 'string' },
      'sample-size': { type: 'string' },
      'skip-import': { type: 'boolean', default: false },
      'skip-extract': { type: 'boolean', default: false },
      restart: { type: 'boolean', default: false },
      resample: { type: 'boolean', default: false },
    },
  });

  const env = { ...process.env };
  if (values.months) env.HISTORY_MONTHS = values.months;
  if (values['sample-size']) env.HISTORY_SAMPLE_SIZE = values['sample-size'];
  const config = loadHistoryConfig(env, repoRoot);

  // Con --skip-import y --skip-extract no se toca el buzón y no hacen falta credenciales.
  const needsMailbox = !values['skip-import'] || !values['skip-extract'];
  const graphEnv = needsMailbox ? loadGraphEnv(env) : null;
  const graph = graphEnv
    ? createGraphClient({
        tenantId: graphEnv.GRAPH_TENANT_ID,
        clientId: graphEnv.GRAPH_CLIENT_ID,
        certPath: graphEnv.GRAPH_CERT_PATH,
      })
    : undefined;

  const result = await runHistoryPipeline({
    config,
    ...(graph && graphEnv ? { graph, mailbox: graphEnv.MAILBOX } : {}),
    skipImport: values['skip-import'],
    skipExtract: values['skip-extract'],
    restart: values.restart,
    resample: values.resample,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
