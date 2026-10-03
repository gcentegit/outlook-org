/**
 * Prueba de integración del servicio completo en modo sombra: worker real (migraciones, bloqueo,
 * pg-boss, extracción con docling, clasificador, repositorios Prisma) contra un buzón de Graph
 * simulado que se inyecta como `fetch` del cliente. Necesita PostgreSQL y docling levantados:
 *
 *   RUN_INTEGRATION=1 pnpm --filter @clasificador/worker exec vitest run src/shadow-service.integration.test.ts
 *
 * Usa `DATABASE_URL` y `DOCLING_URL` del entorno (con `--env-file`, los de `.env`) y borra al
 * terminar todo lo que crea (filas con id `it-*`, el estado de sincronización y el esquema de pg-boss).
 */
import type { PrismaClient } from '@clasificador/db';
import { createPrismaClient } from '@clasificador/db';
import {
  CREATE_MASTER_CATEGORY_QUEUE,
  LIST_MASTER_CATEGORIES_QUEUE,
  REPROCESS_FLAGGED_QUEUE,
  TEST_CLASSIFY_QUEUE,
  sampleTestEmail,
} from '@clasificador/shared';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config';
import { GraphClient } from './graph/client';
import { startWorker, type RunningWorker } from './index';
import { tryAcquireInstanceLock } from './sync/instance-lock';

const enabled = process.env.RUN_INTEGRATION === '1';
const MAILBOX = 'buzon@ejemplo.com';
const GRAPH = `https://graph.test/v1.0/users/${encodeURIComponent(MAILBOX)}`;

/** PDF de una página con las líneas de texto indicadas (Helvetica, sin compresión). */
function buildPdf(lines: string[]): Buffer {
  const escape = (t: string): string => t.replace(/[\\()]/g, '\\$&');
  const content = `BT /F1 12 Tf 50 780 Td 16 TL ${lines
    .map((l) => `(${escape(l)}) Tj T*`)
    .join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

interface FakeMail {
  id: string;
  subject: string;
  body: string;
  categories: string[];
  pdf?: Buffer;
}

/** Buzón simulado: sirve la delta query, la lista maestra, los mensajes y sus adjuntos. */
class FakeMailbox {
  readonly mails = new Map<string, FakeMail>();
  /** Lista maestra de categorías del buzón; el POST de creación la amplía. */
  readonly masterCategories = ['FOOD BOX', 'LATERAL', 'ARCOBETA', 'Pagado'];
  /** Cambios que verá la delta query en cada ronda (índice = token). */
  readonly rounds: { id: string; categories?: string[] }[][] = [[]];
  /** Última ronda que ha pedido el worker. */
  lastServedRound = 0;

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

    if (url.startsWith(`${GRAPH}/mailFolders/inbox/messages/delta`)) {
      const token = /\$deltatoken=D(\d+)/.exec(url)?.[1];
      const round = token === undefined ? 0 : Number(token);
      this.lastServedRound = round;
      const changes = (this.rounds[round] ?? []).map((c) => {
        const mail = this.mails.get(c.id);
        return {
          id: c.id,
          receivedDateTime: new Date().toISOString(),
          conversationId: `conv-${c.id}`,
          categories: c.categories ?? mail?.categories ?? [],
        };
      });
      return json({
        value: changes,
        '@odata.deltaLink': `${GRAPH}/mailFolders/inbox/messages/delta?$deltatoken=D${round + 1}`,
      });
    }
    if (url === `${GRAPH}/outlook/masterCategories`) {
      if (init?.method === 'POST') {
        const { displayName, color } = JSON.parse(String(init.body)) as {
          displayName: string;
          color: string;
        };
        this.masterCategories.push(displayName);
        return json({ id: `cat-${this.masterCategories.length}`, displayName, color });
      }
      return json({
        value: this.masterCategories.map((displayName, i) => ({
          id: `cat-${i}`,
          displayName,
          color: 'preset7',
        })),
      });
    }
    const attachmentValue = /\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/.exec(url);
    if (attachmentValue) {
      const mail = this.mails.get(decodeURIComponent(attachmentValue[1]!));
      return new Response(new Uint8Array(mail?.pdf ?? Buffer.alloc(0)));
    }
    const attachments = /\/messages\/([^/?]+)\/attachments\?/.exec(url);
    if (attachments) {
      const mail = this.mails.get(decodeURIComponent(attachments[1]!));
      return json({
        value: mail?.pdf
          ? [
              {
                '@odata.type': '#microsoft.graph.fileAttachment',
                id: 'att1',
                name: 'factura.pdf',
                contentType: 'application/pdf',
                size: mail.pdf.length,
                isInline: false,
              },
            ]
          : [],
      });
    }
    const message = /\/messages\/([^/?]+)\?/.exec(url);
    if (message) {
      const mail = this.mails.get(decodeURIComponent(message[1]!));
      if (!mail) return new Response('{}', { status: 404 });
      return json({
        id: mail.id,
        subject: mail.subject,
        from: { emailAddress: { name: 'Proveedor', address: 'facturas@proveedor.es' } },
        body: { contentType: 'text', content: mail.body },
        categories: mail.categories,
        hasAttachments: Boolean(mail.pdf),
        receivedDateTime: new Date().toISOString(),
        conversationId: `conv-${mail.id}`,
      });
    }
    return new Response(`ruta no simulada: ${url}`, { status: 500 });
  };
}

async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | false>,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe.skipIf(!enabled)('servicio en modo sombra (integración)', () => {
  const mailbox = new FakeMailbox();
  let db: PrismaClient;
  let worker: RunningWorker;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Falta DATABASE_URL');
    db = createPrismaClient(url);

    mailbox.mails.set('it-1', {
      id: 'it-1',
      subject: 'Factura 2026-001',
      body: 'Adjuntamos la factura.',
      categories: [],
      pdf: buildPdf([
        'FACTURA 2026-001',
        'Cliente: FOODBOX, S.A.',
        'CIF: A87240420',
        'Total: 100 EUR',
      ]),
    });
    mailbox.mails.set('it-2', {
      id: 'it-2',
      subject: 'Factura 2026-002',
      body: 'Factura adjunta.',
      categories: [],
      pdf: buildPdf([
        'FACTURA 2026-002',
        'Cliente: LATERAL IBERIA, S.L.',
        'CIF: B88300413',
        'Total: 50 EUR',
      ]),
    });
    mailbox.mails.set('it-3', {
      id: 'it-3',
      subject: 'Consulta',
      body: 'Hola, ¿cuándo llega el pedido?',
      categories: [],
    });
    // Ronda 0: arranque (nada). Ronda 1: llegan los tres. La corrección del equipo se añade
    // en la prueba, cuando las decisiones ya están guardadas.
    mailbox.rounds[1] = [{ id: 'it-1' }, { id: 'it-2' }, { id: 'it-3' }];

    const config = {
      ...loadConfig({
        DATABASE_URL: url,
        DOCLING_URL: process.env.DOCLING_URL ?? 'http://127.0.0.1:5101',
        MODE: 'shadow',
        APP_VERSION: 'it-test',
        GRAPH_TENANT_ID: 'tenant',
        GRAPH_CLIENT_ID: 'client',
        GRAPH_CERT_PATH: '/no/se/usa.pem',
        MAILBOX,
      }),
      // Por debajo del mínimo configurable: solo para que la prueba no espere 15 s por ronda.
      POLL_INTERVAL_SECONDS: 1,
      // Puerto libre elegido por el sistema.
      HEALTH_PORT: 0,
    };
    const graph = new GraphClient({
      getToken: async () => 'token-simulado',
      fetchImpl: mailbox.fetch as typeof fetch,
      baseUrl: 'https://graph.test/v1.0',
    });
    worker = await startWorker(config, { graph });
  }, 120_000);

  afterAll(async () => {
    await worker?.stop();
    if (db) {
      await db.message.deleteMany({ where: { id: { startsWith: 'it-' } } });
      await db.attachmentText.deleteMany({ where: { markdown: { contains: 'FACTURA 2026-00' } } });
      await db.syncState.deleteMany({ where: { id: 'inbox' } });
      await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS pgboss CASCADE');
      await db.$disconnect();
    }
  });

  it('guarda Message, AttachmentText y Decision en modo sombra y registra la corrección', async () => {
    const health = await fetch(`http://127.0.0.1:${worker.healthPort}/health`);
    expect(health.headers.get('content-type')).toContain('json');
    expect(((await health.json()) as { version: string }).version).toBe('it-test');

    const decisions = await waitFor('3 decisiones', async () => {
      const rows = await db.decision.findMany({
        where: { messageId: { startsWith: 'it-' } },
        orderBy: { messageId: 'asc' },
      });
      return rows.length === 3 ? rows : null;
    });

    for (const d of decisions) expect(d.mode).toBe('shadow');
    expect(decisions.map((d) => d.categories)).toEqual([['FOOD BOX'], ['LATERAL'], []]);
    expect(decisions[0]?.decision).toMatchObject({ source: 'rule', needsReview: false });
    expect(decisions[2]?.decision).toMatchObject({ source: 'none', needsReview: true });

    // Los dos primeros son decisiones válidas; el tercero necesitaba el LLM, que no está
    // disponible (sin clave): decisión degradada y correo marcado para reprocesar.
    expect(decisions.map((d) => d.degraded)).toEqual([false, false, true]);
    const messages = await db.message.findMany({
      where: { id: { startsWith: 'it-' } },
      orderBy: { id: 'asc' },
    });
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => [m.status, m.needsReprocess])).toEqual([
      ['processed', false],
      ['processed', false],
      ['processed', true],
    ]);
    const attachmentTexts = await db.attachmentText.findMany({
      where: { markdown: { contains: 'A87240420' } },
    });
    expect(attachmentTexts.length).toBeGreaterThanOrEqual(1);

    // El equipo cambia las categorías de it-1: queda una corrección con lo propuesto y lo final.
    mailbox.rounds[mailbox.lastServedRound + 1] = [
      { id: 'it-1', categories: ['LATERAL', 'Pagado'] },
    ];
    const correction = await waitFor('la corrección', async () =>
      db.correction.findFirst({ where: { messageId: 'it-1' } }),
    );
    expect(correction.proposed).toEqual(['FOOD BOX']);
    expect(correction.final).toEqual(['LATERAL']);
    expect(correction.decisionId).toBe(decisions[0]?.id);
    const seen = await db.message.findUnique({ where: { id: 'it-1' } });
    expect(seen?.seenCategories).toEqual(['LATERAL', 'Pagado']);

    // Con el servicio en marcha, una segunda instancia no puede tomar el bloqueo.
    const second = await tryAcquireInstanceLock(process.env.DATABASE_URL!, { onLost: () => {} });
    expect(second).toBeNull();

    const sync = await db.syncState.findUnique({ where: { id: 'inbox' } });
    expect(sync?.deltaLink).toContain('deltatoken');
    const health2 = await fetch(`http://127.0.0.1:${worker.healthPort}/health`);
    expect(health2.status).toBe(200);
  }, 120_000);

  it('el panel lee y crea categorías por el worker y reprocesa los correos marcados', async () => {
    const client = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    await client.start();
    const run = async (queue: string, data: object = {}): Promise<unknown> => {
      const id = await client.send(queue, data);
      expect(id).toBeTruthy();
      const job = await waitFor(`el trabajo ${queue}`, async () => {
        const j = await client.getJobById(queue, id!);
        return j?.state === 'completed' || j?.state === 'failed' ? j : null;
      });
      expect(job.state).toBe('completed');
      return job.output;
    };
    try {
      expect(await run(LIST_MASTER_CATEGORIES_QUEUE)).toMatchObject({
        status: 'ok',
        mailbox: MAILBOX,
        categories: expect.arrayContaining([
          { id: 'cat-0', displayName: 'FOOD BOX', color: 'preset7' },
        ]),
      });

      expect(
        await run(CREATE_MASTER_CATEGORY_QUEUE, { name: 'Revisar', color: 'preset4' }),
      ).toMatchObject({
        status: 'created',
        category: { displayName: 'Revisar', color: 'preset4' },
      });
      expect(mailbox.masterCategories).toContain('Revisar');
      expect(
        await run(CREATE_MASTER_CATEGORY_QUEUE, { name: 'lateral', color: 'preset4' }),
      ).toMatchObject({
        status: 'exists',
      });
      expect(await run(CREATE_MASTER_CATEGORY_QUEUE, { name: '', color: 'x' })).toMatchObject({
        status: 'error',
      });

      // Reproceso: it-3 sigue marcado (no hay LLM) y vuelve a procesarse, con una nueva decisión.
      expect(await run(REPROCESS_FLAGGED_QUEUE)).toEqual({ enqueued: 1 });
      await waitFor('la segunda decisión de it-3', async () =>
        (await db.decision.count({ where: { messageId: 'it-3' } })) === 2 ? true : null,
      );
      const flagged = await db.message.findMany({
        where: { needsReprocess: true, id: { startsWith: 'it-' } },
      });
      expect(flagged.map((m) => m.id)).toEqual(['it-3']);
      expect((await db.message.findUnique({ where: { id: 'it-3' } }))?.status).toBe('processed');
    } finally {
      await client.stop({ graceful: false });
    }
  }, 120_000);

  it('/livez responde 200 con el servicio en marcha', async () => {
    const live = await fetch(`http://127.0.0.1:${worker.healthPort}/livez`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: 'alive', version: 'it-test' });
  });
});

describe.skipIf(!enabled)('servicio sin credenciales de Graph (integración)', () => {
  it('arranca dos veces seguidas, no sincroniza y /health da 503 con el motivo', async () => {
    const url = process.env.DATABASE_URL!;
    const config = {
      ...loadConfig({ DATABASE_URL: url, MODE: 'shadow', APP_VERSION: 'it-test' }),
      HEALTH_PORT: 0,
    };
    const cleanup = createPrismaClient(url);
    try {
      // Dos arranques seguidos comprueban que las colas de pg-boss ya existentes no dan error.
      for (let i = 0; i < 2; i++) {
        const worker = await startWorker(config);
        try {
          const res = await fetch(`http://127.0.0.1:${worker.healthPort}/health`);
          expect(res.status).toBe(503);
          const body = (await res.json()) as { status: string; reason: string; version: string };
          expect(body).toMatchObject({ status: 'disabled', version: 'it-test' });
          expect(body.reason).toMatch(
            /faltan: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CERT_PATH, MAILBOX/,
          );
          expect(await cleanup.syncState.count()).toBe(0);
          // El HEALTHCHECK usa /livez: sin credenciales de Graph el contenedor está vivo.
          const live = await fetch(`http://127.0.0.1:${worker.healthPort}/livez`);
          expect(live.status).toBe(200);
        } finally {
          await worker.stop();
        }
      }
    } finally {
      await cleanup.$executeRawUnsafe('DROP SCHEMA IF EXISTS pgboss CASCADE');
      await cleanup.$disconnect();
    }
  }, 60_000);
});

describe.skipIf(!enabled)('prueba de modelos desde el panel (integración)', () => {
  it('el worker atiende test-classify sin credenciales de Graph y /health expone los modos', async () => {
    const url = process.env.DATABASE_URL!;
    const config = {
      ...loadConfig({ DATABASE_URL: url, MODE: 'shadow', APP_VERSION: 'it-test' }),
      HEALTH_PORT: 0,
    };
    const db = createPrismaClient(url);
    await db.categorySetting.upsert({
      where: { category: 'LATERAL' },
      create: { category: 'LATERAL', mode: 'live' },
      update: { mode: 'live' },
    });
    const worker = await startWorker(config);
    // Cliente como el del panel: solo encola y consulta.
    const client = new PgBoss({
      connectionString: url,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    await client.start();
    try {
      const health = (await (
        await fetch(`http://127.0.0.1:${worker.healthPort}/health`)
      ).json()) as { categoryModes: Record<string, string>; mode: string };
      expect(health.mode).toBe('shadow');
      expect(health.categoryModes).toEqual({
        'FOOD BOX': 'shadow',
        LATERAL: 'live',
        ARCOBETA: 'shadow',
      });

      const id = await client.send(TEST_CLASSIFY_QUEUE, {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        email: sampleTestEmail(),
      });
      expect(id).toBeTruthy();
      let job = await client.getJobById(TEST_CLASSIFY_QUEUE, id!);
      for (let i = 0; i < 30 && job?.state !== 'completed' && job?.state !== 'failed'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        job = await client.getJobById(TEST_CLASSIFY_QUEUE, id!);
      }
      expect(job?.state).toBe('completed');
      expect(job?.output).toMatchObject({
        status: 'unavailable',
        message: 'Falta ANTHROPIC_API_KEY para el proveedor anthropic',
        decision: null,
      });

      // Sin credenciales de Graph, las categorías del panel responden con el motivo (sin fallar).
      const listId = await client.send(LIST_MASTER_CATEGORIES_QUEUE, {});
      let listJob = await client.getJobById(LIST_MASTER_CATEGORIES_QUEUE, listId!);
      for (
        let i = 0;
        i < 30 && listJob?.state !== 'completed' && listJob?.state !== 'failed';
        i++
      ) {
        await new Promise((r) => setTimeout(r, 500));
        listJob = await client.getJobById(LIST_MASTER_CATEGORIES_QUEUE, listId!);
      }
      expect(listJob?.state).toBe('completed');
      expect(listJob?.output).toMatchObject({
        status: 'unconfigured',
        message: expect.stringContaining(
          'faltan: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CERT_PATH, MAILBOX',
        ),
      });
    } finally {
      await client.stop({ graceful: false });
      await worker.stop();
      await db.categorySetting.deleteMany({});
      await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS pgboss CASCADE');
      await db.$disconnect();
    }
  }, 60_000);
});
