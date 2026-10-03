/**
 * Evaluador del clasificador. Lee un JSONL de casos etiquetados ({"email": ExtractedEmail,
 * "expected": ["LATERAL", ...]}), ejecuta `classify` sin LLM y, por cada `--llm`, con ese modelo,
 * y escribe por categoría precisión, cobertura, matriz de confusión, % que pasa por el LLM y coste.
 *
 * El conjunto real de casos etiquetados saldrá del análisis del histórico (fase 4); el JSONL
 * sintético del informe de la fase 5 solo comprueba que el evaluador y las reglas funcionan.
 *
 * Uso (desde apps/worker):
 *   tsx --env-file-if-exists=../../.env scripts/evaluate.ts casos.jsonl
 *   tsx --env-file-if-exists=../../.env scripts/evaluate.ts casos.jsonl \
 *     --llm anthropic:claude-haiku-4-5-20251001 --llm openrouter:google/gemini-2.0-flash-exp:free
 *
 * Opciones:
 *   --llm proveedor:modelo   repetible; compara modelos (las claves salen del entorno)
 *   --rules reglas.json      reglas (array de {id,type,value,category,weight}); por defecto, CIF y
 *                            razón social de las siete sociedades
 *   --db                     lee las reglas activas de la base de datos (DATABASE_URL)
 *   --threshold 0.8          umbral de confianza
 *   --max-chars 12000        caracteres máximos enviados al LLM
 *   --details                lista cada caso con su decisión
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  CATEGORIES,
  canonicalCategory,
  type Category,
  type ExtractedEmail,
} from '@clasificador/shared';
import { z } from 'zod';

import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  defaultRules,
  classify,
  createLlmClassifier,
  createPrismaRuleRepository,
  formatReport,
  summarizeRun,
  type ClassifyResult,
  type LlmClassifier,
  type ProviderKeys,
  type RuleRepository,
  type ThreadCategory,
  type ThreadRepository,
} from '../src/classify';

const attachmentSchema = z.object({
  name: z.string().default('adjunto'),
  contentType: z.string().default('application/pdf'),
  sha256: z.string().default(''),
  markdown: z.string(),
  method: z.enum(['text', 'ocr', 'skipped']).default('text'),
});

const caseSchema = z.object({
  email: z.object({
    messageId: z.string().min(1),
    conversationId: z.string().nullable().default(null),
    internetMessageId: z.string().nullable().default(null),
    receivedAt: z.coerce.date(),
    fromAddress: z.string().nullable().default(null),
    fromName: z.string().nullable().default(null),
    subject: z.string().default(''),
    bodyText: z.string().default(''),
    categories: z.array(z.string()).default([]),
    attachments: z.array(attachmentSchema).default([]),
  }),
  expected: z.array(z.string()),
});

const rulesFileSchema = z.array(
  z.object({
    id: z.string().min(1),
    type: z.enum(['cif', 'razon_social', 'remitente', 'dominio', 'palabra_clave']),
    value: z.string().min(1),
    category: z.string().min(1),
    weight: z.enum(['fuerte', 'medio']),
  }),
);

type EvalCase = z.infer<typeof caseSchema>;

async function parseCases(path: string): Promise<EvalCase[]> {
  const text = await readFile(path, 'utf8');
  const cases: EvalCase[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('//')) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${i + 1}: JSON no válido`);
    }
    const parsed = caseSchema.safeParse(json);
    if (!parsed.success) throw new Error(`${path}:${i + 1}: ${z.prettifyError(parsed.error)}`);
    cases.push(parsed.data);
  });
  if (cases.length === 0) throw new Error(`${path}: no hay casos`);
  return cases;
}

/** Hilo simulado: categorías esperadas de los casos anteriores de la misma conversación. */
function threadRepositoryFor(cases: readonly EvalCase[]): ThreadRepository {
  return {
    async findThreadCategories(conversationId, excludeMessageId) {
      const current = cases.find((c) => c.email.messageId === excludeMessageId);
      const found: ThreadCategory[] = [];
      for (const other of cases) {
        if (other.email.conversationId !== conversationId) continue;
        if (other.email.messageId === excludeMessageId) continue;
        if (current && other.email.receivedAt >= current.email.receivedAt) continue;
        for (const name of other.expected) {
          const category = canonicalCategory(name);
          if (category) found.push({ category, messageId: other.email.messageId, origin: 'team' });
        }
      }
      return found;
    },
  };
}

async function runAll(
  cases: readonly EvalCase[],
  args: { rules: RuleRepository; llm: LlmClassifier | undefined; threshold: number },
): Promise<ClassifyResult[]> {
  const threads = threadRepositoryFor(cases);
  const results: ClassifyResult[] = [];
  for (const c of cases) {
    results.push(
      await classify(c.email as ExtractedEmail, {
        availableCategories: CATEGORIES,
        mode: 'shadow',
        rules: args.rules,
        threads,
        llm: args.llm,
        confidenceThreshold: args.threshold,
      }),
    );
  }
  return results;
}

function printDetails(
  label: string,
  cases: readonly EvalCase[],
  results: readonly ClassifyResult[],
): void {
  console.log(`### Detalle: ${label}`);
  cases.forEach((c, i) => {
    const d = (results[i] as ClassifyResult).decision;
    const got = d.categories.join(', ') || '(ninguna)';
    const want = c.expected.join(', ') || '(ninguna)';
    const ok = [...CATEGORIES].every(
      (cat: Category) =>
        d.categories.includes(cat) === c.expected.some((e) => canonicalCategory(e) === cat),
    );
    console.log(
      `- ${ok ? 'OK ' : 'MAL'} ${c.email.messageId}: propuesta [${got}] esperada [${want}] ` +
        `fuente=${d.source} revisión=${d.needsReview} :: ${d.reason}`,
    );
  });
  console.log('');
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      llm: { type: 'string', multiple: true },
      rules: { type: 'string' },
      db: { type: 'boolean', default: false },
      threshold: { type: 'string' },
      'max-chars': { type: 'string' },
      details: { type: 'boolean', default: false },
    },
  });
  const [casesPath] = positionals;
  if (!casesPath) throw new Error('Uso: evaluate.ts <casos.jsonl> [--llm proveedor:modelo]...');

  const threshold = values.threshold ? Number(values.threshold) : DEFAULT_CONFIDENCE_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('--threshold debe estar entre 0 y 1');
  }
  const maxChars = values['max-chars'] ? Number(values['max-chars']) : undefined;
  if (maxChars !== undefined && (!Number.isInteger(maxChars) || maxChars <= 0)) {
    throw new Error('--max-chars debe ser un entero positivo');
  }

  const cases = await parseCases(casesPath);

  let rules: RuleRepository;
  let ruleSource: string;
  let disconnect: (() => Promise<void>) | undefined;
  if (values.db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('--db requiere DATABASE_URL');
    const { createPrismaClient } = await import('@clasificador/db');
    const db = createPrismaClient(url);
    rules = createPrismaRuleRepository(db);
    ruleSource = 'base de datos';
    disconnect = () => db.$disconnect();
  } else if (values.rules) {
    const list = rulesFileSchema.parse(JSON.parse(await readFile(values.rules, 'utf8')));
    rules = { listActiveRules: async () => list };
    ruleSource = values.rules;
  } else {
    const list = defaultRules();
    rules = { listActiveRules: async () => list };
    ruleSource = 'por defecto (CIF y razón social de las siete sociedades)';
  }

  const keys: ProviderKeys = process.env;
  const summaries = [];
  try {
    const runs: Array<{ label: string; llm: LlmClassifier | undefined }> = [
      { label: 'Solo reglas (sin LLM)', llm: undefined },
    ];
    for (const spec of values.llm ?? []) {
      const colon = spec.indexOf(':');
      if (colon <= 0 || colon === spec.length - 1) {
        throw new Error(`--llm debe ser proveedor:modelo, no "${spec}"`);
      }
      const setting = { provider: spec.slice(0, colon), model: spec.slice(colon + 1) };
      runs.push({
        label: `Reglas + LLM ${spec}`,
        llm: createLlmClassifier({
          settings: { getActive: async () => setting },
          keys,
          ...(maxChars ? { maxChars } : {}),
        }),
      });
    }

    for (const run of runs) {
      const results = await runAll(cases, { rules, llm: run.llm, threshold });
      summaries.push(summarizeRun(run.label, cases, results));
      if (values.details) printDetails(run.label, cases, results);
    }
  } finally {
    await disconnect?.();
  }

  console.log(`# Evaluación del clasificador\n`);
  console.log(
    `Casos: ${cases.length} (${casesPath}) | reglas: ${ruleSource} | umbral: ${threshold}\n`,
  );
  console.log(formatReport(summaries));
  if ((values.llm ?? []).length === 0) {
    console.log('Sin --llm: solo se ha ejecutado la pasada de reglas.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
