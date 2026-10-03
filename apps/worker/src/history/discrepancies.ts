import type { Category, ExtractedEmail } from '@clasificador/shared';

import { defaultRules } from '../classify/default-rules';
import { evaluateRules, type RuleRecord } from '../classify/rules';
import { teamLabels } from './types';

export interface Discrepancy {
  messageId: string;
  receivedAt: string;
  from: string;
  subject: string;
  /** Categorías que las reglas fuertes encuentran y el equipo no puso. */
  missing: Category[];
  teamCategories: string[];
  reasons: string[];
}

/**
 * Correos donde las reglas fuertes dicen una categoría que el equipo no puso: histórico incompleto
 * (p. ej. "Lateral Arturo Soria" sin LATERAL) o regla demasiado amplia. Se revisan con el usuario
 * antes de contarlos como error del clasificador.
 */
export function findDiscrepancies(
  cases: ReadonlyArray<{ email: ExtractedEmail; expected: readonly string[] }>,
  rules: readonly RuleRecord[] = defaultRules(),
): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const { email, expected } of cases) {
    const labeled = new Set(teamLabels(expected));
    const evidence = evaluateRules(email, rules);
    const missing: Category[] = [];
    const reasons: string[] = [];
    for (const category of Object.keys(evidence) as Category[]) {
      const strong = evidence[category].strong;
      if (strong.length === 0 || labeled.has(category)) continue;
      missing.push(category);
      reasons.push(`${category}: ${strong.map((h) => h.description).join(', ')}`);
    }
    if (missing.length === 0) continue;
    out.push({
      messageId: email.messageId,
      receivedAt: email.receivedAt.toISOString(),
      from: email.fromAddress ?? '',
      subject: email.subject,
      missing,
      teamCategories: [...expected],
      reasons,
    });
  }
  return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

export function formatDiscrepanciesMarkdown(
  items: readonly Discrepancy[],
  totalCases: number,
): string {
  const lines = [
    '# Discrepancias entre reglas fuertes y etiquetas del equipo',
    '',
    `${items.length} de ${totalCases} correos de la muestra: las reglas fuertes (CIF o razón social) ` +
      'encuentran una categoría que el equipo no puso. Revisar con el usuario antes de contarlos como error.',
    '',
  ];
  if (items.length === 0) return `${lines.join('\n')}Ninguna.\n`;
  lines.push('| Fecha | Remitente | Asunto | Etiquetas del equipo | Reglas fuertes dicen | Id |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const d of items) {
    lines.push(
      `| ${d.receivedAt.slice(0, 10)} | ${cell(d.from)} | ${cell(d.subject)} | ${cell(d.teamCategories.join(', ') || '(ninguna)')} | ${cell(d.reasons.join('; '))} | ${d.messageId} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
