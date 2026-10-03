import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

import type { ExtractedEmail } from '@clasificador/shared';

import type { GraphClient } from '../graph/client';
import type { HistoryConfig } from './config';
import { findDiscrepancies, formatDiscrepanciesMarkdown } from './discrepancies';
import { createMemoryAttachmentCache, extractSample, type EvalCaseLine } from './extract-sample';
import { importHistory } from './graph-import';
import {
  STRATA,
  computeDateSplit,
  isDevelopment,
  stratifiedSample,
  type StratifiedSample,
} from './sampling';
import { historyPaths, readJsonFile, readJsonl, readMessages, writeJsonFile } from './store';

const sampleFileSchema = z.object({
  size: z.number(),
  ids: z.array(z.string()),
  perStratum: z.record(z.string(), z.object({ available: z.number(), selected: z.number() })),
});

export interface PipelineOptions {
  config: HistoryConfig;
  /** Obligatorios salvo con `skipImport` y `skipExtract` a la vez. */
  graph?: GraphClient;
  mailbox?: string;
  now?: Date;
  skipImport?: boolean;
  skipExtract?: boolean;
  /** Vuelve a importar desde cero (borra progreso y correos importados). */
  restart?: boolean;
  /** Vuelve a elegir la muestra en lugar de reutilizar la guardada. */
  resample?: boolean;
  log?: (message: string) => void;
}

export interface PipelineResult {
  imported: number;
  splitDate: string | null;
  sample: StratifiedSample<unknown>['perStratum'];
  extraction: { written: number; alreadyDone: number; failed: number } | null;
  evalDev: number;
  evalTest: number;
  discrepancies: number;
}

/** Fecha de corte: hoy menos N meses, a las 00:00 UTC. */
export function sinceDate(now: Date, months: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Importa el histórico, elige la muestra, extrae sus textos, la separa por fecha y lista las discrepancias. */
export async function runHistoryPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { config, graph, mailbox } = options;
  const log = options.log ?? console.log;
  if ((!options.skipImport || !options.skipExtract) && (!graph || !mailbox)) {
    throw new Error('Importar o extraer requiere el cliente de Graph y el buzón.');
  }
  const paths = historyPaths(config.dataDir);

  if (!options.skipImport && graph && mailbox) {
    const imported = await importHistory({
      graph,
      mailbox,
      dataDir: config.dataDir,
      since: sinceDate(options.now ?? new Date(), config.HISTORY_MONTHS),
      skipFolders: config.HISTORY_SKIP_FOLDERS,
      ...(options.restart ? { restart: true } : {}),
      log,
    });
    log(
      `Importación: ${imported.messagesWritten} correos nuevos; ${imported.foldersSkipped}/${imported.folders} carpetas ya estaban terminadas.`,
    );
  }

  const messages = await readMessages(config.dataDir);
  if (messages.length === 0) throw new Error('No hay correos importados: nada que muestrear.');
  const split = computeDateSplit(
    messages.map((m) => m.receivedAt),
    config.HISTORY_DEV_RATIO,
  );
  await writeJsonFile(paths.split, { ...split, devRatio: config.HISTORY_DEV_RATIO });
  log(
    `Separación por fecha: desarrollo ${split.dev}, prueba ${split.test} (corte ${split.splitDate}).`,
  );

  // La muestra se guarda: reanudar la extracción debe seguir con los mismos correos.
  let sample = options.resample ? null : await readJsonFile(paths.sample, sampleFileSchema);
  if (!sample) {
    const drawn = stratifiedSample(messages, config.HISTORY_SAMPLE_SIZE);
    sample = {
      size: config.HISTORY_SAMPLE_SIZE,
      ids: drawn.selected.map((m) => m.id),
      perStratum: drawn.perStratum,
    };
    await writeJsonFile(paths.sample, sample);
  }
  for (const stratum of STRATA) {
    const s = sample.perStratum[stratum];
    log(`Estrato ${stratum}: ${s?.selected ?? 0} de ${s?.available ?? 0}`);
  }
  if ((sample.perStratum.ARCOBETA?.available ?? 0) === 0) {
    log(
      'Aviso: ARCOBETA no tiene correos etiquetados (categoría nueva); se evalúa en modo sombra o con muestra manual.',
    );
  }

  let extraction: PipelineResult['extraction'] = null;
  if (!options.skipExtract && graph && mailbox) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    const chosen = sample.ids.flatMap((id) => byId.get(id) ?? []);
    extraction = await extractSample({
      messages: chosen,
      dataDir: config.dataDir,
      log,
      deps: {
        graph,
        mailbox,
        db: createMemoryAttachmentCache(),
        maxAttachmentBytes: config.ATTACHMENT_MAX_BYTES,
        docling: {
          url: config.DOCLING_URL,
          maxPages: config.ATTACHMENT_MAX_PAGES,
          timeoutSeconds: config.DOCLING_TIMEOUT_SECONDS,
        },
        log,
      },
    });
    log(
      `Extracción: ${extraction.written} nuevos, ${extraction.alreadyDone} ya hechos, ${extraction.failed} fallidos.`,
    );
  }

  const lines = await readJsonl<EvalCaseLine>(paths.evalCases);
  const cases = lines.map((c) => ({
    ...c,
    email: { ...c.email, receivedAt: new Date(c.email.receivedAt) },
  }));
  const dev = cases.filter((c) => isDevelopment(c.email.receivedAt.toISOString(), split.splitDate));
  const test = cases.filter(
    (c) => !isDevelopment(c.email.receivedAt.toISOString(), split.splitDate),
  );
  const toJsonl = (rows: readonly unknown[]): string =>
    rows.map((r) => `${JSON.stringify(r)}\n`).join('');
  await writeFile(paths.evalDev, toJsonl(dev));
  await writeFile(paths.evalTest, toJsonl(test));

  const discrepancies = findDiscrepancies(
    cases.map((c) => ({ email: c.email as ExtractedEmail, expected: c.expected })),
  );
  await writeFile(paths.discrepancies, formatDiscrepanciesMarkdown(discrepancies, cases.length));
  log(
    `Evaluación: ${dev.length} desarrollo, ${test.length} prueba; ${discrepancies.length} discrepancias (${paths.discrepancies}).`,
  );

  return {
    imported: messages.length,
    splitDate: split.splitDate,
    sample: sample.perStratum,
    extraction,
    evalDev: dev.length,
    evalTest: test.length,
    discrepancies: discrepancies.length,
  };
}
