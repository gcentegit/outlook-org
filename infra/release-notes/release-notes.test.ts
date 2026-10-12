import { describe, expect, it } from 'vitest';
import { checkPullRequest, enrichRelease, extractNotes, footer, parseTitle } from './release-notes.ts';

const SHA = 'e70c0119915b8f1ab16bedaab24ad77fd8380455';
const RELEASE = `## [0.3.0](https://github.com/o/r/compare/v0.2.0...v0.3.0) (2026-10-12)


### 🚀 Novedades

* **web:** 🔔 aviso de reproceso ([e70c011](https://github.com/o/r/commit/${SHA}))
`;

const PR_BODY = `## Qué cambia

Texto técnico que no va a las notas.

## Para las notas de la release

<!-- Guía de la plantilla: no debe salir en las notas. -->
- 🔢 El aviso dice **cuántos correos** quedan. Antes solo decía que había alguno.
- 🧭 Agrupa por causa:
  - con qué hacer en cada una.
Texto suelto que no es un punto.

## Cómo se ha probado

- Pruebas en verde.

BEGIN_COMMIT_OVERRIDE
feat(web): 🔔 aviso
END_COMMIT_OVERRIDE`;

describe('parseTitle', () => {
  it('separa tipo y descripción, con ámbito y con !', () => {
    expect(parseTitle('fix(web): 🔐 llevar el oid')).toEqual({ type: 'fix', subject: '🔐 llevar el oid' });
    expect(parseTitle('feat!: 💥 cambio')).toEqual({ type: 'feat', subject: '💥 cambio' });
    expect(parseTitle('sin formato')).toBeNull();
  });
});

describe('extractNotes', () => {
  it('toma solo los puntos de la sección, con sus líneas sangradas, sin comentarios ni texto suelto', () => {
    expect(extractNotes(PR_BODY)).toEqual([
      '- 🔢 El aviso dice **cuántos correos** quedan. Antes solo decía que había alguno.',
      '- 🧭 Agrupa por causa:',
      '  - con qué hacer en cada una.',
    ]);
  });

  it('normaliza `*` a `-`, acepta CRLF y termina en el bloque de override', () => {
    const body = '## Para las notas de la release\r\n* 🐛 Un fallo.\r\nBEGIN_COMMIT_OVERRIDE\r\n- no';
    expect(extractNotes(body)).toEqual(['- 🐛 Un fallo.']);
  });

  it('sin sección, nada', () => {
    expect(extractNotes('## Qué cambia\n\n- algo')).toEqual([]);
  });
});

describe('checkPullRequest', () => {
  it('acepta un PR con icono y notas', () => {
    expect(checkPullRequest('feat(web): 🔔 aviso', PR_BODY)).toEqual([]);
  });

  it('exige el icono del título y la sección en los tipos que salen en las notas', () => {
    const errors = checkPullRequest('fix(web): llevar el oid', '## Qué cambia\n\nAlgo.');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/icono/);
    expect(errors[1]).toMatch(/Para las notas de la release/);
  });

  it('exige un icono al principio de cada punto de primer nivel', () => {
    const errors = checkPullRequest('perf: ⚡ rápido', '## Para las notas de la release\n\n- Sin icono\n  - sangrado sin icono');
    expect(errors).toEqual([expect.stringContaining('"- Sin icono"')]);
  });

  it('no pide nada a los tipos que no salen en las notas ni a títulos sin formato', () => {
    expect(checkPullRequest('chore(deps): bump x', '')).toEqual([]);
    expect(checkPullRequest('build(deps): bump x', '')).toEqual([]);
    expect(checkPullRequest('sin formato', '')).toEqual([]);
  });
});

describe('footer', () => {
  it('enlaza la comparación y el CHANGELOG de la versión', () => {
    expect(footer(RELEASE, 'o/r', 'v0.3.0')).toBe(
      '---\n**Cambios:** [`v0.2.0...v0.3.0`](https://github.com/o/r/compare/v0.2.0...v0.3.0) · ' +
        '**Changelog:** [`CHANGELOG.md`](https://github.com/o/r/blob/v0.3.0/CHANGELOG.md)',
    );
  });

  it('la primera versión no tiene comparación', () => {
    expect(footer('## 0.1.0 (2026-10-03)\n', 'o/r', 'v0.1.0')).toBe(
      '---\n**Changelog:** [`CHANGELOG.md`](https://github.com/o/r/blob/v0.1.0/CHANGELOG.md)',
    );
  });
});

describe('enrichRelease', () => {
  const notes = extractNotes(PR_BODY);
  const foot = footer(RELEASE, 'o/r', 'v0.3.0');

  it('pone los puntos del PR sangrados debajo de su línea y añade el pie', () => {
    const enriched = enrichRelease(RELEASE, (sha) => (sha === SHA ? notes : undefined), foot);
    expect(enriched).toContain(
      `([e70c011](https://github.com/o/r/commit/${SHA}))\n` +
        '  - 🔢 El aviso dice **cuántos correos** quedan. Antes solo decía que había alguno.\n' +
        '  - 🧭 Agrupa por causa:\n' +
        '    - con qué hacer en cada una.\n',
    );
    expect(enriched.endsWith(`\n\n${foot}\n`)).toBe(true);
  });

  it('se puede repetir sin duplicar nada', () => {
    const once = enrichRelease(RELEASE, () => notes, foot);
    expect(enrichRelease(once, () => notes, foot)).toBe(once);
  });

  it('una línea sin notas se queda como está', () => {
    expect(enrichRelease(RELEASE, () => undefined, foot)).toBe(`${RELEASE.trimEnd()}\n\n${foot}\n`);
  });
});
