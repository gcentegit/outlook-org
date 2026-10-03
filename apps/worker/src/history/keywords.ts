import { foldText } from '../classify/rules';

/**
 * Palabras vacías del español (y prefijos de respuesta/reenvío) que no sirven como palabra clave.
 * Se comparan ya normalizadas (minúsculas, sin acentos).
 */
export const SPANISH_STOPWORDS: ReadonlySet<string> = new Set(
  `a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo cada casi como con contra cual cuales cuando de del desde donde dos e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estan estas este esto estos fue fueron ha han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros nuestra nuestro o os otra otras otro otros para pero poco por porque que quien quienes se sea segun ser si sin sobre su sus tambien tan te tiene todo todos tras tu tus un una unas uno unos usted ustedes va vamos vuestra vuestro y ya yo
re rv fw fwd enc`.split(/\s+/),
);

const MAX_NGRAM = 3;

/** Palabras del texto normalizadas (minúsculas, sin acentos ni signos). */
export function tokenize(text: string): string[] {
  const folded = foldText(text).toLowerCase();
  return folded ? folded.split(' ') : [];
}

const isUsefulWord = (word: string): boolean =>
  word.length >= 3 && !SPANISH_STOPWORDS.has(word) && !/^\d+$/.test(word);

/**
 * N-gramas (1-3 palabras contiguas) del asunto sin repetidos. Los extremos de un n-grama no pueden
 * ser palabras vacías ni números sueltos, pero el interior sí ("pedido de compra"): así el n-grama
 * sigue siendo una secuencia contigua del texto original, que es como la busca una regla.
 */
export function subjectNgrams(subject: string): Set<string> {
  const tokens = tokenize(subject);
  const out = new Set<string>();
  for (let start = 0; start < tokens.length; start++) {
    if (!isUsefulWord(tokens[start] as string)) continue;
    for (let n = 1; n <= MAX_NGRAM && start + n <= tokens.length; n++) {
      if (!isUsefulWord(tokens[start + n - 1] as string)) continue;
      out.add(tokens.slice(start, start + n).join(' '));
    }
  }
  return out;
}
