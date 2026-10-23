// Testes de ponta a ponta: o visitante vê o app com dados de exemplo,
// todas as telas renderizam sem erro, o login (cadastro + frase secreta)
// abre a conta, as alterações vão cifradas para a nuvem e nada fica no
// navegador. O Supabase é simulado (fake-supabase.js). As capturas ficam
// como anexos (e, com VISUAL=1, são comparadas com as de referência).
import { test, expect } from '@playwright/test';
import { createFakeSupabase } from './fake-supabase.js';

const ROUTES = ['painel', 'agenda', 'contas', 'carteira', 'salario', 'reservas', 'investimentos', 'planejamento', 'analise', 'ajustes', 'busca', 'importar'];
const TABS = {
  contas: ['recorrentes', 'parcelas', 'assinaturas', 'receber', 'dividas'],
  salario: ['plantoes', 'irpf', 'rescisao', 'beneficios', 'carreira', 'tabelas'],
  investimentos: ['proventos', 'comparar', 'ir', 'independencia', 'previdencia'],
  planejamento: ['fluxo', 'ano', 'comprar', 'envelopes', 'regra'],
  analise: ['comparar', 'historico', 'saude', 'retrospectiva'],
  ajustes: ['seguranca', 'nuvem', 'lembretes', 'categorias', 'credores', 'regras', 'dados', 'ajuda', 'contato', 'privacidade', 'novidades'],
};
const EMAIL = 'teste@exemplo.com';
const PASSWORD = 'senha-da-conta';
const PHRASE = 'minha frase secreta de teste';

/** Abre o app numa data fixa (visitante), com o Supabase simulado, coletando erros. */
async function openApp(page, { cloud = createFakeSupabase(), path = '/index.html#/painel' } = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) errors.push(msg.text()); });
  await cloud.attach(page);
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));
  await page.goto(path);
  await page.waitForSelector('#view .card, #view .dash-lead, .auth');
  return { errors, cloud };
}

const closeDialogs = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

/** Cria a conta pela tela de entrar: e-mail e senha → frase secreta. */
async function signUp(page) {
  if (!(await page.locator('.auth').count())) await page.locator('.guest-bar [data-action="auth:signup"]').click();
  const auth = page.locator('.auth');
  if (await auth.getByRole('tab', { name: 'Criar conta' }).getAttribute('aria-selected') !== 'true') await auth.getByRole('tab', { name: 'Criar conta' }).click();
  await auth.locator('input[name="email"]').fill(EMAIL);
  await auth.locator('input[name="password"]').fill(PASSWORD);
  await auth.locator('button[type="submit"]').click();
  await expect(auth.getByRole('heading', { name: 'Crie a sua frase secreta' })).toBeVisible();
  await auth.locator('input[name="pass"]').fill(PHRASE);
  await auth.locator('input[name="pass2"]').fill(PHRASE);
  await auth.locator('button[type="submit"]').click();
  await expect(page.locator('.auth')).toHaveCount(0, { timeout: 30_000 }); // a frase passa por 600 mil iterações (PBKDF2)
  await expect(page.locator('.guest-bar')).toHaveCount(0);
  await closeDialogs(page); // boas-vindas da conta nova
}

/** Entra numa conta existente: e-mail e senha → frase secreta. */
async function signIn(page) {
  const auth = page.locator('.auth');
  if (!(await auth.count())) await page.locator('.guest-bar [data-action="auth:open"]').click();
  await auth.locator('input[name="email"]').fill(EMAIL);
  await auth.locator('input[name="password"]').fill(PASSWORD);
  await auth.locator('button[type="submit"]').click();
  await expect(auth.getByRole('heading', { name: 'Digite a sua frase secreta' })).toBeVisible();
  await auth.locator('input[name="pass"]').fill(PHRASE);
  await auth.locator('button[type="submit"]').click();
  await expect(page.locator('.auth')).toHaveCount(0, { timeout: 30_000 }); // a frase passa por 600 mil iterações (PBKDF2)
}

/** Espera a nuvem ficar em dia (nada pendente). */
const synced = (page) => expect.poll(() => page.evaluate(() => import('./js/core/cloud.js').then(({ cloud }) => cloud.state.status === 'idle' && !cloud.unsent)), { timeout: 10_000 }).toBe(true);

test('visitante: todas as telas e abas abrem sem erros (dados de exemplo)', async ({ page }) => {
  test.slow(); // passa por mais de 50 telas e abas
  const { errors } = await openApp(page);
  await expect(page.locator('.guest-bar')).toContainText('Você está vendo um exemplo');
  for (const r of ROUTES) {
    for (const tab of [null, ...(TABS[r] || [])]) {
      await page.evaluate((h) => { location.hash = h; }, `#/${r}${tab ? `?aba=${tab}` : ''}`);
      await expect(page.locator('#view')).not.toBeEmpty();
    }
  }
  expect(errors).toEqual([]);
});

test('visitante: salvar qualquer coisa abre a tela de entrar; o tema muda sem login', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => import('./js/ui/editors.js').then((E) => E.editExpense()));
  const dlg = page.locator('dialog[open]');
  await dlg.locator('input[name="description"]').fill('Mercado');
  await dlg.locator('input[name="cents"]').fill('50,00');
  await dlg.locator('button[type="submit"]').click();
  await expect(page.locator('.auth')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('.auth [data-go="close"]').click();
  await expect(page.locator('.auth')).toHaveCount(0, { timeout: 30_000 }); // a frase passa por 600 mil iterações (PBKDF2)
  // aparência vale para o visitante (nada é salvo)
  await page.evaluate(() => { location.hash = '#/ajustes'; });
  await page.locator('[data-action="app:theme"][data-value="oled"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-oled', '');
  await page.keyboard.press('d');
  await expect(page.locator('html')).toHaveAttribute('data-discreet', '');
});

test('conta nova: dados cifrados na nuvem, nada no navegador, abre de novo e em outro aparelho', async ({ page, browser }) => {
  test.slow(); // criptografia de verdade (PBKDF2 com 600 mil iterações)
  const { errors, cloud } = await openApp(page);
  await signUp(page);
  // conta nova começa vazia: todas as telas abrem
  for (const r of ROUTES) {
    await page.evaluate((h) => { location.hash = h; }, `#/${r}`);
    await expect(page.locator('#view')).not.toBeEmpty();
  }
  // lançamento rápido pela paleta (Ctrl+K)
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox');
  await input.fill('mercado 154,90');
  await input.press('Enter');
  await page.evaluate(() => { location.hash = '#/contas'; });
  await expect(page.locator('.item__name', { hasText: 'Mercado' })).toBeVisible();
  await synced(page);

  // na nuvem: só envelopes cifrados
  const raw = JSON.stringify(cloud.db.tables);
  expect(cloud.db.tables.dhenors_state).toHaveLength(1);
  expect(cloud.db.tables.dhenors_chunks.length).toBeGreaterThan(0);
  expect(raw).not.toContain('Mercado');
  expect(raw).not.toContain('15490');

  // no navegador: só o login lembrado e preferências (sem dados, IndexedDB ou cache)
  const local = await page.evaluate(async () => ({
    keys: Object.keys(localStorage),
    values: Object.values(localStorage).join(' '),
    dbs: (await indexedDB.databases?.())?.map((d) => d.name) || [],
    caches: await caches.keys(),
  }));
  expect(local.keys.filter((k) => !/^dhenors:(auth|theme|theme-color|discreet|device-id|device-name)$/.test(k))).toEqual([]);
  expect(local.values).not.toContain('Mercado');
  expect(local.dbs).not.toContain('dhenors');
  expect(local.caches).toEqual([]);

  // reabrir: o login lembrado baixa os dados da nuvem
  await page.reload();
  await page.evaluate(() => { location.hash = '#/contas'; });
  await expect(page.locator('.item__name', { hasText: 'Mercado' })).toBeVisible();
  await expect(page.locator('.guest-bar')).toHaveCount(0);

  // outro aparelho: e-mail, senha e a mesma frase abrem os mesmos dados
  const other = await browser.newPage();
  await openApp(other, { cloud, path: '/index.html#/contas' });
  await signIn(other);
  await expect(other.locator('.item__name', { hasText: 'Mercado' })).toBeVisible();
  await other.close();

  // sair: os dados saem da memória e o app volta ao exemplo
  await page.evaluate(() => { location.hash = '#/ajustes?aba=nuvem'; });
  await page.locator('[data-action="cloud:logout"]').click();
  await page.locator('dialog[open] button[type="submit"]').click();
  await expect(page.locator('.guest-bar')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dhenors:auth'))).toBeNull();
  expect(errors).toEqual([]);
});

test('frase errada não abre; senha errada avisa', async ({ page, browser }) => {
  test.slow(); // criptografia de verdade (PBKDF2 com 600 mil iterações)
  const { cloud } = await openApp(page);
  await signUp(page);
  await synced(page);
  const other = await browser.newPage();
  await openApp(other, { cloud });
  await other.locator('.guest-bar [data-action="auth:open"]').click();
  const auth = other.locator('.auth');
  await auth.locator('input[name="email"]').fill(EMAIL);
  await auth.locator('input[name="password"]').fill('senha errada');
  await auth.locator('button[type="submit"]').click();
  await expect(auth.locator('.auth__error')).toContainText('E-mail ou senha incorretos');
  await auth.locator('input[name="password"]').fill(PASSWORD);
  await auth.locator('button[type="submit"]').click();
  await auth.locator('input[name="pass"]').fill('frase errada qualquer');
  await auth.locator('button[type="submit"]').click();
  await expect(auth.locator('.auth__error')).toContainText('Frase secreta incorreta');
  await other.close();
});

test('dados de uma versão anterior guardados no aparelho sobem no primeiro login e saem do navegador', async ({ page }) => {
  test.slow(); // criptografia de verdade (PBKDF2 com 600 mil iterações)
  const { cloud } = await openApp(page);
  // simula o IndexedDB da 3.4 com um estado do usuário
  await page.evaluate(async () => {
    const { createSampleState } = await import('./js/domain/sample.js');
    const st = createSampleState();
    st.settings.profileName = 'Dados antigos';
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('dhenors', 2);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('files'); };
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(st, 'state');
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });
  });
  await page.reload();
  // a tela de entrar abre sozinha, avisando dos dados do aparelho
  await expect(page.locator('.auth .auth__note')).toContainText('versão anterior');
  await signUp(page);
  await expect(page.locator('.topbar__hello')).toContainText('Dados antigos');
  await synced(page);
  expect(cloud.db.tables.dhenors_chunks.length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('dhenors');
});

test('fale conosco: valida, reclamação pede o detalhe, envia com anexo e confirma', async ({ page }) => {
  const { errors, cloud } = await openApp(page, { path: '/index.html#/ajustes?aba=contato' });
  const form = page.locator('form.feedback');
  await expect(form).toBeVisible();
  // tudo vazio: erros ao lado dos campos
  await form.locator('.feedback__submit').click();
  await expect(form.locator('[data-error-for="type"]')).toBeVisible();
  await expect(form.locator('[data-error-for="name"]')).toContainText('nome');
  await expect(form.locator('[data-error-for="email"]')).toBeVisible();
  // reclamação: aparece o campo do problema e o aviso de suporte
  await expect(form.locator('[name="details"]')).toBeHidden();
  await form.locator('.feedback__type--reclamacao').click();
  await expect(form.locator('[name="details"]')).toBeVisible();
  await expect(form.locator('.feedback__complaint .note')).toContainText('Vamos resolver');
  await expect(form.locator('[data-group="rating"]')).toBeHidden();
  await form.locator('[name="name"]').fill('Maria Souza');
  await form.locator('[name="email"]').fill('maria@exemplo');
  await form.locator('[name="area"]').selectOption('Conta / Perfil');
  await form.locator('[name="title"]').fill('Não consigo entrar');
  await form.locator('[name="message"]').fill('Depois de trocar de celular, a frase secreta não abre os dados.');
  await expect(form.locator('[data-count="message"]')).toContainText('/ 2000');
  await form.locator('.feedback__submit').click();
  await expect(form.locator('[data-error-for="email"]')).toContainText('E-mail inválido');
  await expect(form.locator('[data-error-for="details"]')).toBeVisible();
  await form.locator('[name="email"]').fill('maria@exemplo.com');
  await form.locator('[name="details"]').fill('1. Abri o app no celular novo 2. Digitei a frase 3. Apareceu "Frase secreta incorreta".');
  await form.locator('[name="file"]').setInputFiles({ name: 'tela.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await expect(form.locator('[data-file-name]')).toContainText('tela.png');
  await form.locator('.feedback__submit').click();
  await expect(page.locator('[data-done]')).toBeVisible();
  await expect(page.locator('[data-done-text]')).toContainText('maria@exemplo.com');
  expect(cloud.db.feedback).toHaveLength(1);
  const sent = cloud.db.feedback[0];
  expect(sent).toMatchObject({ name: 'Maria Souza', email: 'maria@exemplo.com', area: 'Conta / Perfil', type: 'reclamacao', title: 'Não consigo entrar' });
  expect(sent.details).toContain('Frase secreta incorreta');
  expect(sent.attachment).toMatchObject({ name: 'tela.png', type: 'image/png' });
  expect(sent.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
  // feedback: estrelas aparecem; enviar outra mantém nome e e-mail
  await page.locator('[data-again]').click();
  await form.locator('.feedback__type--feedback').click();
  await form.locator('.feedback__star').nth(3).click();
  await expect(form.locator('[data-rating-text]')).toContainText('4 de 5');
  await expect(form.locator('[name="email"]')).toHaveValue('maria@exemplo.com');
  expect(errors).toEqual([]);
});

test('pagar e desfazer uma conta', async ({ page }) => {
  test.slow(); // criptografia de verdade (PBKDF2 com 600 mil iterações)
  await openApp(page);
  await signUp(page);
  await page.evaluate(() => Promise.all([import('./js/core/store.js'), import('./js/domain/sample.js')]).then(([{ store }, { createSampleState }]) => store.replace(createSampleState())));
  await page.evaluate(() => { location.hash = '#/contas'; });
  const row = page.locator('.item:not(.item--paid)').first();
  const key = await row.getAttribute('data-key');
  await row.locator('.pay-btn').click();
  await expect(page.locator(`.item[data-key="${key}"]`)).toHaveClass(/item--paid/);
  await page.locator(`.item[data-key="${key}"] .pay-btn`).click();
  await expect(page.locator(`.item[data-key="${key}"]`)).not.toHaveClass(/item--paid/);
});

test('painel: saldo do mês e limite das parcelas no topo; seletor 10/20/30%', async ({ page }) => {
  const { errors } = await openApp(page);
  const keys = await page.locator('.dash-lead > *').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
  expect(keys.slice(0, 5)).toEqual(['balance', 'parcels', 'reserve', 'flow', 'summary']);
  const top = page.locator('[data-key="balance"]');
  await expect(top.locator('.summary__big')).toBeVisible();
  await expect(top.locator('.commit-ring')).toHaveAttribute('aria-label', /comprometidos/);
  const card = page.locator('[data-key="parcels"]');
  await expect(card.locator('.plimit__opt[aria-checked="true"]')).toHaveText('10%');
  await expect(card.locator('.pstatus__label')).toHaveText(/Dentro do limite|Na média|Acima do limite|Sem ganhos fixos/);
  await card.locator('.plimit__opt[data-pct="30"]').click();
  await expect(card.locator('.plimit__opt[aria-checked="true"]')).toHaveText('30%');
  await expect(page.locator('[data-key="flow"] .flow__col')).toHaveCount(3);
  const reserve = page.locator('[data-key="reserve"]');
  await expect(reserve.locator('.plimit__opt[aria-checked="true"]')).toHaveText('10%');
  await expect(reserve.locator('.pstatus__label')).toHaveText(/Dentro da reserva|Na média|Abaixo da reserva|Sem ganhos fixos/);
  await reserve.locator('.plimit__opt[data-pct="20"]').click();
  await expect(reserve.locator('.plimit__opt[aria-checked="true"]')).toHaveText('20%');
  expect(errors).toEqual([]);
});

test('painel: salário, ganhos e gastos; faixa dos 12 meses abre o porquê', async ({ page }) => {
  const { errors } = await openApp(page);
  const lead = page.locator('.dash-lead > [data-key="summary"]');
  await expect(lead).toBeVisible();
  await expect(lead.locator('.sfig')).toHaveCount(3);
  await expect(lead.getByText('Salário do mês')).toBeVisible();
  await expect(lead.getByText('Ganhos do mês')).toBeVisible();
  await expect(lead.getByText('Gasto no mês')).toBeVisible();
  // detalhe do salário: bruto, adições e descontos
  await lead.locator('.sfig__details summary').click();
  await expect(lead.locator('.sfig__lines')).toContainText('INSS');
  // faixa: 12 meses, cada um com situação por extenso para leitores de tela
  const cells = page.locator('[data-key="outlook"] .mstrip__cell');
  await expect(cells).toHaveCount(12);
  await expect(cells.first()).toHaveAttribute('aria-label', /(folgado|apertado|não fecha)/);
  await cells.nth(2).click();
  await expect(page.locator('dialog[open] .mdetail')).toContainText('O que pesa neste mês');
  expect(errors).toEqual([]);
});

test('editor de parcelamento: prévia ao vivo dos meses em que a parcela pesa', async ({ page }) => {
  const { errors } = await openApp(page);
  await page.evaluate(() => import('./js/ui/editors.js').then((E) => E.editInstallment()));
  const dlg = page.locator('dialog[open]');
  await dlg.locator('input[name="description"]').fill('TV');
  await dlg.locator('input[name="parcelCents"]').fill('2500,00');
  await dlg.locator('input[name="count"]').fill('10');
  const impact = dlg.locator('[data-impact] .impact');
  await expect(impact).toBeVisible();
  await expect(impact.locator('.impact__m')).toHaveCount(10);
  await expect(impact.locator('.impact__headline')).toContainText(/Com este parcelamento|Cabe/);
  // mudar o valor atualiza a prévia
  await dlg.locator('input[name="parcelCents"]').fill('10,00');
  await expect(impact.locator('.impact__headline')).toContainText('Cabe');
  expect(errors).toEqual([]);
});

test.describe('capturas de tela', () => {
  test('tela de entrar', async ({ page }, info) => {
    await openApp(page);
    await page.locator('.guest-bar [data-action="auth:open"]').click();
    await page.waitForTimeout(400);
    await info.attach('entrar.png', { body: await page.screenshot(), contentType: 'image/png' });
  });
  for (const r of ['painel', 'contas', 'salario', 'investimentos', 'analise']) {
    test(`tela ${r}`, async ({ page }, info) => {
      await openApp(page);
      await page.evaluate((h) => { location.hash = h; }, `#/${r}`);
      await page.waitForTimeout(400);
      await info.attach(`${r}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      if (process.env.VISUAL) await expect(page).toHaveScreenshot(`${r}.png`, { fullPage: true, mask: [page.locator('.topbar__hello')] });
    });
  }
});
