import { defineConfig, devices } from '@playwright/test';

// Puerto fijo del panel en desarrollo (el script `dev` de este paquete usa el mismo).
const PORT = 3110;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Las pruebas de navegador necesitan PostgreSQL con migraciones y semilla, y arrancan el panel en
// `next dev` con AUTH_DEV_BYPASS. Comando y variables: ver README.md, sección Comandos.
export default defineConfig({
  testDir: './e2e',
  // El primer render de `next dev` compila la página: el margen por prueba es amplio.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm run dev',
    url: BASE_URL,
    // Nunca se reutiliza un servidor que ya esté en el puerto: podría ser de otra sesión con otra
    // base de datos. Si el puerto está ocupado, la ejecución falla y hay que parar al dueño.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { AUTH_DEV_BYPASS: 'true' },
    timeout: 180_000,
  },
});
