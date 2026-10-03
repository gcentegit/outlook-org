import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Con el renderizado parcial de Next.js una petición RSC puede pedir solo el segmento de la página
 * sin pasar por el layout: la comprobación de acceso tiene que estar en CADA página del panel y en
 * cada route handler (salvo la comprobación de salud y el login), no solo en el layout.
 */

const appDir = join(import.meta.dirname);

function files(dir: string, name: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, name);
    return name.test(entry.name) ? [path] : [];
  });
}

const rel = (path: string): string => relative(appDir, path).split('\\').join('/');

describe('comprobación de acceso en cada página y route handler', () => {
  const pages = files(join(appDir, '(panel)'), /^page\.tsx$/);

  it('hay páginas en el panel (la prueba no es vacía)', () => {
    expect(pages.map(rel).sort()).toEqual([
      '(panel)/categorias/page.tsx',
      '(panel)/configuracion/page.tsx',
      '(panel)/discrepancias/page.tsx',
      '(panel)/modelos/page.tsx',
      '(panel)/page.tsx',
    ]);
  });

  it.each(pages.map(rel))('%s llama a requireUser antes de leer datos', (page) => {
    const source = readFileSync(join(appDir, page), 'utf8');
    const body = source.slice(source.indexOf('export default async function'));
    const guard = body.indexOf('await requireUser()');
    expect(guard, `${page} no llama a requireUser`).toBeGreaterThan(-1);
    // Ninguna lectura de datos ni lectura de parámetros antes de la comprobación.
    const firstData = body.search(
      /\b(prisma\(\)|get[A-Z]\w*\(|list[A-Z]\w*\(|read[A-Z]\w*\(|parseFilter\()/,
    );
    if (firstData !== -1) expect(guard).toBeLessThan(firstData);
  });

  it('el layout también comprueba el acceso (la barra de navegación enseña el email)', () => {
    expect(readFileSync(join(appDir, '(panel)/layout.tsx'), 'utf8')).toContain(
      'await requireUser()',
    );
  });

  it('las acciones del servidor llaman a requireUser en cada función exportada', () => {
    for (const file of files(join(appDir, '(panel)'), /^actions\.ts$/)) {
      const source = readFileSync(file, 'utf8');
      const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(exported.length).toBeGreaterThan(0);
      for (const name of exported) {
        const start = source.indexOf(`export async function ${name}`);
        const next = source.indexOf('export async function', start + 1);
        const body = source.slice(start, next === -1 ? undefined : next);
        expect(body, `${rel(file)}: ${name} no llama a requireUser`).toContain(
          'await requireUser()',
        );
      }
    }
  });

  it('los únicos route handlers son la comprobación de salud y el login de better-auth', () => {
    const routes = files(join(appDir, 'api'), /^route\.ts$/)
      .map(rel)
      .sort();
    expect(routes).toEqual(['api/auth/[...all]/route.ts', 'api/health/route.ts']);
  });
});
