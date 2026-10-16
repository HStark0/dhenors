// Testes de ponta a ponta: o app abre, todas as telas renderizam sem
// erro, o lançamento rápido funciona e as capturas ficam como anexos
// (e, com VISUAL=1, são comparadas com as de referência).
import { test, expect } from '@playwright/test';

const ROUTES = ['painel', 'agenda', 'contas', 'carteira', 'salario', 'metas', 'investimentos', 'planejamento', 'analise', 'ajustes', 'busca', 'importar', 'recebidos'];
const TABS = {
  contas: ['recorrentes', 'parcelas', 'assinaturas', 'receber', 'dividas'],
  salario: ['plantoes', 'irpf', 'rescisao', 'beneficios', 'carreira', 'tabelas'],
  investimentos: ['proventos', 'comparar', 'ir', 'independencia', 'previdencia'],
  planejamento: ['fluxo', 'ano', 'comprar', 'envelopes', 'regra'],
  analise: ['comparar', 'historico', 'saude', 'retrospectiva'],
  ajustes: ['seguranca', 'nuvem', 'lembretes', 'categorias', 'credores', 'regras', 'dados', 'ajuda', 'privacidade', 'novidades'],
};

/** Abre o app numa data fixa, sem diálogos de boas-vindas, coletando erros. */
async function openApp(page, { demo = false } = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) errors.push(msg.text()); });
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));
  await page.goto('/index.html#/painel');
  await page.waitForSelector('#view');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  if (demo) {
    await page.evaluate(() => import('./js/ui/onboarding.js').then((m) => m.startDemo({ confirm: false })));
    await page.waitForSelector('.demo-bar');
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  return errors;
}

test('todas as telas e abas abrem sem erros (vazio)', async ({ page }) => {
  const errors = await openApp(page);
  for (const r of ROUTES) {
    await page.evaluate((h) => { location.hash = h; }, `#/${r}`);
    await expect(page.locator('#view')).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});

test('todas as telas e abas abrem sem erros (dados de exemplo)', async ({ page }) => {
  const errors = await openApp(page, { demo: true });
  for (const r of ROUTES) {
    for (const tab of [null, ...(TABS[r] || [])]) {
      await page.evaluate((h) => { location.hash = h; }, `#/${r}${tab ? `?aba=${tab}` : ''}`);
      await expect(page.locator('#view')).not.toBeEmpty();
    }
  }
  expect(errors).toEqual([]);
});

test('lançamento rápido pela paleta (Ctrl+K)', async ({ page }) => {
  const errors = await openApp(page);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox');
  await input.fill('mercado 154,90');
  await input.press('Enter');
  await page.evaluate(() => { location.hash = '#/contas'; });
  await expect(page.locator('.item__name', { hasText: 'Mercado' })).toBeVisible();
  await expect(page.locator('.item__value', { hasText: '154,90' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('pagar e desfazer uma conta', async ({ page }) => {
  await openApp(page, { demo: true });
  await page.evaluate(() => { location.hash = '#/contas'; });
  const row = page.locator('.item:not(.item--paid)').first();
  const key = await row.getAttribute('data-key');
  await row.locator('.pay-btn').click();
  await expect(page.locator(`.item[data-key="${key}"]`)).toHaveClass(/item--paid/);
  await page.locator(`.item[data-key="${key}"] .pay-btn`).click();
  await expect(page.locator(`.item[data-key="${key}"]`)).not.toHaveClass(/item--paid/);
});

test('tema escuro, OLED e modo discreto', async ({ page }) => {
  await openApp(page, { demo: true });
  await page.evaluate(() => { location.hash = '#/ajustes'; });
  await page.locator('[data-action="app:theme"][data-value="oled"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-oled', '');
  await page.keyboard.press('d');
  await expect(page.locator('html')).toHaveAttribute('data-discreet', '');
});

test.describe('capturas de tela', () => {
  for (const r of ['painel', 'contas', 'salario', 'investimentos', 'analise']) {
    test(`tela ${r}`, async ({ page }, info) => {
      await openApp(page, { demo: true });
      await page.evaluate((h) => { location.hash = h; }, `#/${r}`);
      await page.waitForTimeout(400);
      await info.attach(`${r}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      if (process.env.VISUAL) await expect(page).toHaveScreenshot(`${r}.png`, { fullPage: true, mask: [page.locator('.topbar__hello')] });
    });
  }
});
