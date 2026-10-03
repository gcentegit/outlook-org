import type { ExtractedEmail } from '@clasificador/shared';

import { extractEmail, type ExtractEmailDeps } from '../extract/extract-email';
import type { AttachmentTextCache } from '../extract/attachment-text';
import { appendJsonl, historyPaths, readJsonl } from './store';
import { stratumOf } from './sampling';
import { teamLabels, type HistoryMessage } from './types';

/** Línea del JSONL de evaluación (formato de `scripts/evaluate.ts`) más el estrato de muestreo. */
export interface EvalCaseLine {
  email: ExtractedEmail;
  expected: string[];
  stratum: string;
}

/** Caché de texto de adjuntos en memoria: el histórico no toca la base de datos. */
export function createMemoryAttachmentCache(): AttachmentTextCache {
  const store = new Map<string, { markdown: string; method: 'texto' | 'ocr'; expiresAt: Date }>();
  return {
    attachmentText: {
      findUnique: async ({ where }) => store.get(where.hash) ?? null,
      upsert: async ({ where, create }) => {
        store.set(where.hash, create);
      },
    },
  };
}

export interface ExtractSampleResult {
  written: number;
  alreadyDone: number;
  failed: number;
}

/**
 * Extrae el texto (cuerpo y adjuntos vía docling) de los correos de la muestra y los añade al JSONL
 * de casos. Reanudable: los correos ya escritos se saltan. Las categorías del equipo salen del
 * correo como `expected` y se vacían en `email.categories`, para que el evaluador no las lea como
 * si ya estuvieran puestas (el clasificador no consulta al LLM por categorías ya etiquetadas).
 * Un correo que falla (movido, borrado) se registra y se salta; reejecutar lo reintenta.
 */
export async function extractSample(options: {
  messages: readonly HistoryMessage[];
  dataDir: string;
  deps: ExtractEmailDeps;
  log?: (message: string) => void;
}): Promise<ExtractSampleResult> {
  const log = options.log ?? console.log;
  const outPath = historyPaths(options.dataDir).evalCases;
  const done = new Set(
    (await readJsonl<{ email: { messageId: string } }>(outPath)).map((c) => c.email.messageId),
  );

  const result: ExtractSampleResult = { written: 0, alreadyDone: 0, failed: 0 };
  for (const [i, message] of options.messages.entries()) {
    if (done.has(message.id)) {
      result.alreadyDone++;
      continue;
    }
    try {
      const email = await extractEmail(message.id, options.deps);
      const line: EvalCaseLine = {
        email: { ...email, categories: [] },
        expected: teamLabels(email.categories),
        stratum: stratumOf(email.categories),
      };
      await appendJsonl(outPath, [line]);
      result.written++;
    } catch (err) {
      result.failed++;
      log(
        `No se pudo extraer ${message.id} (${message.folderPath}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if ((i + 1) % 50 === 0) log(`Extraídos ${i + 1}/${options.messages.length}`);
  }
  return result;
}
