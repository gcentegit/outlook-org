/**
 * Notas de las Releases de GitHub.
 *
 *   node release-notes.ts check              # en un PR: título con icono y sección de notas (PR_TITLE, PR_BODY)
 *   node release-notes.ts publish vX.Y.Z     # completa la Release con el detalle de cada PR
 *   node release-notes.ts publish vX.Y.Z --dry-run
 *
 * release-please escribe una línea por PR (su título). El detalle se escribe en origen, en la sección
 * «Para las notas de la release» de la descripción del PR, y aquí se copia TAL CUAL debajo de su
 * línea: no se reescribe, no se resume ni se reordena. Al final se añade un pie con enlaces.
 * `publish` se puede repetir: no duplica lo que ya está. Lee GITHUB_TOKEN y GITHUB_REPOSITORY.
 * Reglas: docs/operacion/versiones-y-releases.md.
 */
import { pathToFileURL } from 'node:url';

export const NOTES_HEADING = 'Para las notas de la release';
/** Tipos que salen en el CHANGELOG y en las notas; el resto no genera versión. */
export const TYPES_IN_NOTES = ['feat', 'fix', 'perf', 'revert'];

const TITLE_RE = /^(\w+)(\([^)]*\))?!?: (.*)$/u;
const STARTS_WITH_ICON_RE = /^\p{Extended_Pictographic}/u;
/** Línea de release-please: `* **ámbito:** descripción ([abc1234](…/commit/<sha>))`. */
const RELEASE_BULLET_RE = /^\* .*\/commit\/([0-9a-f]{40})\)\)\s*$/;
const COMPARE_RE = /^## \[[^\]]+\]\((https:\/\/github\.com\/[^)]+\/compare\/([^)]+)\.\.\.([^)]+))\)/m;
const FOOTER_MARK = '**Cambios:**';

export function parseTitle(title: string): { type: string; subject: string } | null {
  const match = TITLE_RE.exec(title.trim());
  return match ? { type: match[1]!, subject: match[3]! } : null;
}

/**
 * Puntos de la sección de notas del PR: las líneas de lista de primer nivel y sus líneas
 * sangradas. Se ignoran los comentarios HTML y cualquier texto suelto de la sección.
 */
export function extractNotes(body: string): string[] {
  const lines = body
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${NOTES_HEADING}\\s*$`, 'i').test(line.trim()));
  if (start === -1) return [];

  const notes: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line) || line.startsWith('BEGIN_COMMIT_OVERRIDE')) break;
    if (/^[-*] \S/.test(line)) notes.push(`- ${line.slice(2).trimEnd()}`);
    else if (notes.length > 0 && /^\s{2,}\S/.test(line)) notes.push(line.trimEnd());
  }
  return notes;
}

/** Errores del título y de la sección de notas de un PR; vacío si está bien. */
export function checkPullRequest(title: string, body: string): string[] {
  const parsed = parseTitle(title);
  // El formato del título lo valida el paso anterior del mismo check.
  if (!parsed || !TYPES_IN_NOTES.includes(parsed.type)) return [];

  const errors: string[] = [];
  if (!STARTS_WITH_ICON_RE.test(parsed.subject)) {
    errors.push(`El título debe empezar la descripción por un icono: "${parsed.type}(ámbito): 🐛 descripción".`);
  }
  const topLevel = extractNotes(body).filter((line) => line.startsWith('- '));
  if (topLevel.length === 0) {
    errors.push(`Falta la sección «## ${NOTES_HEADING}» en la descripción del PR, con al menos un punto.`);
  }
  for (const line of topLevel) {
    if (!STARTS_WITH_ICON_RE.test(line.slice(2))) {
      errors.push(`Cada punto de «${NOTES_HEADING}» empieza por un icono: "${line}".`);
    }
  }
  return errors;
}

/** Pie con el enlace de comparación (si lo hay) y el CHANGELOG de esa versión. */
export function footer(body: string, repo: string, tag: string): string {
  const changelog = `**Changelog:** [\`CHANGELOG.md\`](https://github.com/${repo}/blob/${tag}/CHANGELOG.md)`;
  const compare = COMPARE_RE.exec(body);
  const changes = compare ? `${FOOTER_MARK} [\`${compare[2]}...${compare[3]}\`](${compare[1]}) · ` : '';
  return `---\n${changes}${changelog}`;
}

/**
 * Pone debajo de cada línea de release-please los puntos de su PR, sangrados, y añade el pie.
 * Lo que ya tiene detalle o pie no se toca, para poder repetirlo.
 */
export function enrichRelease(
  body: string,
  notesFor: (sha: string) => string[] | undefined,
  footerText: string,
): string {
  const lines = body.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const out: string[] = [];
  lines.forEach((line, index) => {
    out.push(line);
    const sha = RELEASE_BULLET_RE.exec(line)?.[1];
    if (!sha || /^\s{2,}\S/.test(lines[index + 1] ?? '')) return;
    for (const note of notesFor(sha) ?? []) out.push(`  ${note}`);
  });
  const enriched = out.join('\n');
  return enriched.includes('**Changelog:**') ? `${enriched}\n` : `${enriched}\n\n${footerText}\n`;
}

// ── Entrada y salida ───────────────────────────────────────────────────────────────────────────

async function github(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Falta GITHUB_TOKEN.');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  return response.json();
}

async function publish(tag: string, dryRun: boolean): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('Falta GITHUB_REPOSITORY (propietario/repositorio).');
  const release = (await github(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`)) as {
    id: number;
    body: string | null;
  };
  const body = release.body ?? '';

  const notes = new Map<string, string[]>();
  for (const line of body.split('\n')) {
    const sha = RELEASE_BULLET_RE.exec(line.trimEnd())?.[1];
    if (!sha || notes.has(sha)) continue;
    const pulls = (await github(`/repos/${repo}/commits/${sha}/pulls`)) as {
      number: number;
      body: string | null;
      merged_at: string | null;
    }[];
    const pull = pulls.find((candidate) => candidate.merged_at);
    const found = pull ? extractNotes(pull.body ?? '') : [];
    if (found.length === 0) console.log(`::notice::Sin notas para ${sha.slice(0, 7)}${pull ? ` (PR #${pull.number})` : ''}.`);
    notes.set(sha, found);
  }

  const enriched = enrichRelease(body, (sha) => notes.get(sha), footer(body, repo, tag));
  if (enriched.trimEnd() === body.replace(/\r\n/g, '\n').trimEnd()) {
    console.log(`${tag}: las notas ya estaban completas.`);
    return;
  }
  if (dryRun) {
    console.log(enriched);
    return;
  }
  await github(`/repos/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: enriched }),
  });
  console.log(`${tag}: notas completadas.`);
}

async function main(args: string[]): Promise<number> {
  const [command, tag] = args;
  if (command === 'check') {
    const errors = checkPullRequest(process.env.PR_TITLE ?? '', process.env.PR_BODY ?? '');
    for (const error of errors) console.log(`::error::${error} Guía: docs/operacion/versiones-y-releases.md`);
    return errors.length === 0 ? 0 : 1;
  }
  if (command === 'publish' && tag && /^v\d+\.\d+\.\d+$/.test(tag)) {
    await publish(tag, args.includes('--dry-run'));
    return 0;
  }
  console.error('Uso: node release-notes.ts check | publish vX.Y.Z [--dry-run]');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
