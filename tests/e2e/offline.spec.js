// Uso sem internet com o service worker LIGADO (projeto "offline" do
// playwright.config.js). Os outros testes bloqueiam o service worker.
import { test, expect } from '@playwright/test';

/** Espera o service worker ativo e a página controlada por ele. */
async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  // Sem clients.claim(): a 1ª visita não é controlada; a 2ª já é.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
}

test('abre sem internet depois da primeira visita', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/index.html#/painel');
  await page.waitForSelector('#view');
  await waitForServiceWorker(page);

  await context.setOffline(true);
  try {
    await page.goto('/index.html#/contas');
    await expect(page.locator('#view')).not.toBeEmpty();
    // A raiz do escopo e endereços com "?" também abrem o app
    await page.goto('/?origem=atalho#/painel');
    await expect(page.locator('#view')).not.toBeEmpty();
  } finally {
    await context.setOffline(false);
  }
  expect(errors).toEqual([]);
});

test('a primeira visita não recarrega a página sozinha', async ({ page }) => {
  await page.goto('/index.html#/painel');
  await page.waitForSelector('#view');
  await page.evaluate(() => { window.__marca = 1; });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__marca)).toBe(1);
});

test('páginas fora do app não abrem o app (landing)', async ({ page }) => {
  await page.goto('/index.html#/painel');
  await page.waitForSelector('#view');
  await waitForServiceWorker(page);
  const landing = await page.goto('/landing.html');
  expect(landing?.status()).toBe(200);
  expect(await page.locator('#view').count()).toBe(0);
});
