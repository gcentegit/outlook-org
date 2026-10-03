import { CATEGORIES, type Category } from '@clasificador/shared';

import type { PrismaClient } from '@clasificador/db';

import { subjectNgrams } from './keywords';
import { teamLabels, type HistoryMessage } from './types';

export type CandidateType = 'remitente' | 'dominio' | 'palabra_clave';

export interface RuleCandidate {
  id: string;
  type: CandidateType;
  value: string;
  category: Category;
  weight: 'medio';
  /** Siempre inactiva: la activa el usuario tras revisarla. */
  active: false;
  /** Correos del conjunto de desarrollo con esta señal. */
  total: number;
  /** De ellos, los que el equipo etiquetó con `category`. */
  hits: number;
  purity: number;
}

export interface CandidateOptions {
  minOccurrences: number;
  minPurity: number;
  /** Correo público: nunca una regla de dominio, sí de dirección concreta. */
  genericDomains: ReadonlySet<string>;
  /** Dominios del grupo: ni de dominio ni de dirección (los compañeros reenvían de todo). */
  internalDomains: ReadonlySet<string>;
}

/** [total, ...aciertos por categoría en el orden de CATEGORIES]. */
type Stats = number[];

const bump = (map: Map<string, Stats>, key: string, hitIdx: readonly number[]): void => {
  let stats = map.get(key);
  if (!stats) {
    stats = new Array<number>(CATEGORIES.length + 1).fill(0);
    map.set(key, stats);
  }
  stats[0] = (stats[0] as number) + 1;
  for (const i of hitIdx) stats[i + 1] = (stats[i + 1] as number) + 1;
};

const domainOf = (address: string): string | null => {
  const at = address.lastIndexOf('@');
  return at > 0 && at < address.length - 1 ? address.slice(at + 1).toLowerCase() : null;
};

/** ¿Es el dominio de la lista o un subdominio suyo? */
const inDomains = (domain: string, set: ReadonlySet<string>): boolean =>
  [...set].some((d) => domain === d || domain.endsWith(`.${d}`));

/**
 * Qué reglas de remitente o dominio no se proponen nunca, por mucho que cumplan el umbral:
 * - dominio genérico (gmail, outlook…) o interno: ninguna regla de dominio entero;
 * - dominio interno: tampoco de dirección concreta.
 * Los correos de esos dominios se siguen clasificando por CIF y razón social.
 */
export function isProposable(
  candidate: Pick<RuleCandidate, 'type' | 'value'>,
  options: Pick<CandidateOptions, 'genericDomains' | 'internalDomains'>,
): boolean {
  if (candidate.type === 'palabra_clave') return true;
  const domain =
    candidate.type === 'dominio' ? candidate.value.toLowerCase() : domainOf(candidate.value);
  if (!domain) return true;
  if (inDomains(domain, options.internalDomains)) return false;
  return !(candidate.type === 'dominio' && inDomains(domain, options.genericDomains));
}

/**
 * Propone reglas medias a partir de los correos de desarrollo: remitentes, dominios y n-gramas del
 * asunto cuyo histórico es ≥ `minPurity` de una categoría con al menos `minOccurrences` apariciones.
 * Los correos sin ninguna categoría cuentan en el denominador: una señal que aparece mucho en
 * correos sin etiquetar no es fiable. Un correo con varias categorías cuenta como acierto de cada una.
 */
export function proposeCandidates(
  messages: readonly HistoryMessage[],
  options: CandidateOptions,
): RuleCandidate[] {
  const senders = new Map<string, Stats>();
  const domains = new Map<string, Stats>();
  const keywords = new Map<string, Stats>();

  for (const m of messages) {
    const labels = teamLabels(m.categories);
    const hitIdx = labels.map((l) => CATEGORIES.indexOf(l));
    if (m.fromAddress) {
      bump(senders, m.fromAddress, hitIdx);
      const domain = domainOf(m.fromAddress);
      if (domain) bump(domains, domain, hitIdx);
    }
    for (const gram of subjectNgrams(m.subject)) bump(keywords, gram, hitIdx);
  }

  const qualifies = (stats: Stats, categoryIdx: number): boolean => {
    const total = stats[0] as number;
    const hits = stats[categoryIdx + 1] as number;
    return total >= options.minOccurrences && hits / total >= options.minPurity - 1e-9;
  };

  const out: Omit<RuleCandidate, 'id'>[] = [];
  const push = (type: CandidateType, value: string, stats: Stats, idx: number) => {
    const total = stats[0] as number;
    const hits = stats[idx + 1] as number;
    out.push({
      type,
      value,
      category: CATEGORIES[idx] as Category,
      weight: 'medio',
      active: false,
      total,
      hits,
      purity: hits / total,
    });
  };

  CATEGORIES.forEach((_, idx) => {
    for (const [domain, stats] of domains) {
      if (qualifies(stats, idx) && isProposable({ type: 'dominio', value: domain }, options)) {
        push('dominio', domain, stats, idx);
      }
    }
    for (const [sender, stats] of senders) {
      if (!qualifies(stats, idx) || !isProposable({ type: 'remitente', value: sender }, options)) {
        continue;
      }
      // Si el dominio ya cumple (y se propone) para la misma categoría, esa regla cubre al remitente.
      const domain = domainOf(sender);
      const domainStats = domain ? domains.get(domain) : undefined;
      if (
        domain &&
        domainStats &&
        qualifies(domainStats, idx) &&
        isProposable({ type: 'dominio', value: domain }, options)
      ) {
        continue;
      }
      push('remitente', sender, stats, idx);
    }
    for (const [gram, stats] of keywords) {
      if (!qualifies(stats, idx)) continue;
      // Un n-grama con las mismas apariciones que uno de sus extremos más corto no aporta nada.
      const words = gram.split(' ');
      if (words.length > 1) {
        const shorter = [words.slice(0, -1).join(' '), words.slice(1).join(' ')];
        const redundant = shorter.some((key) => {
          const s = keywords.get(key);
          return s && s[0] === stats[0] && s[idx + 1] === stats[idx + 1];
        });
        if (redundant) continue;
      }
      push('palabra_clave', gram, stats, idx);
    }
  });

  const typeOrder: Record<CandidateType, number> = { dominio: 0, remitente: 1, palabra_clave: 2 };
  out.sort(
    (a, b) =>
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
      typeOrder[a.type] - typeOrder[b.type] ||
      b.hits - a.hits ||
      a.value.localeCompare(b.value),
  );
  return out.map((c, i) => ({ id: `cand-${String(i + 1).padStart(4, '0')}`, ...c }));
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** Tabla Markdown para revisar con el usuario. */
export function formatCandidatesMarkdown(
  candidates: readonly RuleCandidate[],
  meta: { devMessages: number; options: CandidateOptions; generatedAt: string },
): string {
  const lines = [
    '# Reglas candidatas (peso medio)',
    '',
    `Generado el ${meta.generatedAt} sobre ${meta.devMessages} correos del conjunto de desarrollo. ` +
      `Criterio: al menos ${meta.options.minOccurrences} apariciones y ${(meta.options.minPurity * 100).toFixed(0)} % de una misma categoría ` +
      `(los correos sin categoría cuentan en contra). Todas se cargan inactivas: se activan tras revisarlas. ` +
      `Nunca se proponen reglas de dominio entero para correo público (gmail, outlook…) ni para los dominios del grupo, ` +
      `ni de dirección concreta para los del grupo: esos correos se clasifican por CIF y razón social.`,
    '',
  ];
  for (const category of CATEGORIES) {
    const rows = candidates.filter((c) => c.category === category);
    lines.push(`## ${category} (${rows.length})`, '');
    if (rows.length === 0) {
      lines.push('Sin candidatas.', '');
      continue;
    }
    lines.push('| Id | Tipo | Valor | Apariciones | Aciertos | Pureza | Nota | Activar |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | :---: |');
    for (const c of rows) {
      lines.push(
        `| ${c.id} | ${c.type} | ${cell(c.value)} | ${c.total} | ${c.hits} | ${(c.purity * 100).toFixed(1)} % | | [ ] |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Parte del cliente de Prisma que usa la carga de candidatas (facilita probarla sin base de datos). */
export type RuleDb = Pick<PrismaClient, 'rule'>;

/**
 * Carga las candidatas en la tabla `Rule` como inactivas. Las que ya existen no se tocan (ni su
 * peso ni su estado), así repetir la carga es inocuo. Se vuelve a aplicar el filtro de dominios
 * genéricos e internos: un fichero de candidatas generado antes de que existiera (o con otra
 * configuración) no debe colar reglas prohibidas. Las descartadas se cuentan en `skipped`.
 */
export async function applyCandidates(
  db: RuleDb,
  candidates: readonly RuleCandidate[],
  options: Pick<CandidateOptions, 'genericDomains' | 'internalDomains'>,
): Promise<{ created: number; existing: number; skipped: number }> {
  const allowed = candidates.filter((c) => isProposable(c, options));
  const result = await db.rule.createMany({
    data: allowed.map((c) => ({
      type: c.type,
      value: c.value,
      category: c.category,
      weight: 'medio' as const,
      active: false,
    })),
    skipDuplicates: true,
  });
  return {
    created: result.count,
    existing: allowed.length - result.count,
    skipped: candidates.length - allowed.length,
  };
}
