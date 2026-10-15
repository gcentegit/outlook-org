import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Páginas de lectura del panel con la semilla. Las que escriben (categorías, configuración) quedan
// fuera de la prueba de humo.
const PAGES = [
  { path: '/', heading: 'Resumen' },
  { path: '/correos', heading: 'Correos' },
  { path: '/reglas', heading: 'Reglas' },
  { path: '/modelos', heading: 'Modelos' },
] as const;

test.describe('panel con AUTH_DEV_BYPASS', () => {
  for (const { path, heading } of PAGES) {
    test(`${path} carga, muestra el aviso de desarrollo y la navegación`, async ({ page }) => {
      await page.goto(path);

      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText('Modo desarrollo sin login')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    });

    test(`${path} no tiene infracciones WCAG 2.0 A y AA`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }
});
