// =============================================================
// main.js — Ponto de entrada do app
// -------------------------------------------------------------
// 1. Carrega os dados salvos (store.init)
// 2. Monta a "casca" (menu, barra superior, navegação)
// 3. Roteia pelo #hash da URL (#/painel, #/contas, …)
// 4. Um ÚNICO listener de clique trata todos os botões com
//    data-action — nada de listeners duplicados a cada render.
// =============================================================

import { store } from './core/store.js';
import { requestPersistence } from './core/storage.js';
import { currentYM, addMonthsYM, addDaysISO, formatMonthTitle, todayISO, ymOf } from './core/dates.js';
import { toCents } from './core/money.js';
import { html, render, $, onAfterRender } from './ui/dom.js';
import { autoEnhance, enhanceWithin } from './ui/select.js';
import { icon, mountIconSprite } from './ui/icons.js';
import { toast, toastError } from './ui/toast.js';
import { openDialog, actionSheet } from './ui/dialog.js';
import { field, moneyField, numberField } from './ui/forms.js';
import { itemList, itemActions } from './ui/items.js';
import { openNewMenu } from './ui/editors.js';
import { exportBackup, importBackup } from './ui/backup.js';
import { openExportDialog } from './ui/exports.js';
import { openPalette } from './ui/palette.js';
import { initScrollHints } from './ui/scrollHint.js';
import { afterViewRender } from './ui/motion.js';
import { showLock, bindAutoLock } from './ui/lock.js';
import { runReminders } from './ui/notify.js';
import { cloud } from './core/cloud.js';
import { cloudButton, openCloud, newPasswordDialog } from './ui/cloudUI.js';
import * as E from './ui/editors.js';
import { computeMonth, overdueBefore } from './domain/ledger.js';
import * as A from './domain/actions.js';

import dashboard from './views/dashboard.js';
import salary from './views/salary.js';
import bills from './views/bills.js';
import recurring from './views/recurring.js';
import installments from './views/installments.js';
import goals from './views/goals.js';
import investments from './views/investments.js';
import * as IE from './ui/investEditors.js';
import creditors from './views/creditors.js';
import categories from './views/categories.js';
import analysis from './views/analysis.js';
import history from './views/history.js';
import settings from './views/settings.js';
import agenda from './views/agenda.js';
import simulator from './views/simulator.js';
import importer, { bindDrop, pickFile } from './views/importer.js';

// ---------- Rotas e navegação ----------

const VIEWS = [dashboard, agenda, salary, bills, recurring, installments, goals, investments, simulator, creditors, categories, importer, analysis, history, settings];
const ROUTES = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

/** Menu lateral, em seções. */
const NAV_SECTIONS = [
  { title: 'Visão geral', items: [
    { id: 'painel', label: 'Painel', icon: 'layout-dashboard' },
    { id: 'agenda', label: 'Agenda', icon: 'calendar-days' },
    { id: 'analise', label: 'Análise', icon: 'chart-line' },
  ] },
  { title: 'Dinheiro', items: [
    { id: 'salario', label: 'Salário', icon: 'banknote' },
    { id: 'contas', label: 'Contas', icon: 'receipt' },
    { id: 'recorrentes', label: 'Recorrentes', icon: 'repeat' },
    { id: 'parcelas', label: 'Parcelamentos', icon: 'credit-card' },
  ] },
  { title: 'Planejamento', items: [
    { id: 'metas', label: 'Metas', icon: 'target' },
    { id: 'investimentos', label: 'Investimentos', icon: 'coins' },
    { id: 'categorias', label: 'Categorias', icon: 'tags' },
    { id: 'simulador', label: 'Simulador', icon: 'wand-sparkles' },
  ] },
  { title: 'Organização', items: [
    { id: 'importar', label: 'Importar extrato', icon: 'file-up' },
    { id: 'credores', label: 'Credores', icon: 'handshake' },
    { id: 'historico', label: 'Histórico', icon: 'history' },
    { id: 'ajustes', label: 'Ajustes', icon: 'settings' },
  ] },
];
const NAV = NAV_SECTIONS.flatMap((s) => s.items);
/** Barra inferior do celular: 4 atalhos + botão central "Novo". */
const TABBAR = ['painel', 'contas', 'analise'];

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[id] ? id : 'painel';
}

// ---------- Ações globais (data-action) ----------

const ACTIONS = {
  ...itemActions,
  ...Object.assign({}, ...VIEWS.map((v) => v.actions || {})),

  'new:menu': () => openNewMenu(),
  'month:prev': () => store.setUI({ ym: addMonthsYM(store.ui.ym, -1) }),
  'month:next': () => store.setUI({ ym: addMonthsYM(store.ui.ym, 1) }),
  'month:today': () => store.setUI({ ym: currentYM() }),
  'theme:set': (el) => { A.setTheme(el.dataset.theme); },
  'theme:toggle': () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    A.setTheme(dark ? 'light' : 'dark');
  },
  'alerts:open': () => openAlerts(),
  'cloud:open': () => openCloud(),
  'cloud:sync': async () => { await cloud.syncNow(); toast(cloud.state.status === 'idle' ? 'Sincronizado.' : cloud.state.error || 'Sem conexão agora; os dados estão salvos no aparelho.', { type: cloud.state.status === 'idle' ? 'success' : 'info' }); },
  'nav:more': () => actionSheet({
    title: 'Mais',
    actions: NAV.filter((n) => !TABBAR.includes(n.id)).map((n) => ({
      label: n.label, icon: n.icon, run: () => { location.hash = `#/${n.id}`; },
    })),
  }),
  'backup:export': () => exportBackup(),
  'backup:import': () => importBackup(),
  'export:open': (el) => openExportDialog(el.dataset.kind || 'summary'),
  'palette:open': () => palette(),
  'lock:now': () => showLock('relock'),
  'import:pick': () => pickFile(),
};

/** Busca rápida (Ctrl+K): telas, ações, lançamentos e lançamento em linguagem natural. */
function palette() {
  openPalette({
    nav: NAV,
    commands: [
      { label: 'Nova conta a pagar', icon: 'receipt', run: () => E.editExpense() },
      { label: 'Registrar gasto pago', icon: 'circle-check', run: () => E.editExpense(null, { paid: true }) },
      { label: 'Nova despesa recorrente', icon: 'repeat', run: () => E.editRecurring() },
      { label: 'Novo parcelamento', icon: 'credit-card', run: () => E.editInstallment() },
      { label: 'Lançar renda extra / plantão', icon: 'stethoscope', run: () => E.editExtraIncome() },
      { label: 'Aporte em investimento', icon: 'coins', run: () => IE.quickMovement('aporte') },
      { label: 'Novo investimento', icon: 'landmark', run: () => IE.editInvestment() },
      { label: 'Importar extrato do banco', icon: 'file-up', run: () => pickFile() },
      { label: 'Baixar dados (planilhas, holerite)', icon: 'download', run: () => openExportDialog('summary') },
      { label: 'Fazer backup', icon: 'shield-check', run: () => exportBackup() },
      { label: 'Alternar tema claro/escuro', icon: 'moon', run: () => ACTIONS['theme:toggle']() },
      ...(store.pinEnabled ? [{ label: 'Bloquear agora', icon: 'lock-keyhole', run: () => showLock('relock') }] : []),
    ],
    openEditor: (kind, x) => {
      if (kind === 'expense') E.editExpense(x);
      if (kind === 'recurring') E.editRecurring(x);
      if (kind === 'installment') E.installmentDetails(x.id);
      if (kind === 'goal') E.editGoal(x);
      if (kind === 'investment') IE.investmentHistory(x);
    },
  });
}

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const handler = ACTIONS[el.dataset.action];
    if (!handler) return console.warn('Ação sem handler:', el.dataset.action);
    ev.preventDefault();
    run(() => handler(el, ev));
  });

  // Filtros (busca, selects) das telas
  const onFilter = (ev) => {
    const el = ev.target.closest('[data-filter]');
    if (!el || el.tagName === 'BUTTON') return;
    ROUTES[currentRoute()].onFilter?.(el.dataset.filter, el.value, el);
  };
  document.addEventListener('input', onFilter);
  document.addEventListener('change', (ev) => { if (ev.target.tagName === 'SELECT') onFilter(ev); });

  // Atalhos: N = novo lançamento · Ctrl/⌘+K ou "/" = busca rápida
  document.addEventListener('keydown', (ev) => {
    if (document.body.classList.contains('is-locked')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target.closest('input, textarea, select, [contenteditable], dialog')) return;
    if (ev.key === 'n') { ev.preventDefault(); openNewMenu(); }
    if (ev.key === '/') { ev.preventDefault(); palette(); }
  });
  document.addEventListener('dhenors:palette', () => palette());
  // Barra do topo: transparente no início, "vidro" ao rolar
  const onScroll = () => document.body.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  bindDrop();
  bindAutoLock();

  window.addEventListener('hashchange', () => renderAll({ routeChanged: true }));

  // Redesenha os gráficos quando a largura muda bastante (girar o celular, redimensionar)
  let lastWidth = innerWidth;
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(innerWidth - lastWidth) > 80) { lastWidth = innerWidth; renderAll(); }
    }, 200);
  });
  document.addEventListener('dhenors:save-error', () => toastError('Não foi possível salvar no navegador. Verifique o espaço do aparelho e faça um backup.'));

  // Atualiza "hoje" quando o app volta do segundo plano em outro dia
  let lastDay = todayISO();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayISO() !== lastDay) {
      if (ymOf(lastDay) === store.ui.ym) store.ui.ym = currentYM();
      lastDay = todayISO();
      renderAll();
    }
    if (document.visibilityState === 'visible' && store.data) runReminders();
  });
}

/** Executa uma ação mostrando erros de validação como aviso. */
async function run(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof A.ValidationError) toastError(err.message);
    else { console.error(err); toastError('Algo deu errado. Tente novamente.'); }
  }
}

// ---------- Tema ----------

function applyTheme() {
  const theme = store.data.settings.theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#060A14' : '#F4F6FB');
  try { localStorage.setItem('dhenors:theme', theme); } catch { /* sem acesso */ }
}

// ---------- Renderização ----------

function renderShell(routeId) {
  const view = ROUTES[routeId];
  const ym = store.ui.ym;
  const isCurrent = ym === currentYM();
  const alerts = alertItems();
  const dark = document.documentElement.dataset.theme === 'dark';

  render($('#sidebar-nav'), html`
    <button type="button" class="nav-search" data-action="palette:open">
      ${icon('search')}<span>Buscar ou lançar…</span><kbd>Ctrl K</kbd>
    </button>
    ${NAV_SECTIONS.map((sec) => html`
      <p class="nav-section">${sec.title}</p>
      ${sec.items.map((n) => html`
        <a class="nav-link" href="#/${n.id}" ${routeId === n.id ? html`aria-current="page"` : ''}>
          ${icon(n.icon)}<span>${n.label}</span>
        </a>`)}`)}`);

  render($('#tabbar'), html`
    ${TABBAR.slice(0, 2).map((id) => tab(id, routeId))}
    <button type="button" class="tabbar__new" data-action="new:menu" aria-label="Novo lançamento">${icon('plus')}</button>
    ${tab(TABBAR[2], routeId)}
    <button type="button" class="tabbar__item ${TABBAR.includes(routeId) ? '' : 'is-active'}" data-action="nav:more">
      ${icon('menu')}<span>Mais</span>
    </button>`);

  render($('#topbar'), html`
    <div class="topbar__title">
      <h1 class="page-title">${view.title}</h1>
      ${store.data.settings.profileName && routeId === 'painel' ? html`<p class="muted small">Olá, ${store.data.settings.profileName}!</p>` : ''}
    </div>
    ${view.monthNav ? html`
      <div class="month-nav" role="group" aria-label="Mês exibido">
        <button type="button" class="icon-btn" data-action="month:prev" aria-label="Mês anterior">${icon('chevron-left')}</button>
        <span class="month-nav__label" aria-live="polite">${formatMonthTitle(ym)}${store.data.closedMonths[ym] ? html` ${icon('lock', 'icon--xs')}<span class="sr-only">(fechado)</span>` : ''}</span>
        <button type="button" class="icon-btn" data-action="month:next" aria-label="Próximo mês">${icon('chevron-right')}</button>
        ${isCurrent ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-action="month:today">Hoje</button>`}
      </div>` : ''}
    <div class="topbar__actions">
      <button type="button" class="icon-btn topbar__search" data-action="palette:open" aria-label="Buscar ou lançar (Ctrl+K)">${icon('search')}</button>
      <button type="button" class="btn btn--primary topbar__new" data-action="new:menu" title="Atalho: tecla N">${icon('plus')} Novo</button>
      ${cloudButton()}
      <button type="button" class="icon-btn bell" data-action="alerts:open" aria-label="Alertas: ${alerts.length}">
        ${icon('bell')}${alerts.length ? html`<span class="bell__count" aria-hidden="true">${alerts.length > 9 ? '9+' : alerts.length}</span>` : ''}
      </button>
      <button type="button" class="icon-btn" data-action="theme:toggle" aria-label="${dark ? 'Usar tema claro' : 'Usar tema escuro'}">${icon(dark ? 'sun' : 'moon')}</button>
      ${store.pinEnabled ? html`<button type="button" class="icon-btn" data-action="lock:now" aria-label="Bloquear agora">${icon('lock-keyhole')}</button>` : ''}
    </div>`);
}

function tab(id, routeId) {
  const n = NAV.find((x) => x.id === id);
  return html`
    <a class="tabbar__item ${routeId === id ? 'is-active' : ''}" href="#/${id}" ${routeId === id ? html`aria-current="page"` : ''}>
      ${icon(n.icon)}<span>${n.label}</span>
    </a>`;
}

let lastRendered = '';

function renderAll({ routeChanged = false } = {}) {
  const routeId = currentRoute();
  const view = ROUTES[routeId];
  document.title = `${view.title} · Dhenors`;
  renderShell(routeId);
  try {
    render($('#view'), view.render());
  } catch (err) {
    console.error(err);
    render($('#view'), html`<div class="card empty"><p><strong>Erro ao exibir esta tela.</strong></p><p class="muted">${err.message}</p></div>`);
  }
  // Entrada animada só ao trocar de tela, abrir o app ou mudar de mês
  const entering = routeChanged || !lastRendered || lastRendered !== `${routeId}|${store.ui.ym}`;
  lastRendered = `${routeId}|${store.ui.ym}`;
  afterViewRender($('#view'), routeId, { entering });
  if (routeChanged) {
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
  }
}

// ---------- Alertas (sino) ----------

/** Contas atrasadas, vencendo hoje ou amanhã (mês atual + atrasadas antigas). */
function alertItems() {
  const ym = currentYM();
  const today = todayISO();
  const now = computeMonth(store.data, ym, today).items
    .filter((i) => i.status === 'overdue' || i.status === 'today' || (i.status === 'soon' && i.dueDate <= addDaysISO(today, 1)));
  return [...overdueBefore(store.data, ym, today), ...now];
}


function openAlerts() {
  const list = alertItems();
  openDialog({
    title: 'Alertas',
    body: list.length
      ? html`<p class="dialog__text muted">Contas atrasadas ou vencendo até amanhã.</p>${itemList(list, { showMonth: true })}`
      : html`<div class="empty empty--sm">${icon('circle-check', 'icon--lg pos')}<p><strong>Nada urgente.</strong></p><p class="muted">Nenhuma conta atrasada ou vencendo hoje/amanhã.</p></div>`,
  });
}

// ---------- Primeiro acesso ----------

function onboarding() {
  openDialog({
    title: 'Bem-vindo ao Dhenors 👋',
    submitLabel: 'Começar',
    body: html`
      <p class="dialog__text">Seu controle financeiro, direto no navegador. Funciona <strong>sem cadastro</strong>, salvando neste aparelho; para usar em qualquer lugar, ligue a nuvem depois em Ajustes.</p>
      <div class="form-grid">
        ${field({ label: 'Como quer ser chamado?', name: 'profileName', full: true, extra: { maxlength: 60, autocomplete: 'given-name' } })}
        ${moneyField({ label: 'Salário base bruto', name: 'salary', required: false, hint: 'O app calcula INSS e IR. Adicionais e descontos em folha você ajusta depois, na tela Salário.' })}
        ${numberField({ label: 'Dia do pagamento', name: 'salaryDay', value: 5, min: 1, max: 31, hint: 'Recebe no 5º dia útil? Escolha depois em Salário → Editar.' })}
        ${numberField({ label: 'Dependentes (IR)', name: 'dependents', value: 0, min: 0, max: 20 })}
      </div>`,
    footer: html`<button type="button" class="btn btn--ghost" data-action="cloud:open" data-close>${icon('cloud-download')} Já uso em outro aparelho</button>
      <button type="button" class="btn btn--ghost" data-action="backup:import" data-close>${icon('upload')} Restaurar backup</button>`,
    onSubmit: (form) => {
      const salary = form.salary.value.trim() ? toCents(form.salary.value) : 0;
      A.completeOnboarding({ profileName: form.profileName.value, salaryCents: salary, salaryDay: Number(form.salaryDay.value), dependents: Number(form.dependents.value || 0) });
      requestPersistence();
      toast('Tudo pronto! Use o botão "Novo" para lançar suas contas.');
    },
  }).dialog.addEventListener('close', () => {
    if (!store.data.onboarded) A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 });
  });
}

// ---------- Inicialização ----------

async function start() {
  // Volta de um link de e-mail do Supabase (#access_token=…&type=… ou #error=…):
  // confirmação de cadastro ou "Esqueci minha senha"
  let recovery = null;
  if (/access_token=|error_description=/.test(location.hash)) {
    const p = new URLSearchParams(location.hash.slice(1));
    // window.history: "history" aqui é a tela Histórico (import acima)
    window.history.replaceState(null, '', `${location.pathname}#/ajustes`);
    if (p.get('type') === 'recovery' && p.get('access_token')) {
      recovery = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') };
    } else {
      const ok = p.has('access_token');
      const msg = ok ? 'E-mail confirmado! Agora entre na nuvem com seu e-mail e senha.'
        : p.get('error_code') === 'otp_expired' ? 'O link do e-mail expirou ou já foi usado. Peça outro (em "Entrar na nuvem").'
        : `Não foi possível usar o link do e-mail: ${p.get('error_description') || 'erro desconhecido'}.`;
      setTimeout(() => toast(msg, { type: ok ? 'success' : 'error', duration: 9000 }), 800);
    }
  }
  mountIconSprite();
  onAfterRender(enhanceWithin); // caixas de opções estilizadas (selects e sugestões)
  autoEnhance(document.body);
  await store.init();
  // Dados criptografados por PIN: pede o PIN antes de tudo
  if (store.locked) {
    document.body.classList.remove('is-loading');
    await showLock('unlock');
  }
  applyTheme();
  bindEvents();
  initScrollHints();

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  let frame = 0;
  store.subscribe((reason) => {
    if (reason === 'silent') return;
    applyTheme();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => renderAll());
  });

  renderAll();
  document.body.classList.remove('is-loading');
  if (!store.data.onboarded) onboarding();
  runReminders();

  // Nuvem: status no topo e avisos
  cloud.onChange(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => renderAll()); });
  document.addEventListener('dhenors:cloud-notice', (ev) => toast(ev.detail, { type: 'info', duration: 9000 }));
  cloud.init().catch((err) => console.warn('[nuvem]', err));
  if (recovery) setTimeout(() => newPasswordDialog(recovery), 400);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker não registrado', err));
  }
}

start().catch((err) => {
  console.error(err);
  document.getElementById('view').innerHTML =
    '<div class="card empty"><p><strong>Não foi possível iniciar o app.</strong></p><p class="muted">Seu navegador pode estar bloqueando o armazenamento local (modo anônimo?).</p></div>';
  document.body.classList.remove('is-loading');
});
