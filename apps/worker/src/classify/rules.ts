import { CATEGORIES, normalizeCif, type Category, type ExtractedEmail } from '@clasificador/shared';

export type RuleType = 'cif' | 'razon_social' | 'remitente' | 'dominio' | 'palabra_clave';
export type RuleWeight = 'fuerte' | 'medio';

/** Regla activa tal como la guarda la tabla `Rule`. */
export interface RuleRecord {
  id: string;
  type: RuleType;
  value: string;
  category: string;
  weight: RuleWeight;
}

/** Origen de las reglas; inyectable para probar sin base de datos. */
export interface RuleRepository {
  listActiveRules(): Promise<RuleRecord[]>;
}

export interface RuleHit {
  ruleId: string;
  type: RuleType;
  /** Texto legible para el campo `reason`. */
  description: string;
}

/** Coincidencias de reglas de una categoría, separadas por peso. */
export interface CategoryRuleHits {
  strong: RuleHit[];
  medium: RuleHit[];
}

export type RuleEvidence = Record<Category, CategoryRuleHits>;

/** Quita acentos, pasa a mayúsculas y deja solo letras y dígitos separados por un espacio. */
export function foldText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Palabras (ya normalizadas con `foldText`) como expresión con límites de palabra. */
function wordsPattern(folded: string): string {
  return folded.split(' ').join('\\s+');
}

const BOUNDARY_BEFORE = '(?<![A-Z0-9])';
const BOUNDARY_AFTER = '(?![A-Z0-9])';
/** Hasta tres separadores (espacio, punto, guion) entre los caracteres de un CIF. */
const CIF_SEPARATOR = '[\\s.\\-]{0,3}';
/** Forma societaria: "S.L.", "SL", "S.A.", "SA" (y su variante unipersonal) una vez normalizada. */
const LEGAL_FORM_AT_END = /\s+S\s?[AL]\s?U?$/;
/** Cualquier forma societaria detrás del nombre en el texto normalizado: "S A", "SL", "S L U"... */
const LEGAL_FORM = String.raw`\s+S\s?[AL](?:\s?U)?`;

/**
 * Direcciones de correo y webs ("ana@foodbox.es", "www.foodbox.es", "https://foodbox.es/x"). Una vez
 * normalizado el texto se pierden la arroba y los puntos y "foodbox.es" quedaría como la palabra
 * FOODBOX: por eso se quitan antes de buscar la razón social.
 */
const ADDRESS_OR_WEB =
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,24}(?![\w-])(?:\/\S*)?/gi;

/** Texto sin direcciones de correo ni webs, donde una razón social sí cuenta. */
export function withoutAddresses(text: string): string {
  return text.replace(ADDRESS_OR_WEB, ' ');
}

/** Expresión que reconoce un CIF con o sin prefijo "ES" y con separadores opcionales. */
export function cifPattern(rawCif: string): RegExp | null {
  let cif = normalizeCif(rawCif);
  if (/^ES[A-Z0-9]{9}$/.test(cif)) cif = cif.slice(2);
  if (!/^[A-Z0-9]{9}$/.test(cif)) return null;
  const body = cif.split('').join(CIF_SEPARATOR);
  return new RegExp(`${BOUNDARY_BEFORE}(?:ES[\\s.\\-:]{0,3})?${body}${BOUNDARY_AFTER}`, 'i');
}

/**
 * Expresión para una razón social. Si el valor lleva forma societaria (S.L., SL, S.A., SA...), el
 * texto también tiene que llevar una, escrita de cualquier forma (regla del negocio, 2026-10-16):
 * el nombre suelto ("colaboración Fergofrio-Foodbox", "Factura Amazon Foodbox") se cita en correos
 * que no son de esa sociedad. El nombre va como palabra completa, así que "foodboxes SA" no cuenta.
 * Dentro de una dirección de correo o una web no cuenta: `evaluateRules` las quita antes
 * (`withoutAddresses`). La firma de un remitente del grupo no cuenta porque en ese caso solo se mira
 * en adjuntos y reenvíos (`evaluateRules`).
 */
export function razonSocialPattern(rawName: string): RegExp | null {
  const full = foldText(rawName);
  const name = full.replace(LEGAL_FORM_AT_END, '');
  if (!name) return null;
  const legalForm = name === full ? '' : LEGAL_FORM;
  return new RegExp(`${BOUNDARY_BEFORE}${wordsPattern(name)}${legalForm}${BOUNDARY_AFTER}`);
}

function keywordPattern(rawKeyword: string): RegExp | null {
  const folded = foldText(rawKeyword);
  return folded ? new RegExp(`${BOUNDARY_BEFORE}${wordsPattern(folded)}${BOUNDARY_AFTER}`) : null;
}

function senderDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : null;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

/**
 * Inicio de un mensaje reenviado o citado dentro del cuerpo: línea "Mensaje original", "Forwarded
 * message", cabecera "De:/From:" seguida de "Enviado/Fecha/Asunto…" o "El … escribió:".
 */
const FORWARDED_START = new RegExp(
  [
    String.raw`^[ \t>*_-]*-{2,}\s*(?:original message|mensaje original|forwarded message|mensaje reenviado)`,
    String.raw`^[ \t>*_-]*(?:de|from)[ \t]*:[^\n]*\n(?:[^\n]*\n){0,5}?[ \t>*_-]*(?:enviado(?: el)?|sent|fecha|date|asunto|subject)[ \t]*:`,
    String.raw`^[ \t>]*(?:el\s.{5,120}\sescribi[oó]|on\s.{5,120}\swrote)\s*:`,
  ].join('|'),
  'im',
);

/** Parte del cuerpo desde el primer mensaje reenviado o citado; vacía si no hay ninguno. */
export function forwardedBlock(body: string): string {
  const start = FORWARDED_START.exec(body)?.index;
  return start === undefined ? '' : body.slice(start);
}

/** ¿El remitente es de uno de los dominios del grupo (o de un subdominio)? */
export function isInternalSender(
  address: string | null | undefined,
  internalDomains: readonly string[],
): boolean {
  const domain = address ? senderDomain(address.trim().toLowerCase()) : null;
  if (!domain) return false;
  return internalDomains.some((d) => {
    const internal = d.trim().toLowerCase().replace(/^@/, '');
    return internal !== '' && (domain === internal || domain.endsWith(`.${internal}`));
  });
}

export interface EvaluateRulesOptions {
  /** Dominios del grupo. Sin ellos todos los remitentes se tratan como externos. */
  internalDomains?: readonly string[];
}

/**
 * Aplica las reglas activas a un correo y devuelve, por categoría, las coincidencias fuertes y
 * medias. Las palabras clave se buscan en asunto y cuerpo; remitente y dominio, en el remitente.
 * No decide nada: la combinación va en `classify`.
 *
 * CIF y razón social se buscan en asunto, cuerpo y adjuntos si el remitente es externo. Si es
 * interno, su pie de firma lleva el CIF y la razón social del propio grupo y no dice nada de la
 * sociedad facturada: solo cuentan los adjuntos y el bloque reenviado o citado del cuerpo.
 */
export function evaluateRules(
  email: ExtractedEmail,
  rules: readonly RuleRecord[],
  options: EvaluateRulesOptions = {},
): RuleEvidence {
  const evidence: RuleEvidence = {
    'FOOD BOX': { strong: [], medium: [] },
    LATERAL: { strong: [], medium: [] },
    ARCOBETA: { strong: [], medium: [] },
  };

  const subjectAndBody = `${email.subject}\n${email.bodyText}`;
  const attachmentsText = email.attachments.map((a) => a.markdown);
  const internal = isInternalSender(email.fromAddress, options.internalDomains ?? []);
  // Texto donde valen el CIF y la razón social (ver arriba).
  const fullText = (
    internal
      ? [forwardedBlock(email.bodyText), ...attachmentsText]
      : [subjectAndBody, ...attachmentsText]
  ).join('\n');
  const foldedSubjectAndBody = foldText(subjectAndBody);
  const foldedNames = foldText(withoutAddresses(fullText));
  const from = email.fromAddress?.trim().toLowerCase() ?? null;
  const fromDomain = from ? senderDomain(from) : null;

  for (const rule of rules) {
    if (!CATEGORY_SET.has(rule.category)) continue;
    const category = rule.category as Category;
    let description: string | null = null;

    switch (rule.type) {
      case 'cif': {
        const pattern = cifPattern(rule.value);
        // El CIF se busca sobre el texto original: normalizarlo antes uniría cifras de otros números.
        if (pattern?.test(fullText)) description = `CIF ${normalizeCif(rule.value)}`;
        break;
      }
      case 'razon_social': {
        if (razonSocialPattern(rule.value)?.test(foldedNames)) {
          description = `razón social «${rule.value}»`;
        }
        break;
      }
      case 'palabra_clave': {
        if (keywordPattern(rule.value)?.test(foldedSubjectAndBody)) {
          description = `palabra clave «${rule.value}»`;
        }
        break;
      }
      case 'remitente': {
        if (from && from === rule.value.trim().toLowerCase()) {
          description = `remitente ${from}`;
        }
        break;
      }
      case 'dominio': {
        const domain = rule.value.trim().toLowerCase().replace(/^@/, '');
        if (domain && fromDomain && (fromDomain === domain || fromDomain.endsWith(`.${domain}`))) {
          description = `dominio ${domain}`;
        }
        break;
      }
    }

    if (description) {
      const hits = rule.weight === 'fuerte' ? evidence[category].strong : evidence[category].medium;
      hits.push({ ruleId: rule.id, type: rule.type, description });
    }
  }
  return evidence;
}
