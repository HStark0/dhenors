// Testes de ponta a ponta (navegador de verdade) com capturas de tela.
// Primeira vez: npx playwright install chromium
// Rodar: npm run e2e  ·  atualizar as capturas de referência: npm run e2e:update
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: {
    // 127.0.0.1: o servidor de desenvolvimento só escuta aí (e conta como origem segura)
    baseURL: 'http://127.0.0.1:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Bloqueado nos testes de telas (sem cache entre execuções); o projeto
    // 'offline' libera o service worker para testar o uso sem internet.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    // Para usar o Chrome já instalado em vez de baixar o Chromium: PW_CHANNEL=chrome
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    { name: 'desktop', testIgnore: /offline\.spec\.js$/, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'celular', testIgnore: /offline\.spec\.js$/, use: { ...devices['Pixel 7'] } },
    { name: 'offline', testMatch: /offline\.spec\.js$/, use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' } },
  ],
  webServer: {
    command: 'node tools/serve.mjs 5173',
    url: 'http://127.0.0.1:5173/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
