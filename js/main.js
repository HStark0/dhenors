// =============================================================
// main.js — Ponto de entrada do app
// -------------------------------------------------------------
// 1. Abre como visitante (dados de exemplo). Com o login lembrado,
//    baixa os dados da nuvem (nada fica salvo no navegador).
// 2. Monta a "casca" (menu, barra superior, barra inferior)
// 3. Roteia pelo #hash da URL (#/painel, #/contas?aba=recorrentes…)
// 4. Um ÚNICO listener de clique trata todos os botões com
//    data-action — nada de listeners duplicados a cada render.
// =============================================================

import { store, GuestError } from './core/store.js';
import { readAuth } from './core/storage.js';
import { readLegacy, purgeCaches } from './core/legacy.js';
import { applyAppearance, isDiscreet, setDiscreet, resolveTheme } from './core/theme.js';
import { currentYM, addMonthsYM, addDaysISO, formatMonthTitle, formatMonthShort, todayISO, ymOf } from './core/dates.js';
import { html, render, $, onAfterRender } from './ui/dom.js';
import { autoEnhance, enhanceWithin } from './ui/select.js';
import { icon, mountIconSprite } from './ui/icons.js';
import { toast, toastError } from './ui/toast.js';
import { openDialog, actionSheet } from './ui/dialog.js';
import { itemList, itemActions } from './ui/items.js';
import { exportBackup, importBackup } from './ui/backup.js';
import { openExportDialog } from './ui/exports.js';
import { openPalette } from './ui/palette.js';
import { initScrollHints } from './ui/scrollHint.js';
import { initDiscreet, DISCREET_VALUES } from './ui/discreet.js';
import { initChartTips, fitCharts } from './ui/charts.js';
import { fitValues } from './ui/fit.js';
import { mountFeedback } from './ui/feedback.js';
import { afterViewRender } from './ui/motion.js';
import { syncIndicators } from './ui/indicator.js';
import { runReminders } from './ui/notify.js';
import { initSwipe, initListKeys, initPullToRefresh } from './ui/gestures.js';
import { initInstall, initServiceWorker, initViewport, canInstall, installApp, onInstallChange } from './ui/pwa.js';
import { onboardingWizard } from './ui/onboarding.js';
import { openAuth, settle, authActions, authOpen } from './ui/auth.js';
import { helpActions } from './ui/help.js';
import { outlookActions } from './ui/outlookUI.js';
import { singleKeyShortcuts } from './ui/prefs.js';
import { cloud } from './core/cloud.js';
import { initErrorLog, logError } from './core/errors.js';
import { fetchRates, ratesStale } from './core/market.js';
import { cloudButton, openCloud, cloudActions, statusText } from './ui/cloudUI.js';
import * as E from './ui/editors.js';
import * as IE from './ui/investEditors.js';
import { computeMonth, overdueBefore } from './domain/ledger.js';
import * as A from './domain/actions.js';
import { APP_VERSION } from './version.js';
import { CHANGELOG, newerThan } from './changelog.js';

import dashboard from './views/dashboard.js';
import salary from './views/salary.js';
import bills from './views/bills.js';
import wallet from './views/wallet.js';
import goals from './views/goals.js';
import investments from './views/investments.js';
import planning from './views/planning.js';
import analysis from './views/analysis.js';
import settings from './views/settings.js';
import agenda from './views/agenda.js';
import search from './views/search.js';
import importer, { bindDrop, pickFile } from './views/importer.js';

// ---------- Rotas e navegação ----------

const VIEWS = [dashboard, agenda, bills, wallet, salary, goals, investments, planning, analysis, settings, search, importer];
const ROUTES = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

/** Endereços antigos (e atalhos) que viraram abas de outras telas. */
const ALIASES = {
  recorrentes: 'contas?aba=recorrentes', parcelas: 'contas?aba=parcelas', assinaturas: 'contas?aba=assinaturas',
  credores: 'ajustes?aba=credores', categorias: 'ajustes?aba=categorias', historico: 'analise?aba=historico',
  simulador: 'planejamento?aba=simulador', plantoes: 'salario?aba=plantoes', cartoes: 'carteira?aba=cartoes',
};

/**
 * Menu (10 telas). Antes eram 15: Contas, Recorrentes e Parcelamentos
 * viraram abas de "Contas"; Credores e Categorias foram para Ajustes;
 * Histórico virou aba da Análise; Simulador, do Planejamento.
 */
const NAV_SECTIONS = [
  { title: 'Visão geral', items: [
    { id: 'painel', label: 'Painel', icon: 'layout-dashboard' },
    { id: 'agenda', label: 'Agenda', icon: 'calendar-days' },
    { id: 'analise', label: 'Análise', icon: 'chart-line' },
  ] },
  { title: 'Dinheiro', items: [
    { id: 'contas', label: 'Contas a pagar', icon: 'receipt' },
    { id: 'carteira', label: 'Cartões e contas bancárias', icon: 'wallet-cards' },
    { id: 'salario', label: 'Salário', icon: 'banknote' },
  ] },
  { title: 'Futuro', items: [
    { id: 'metas', label: 'Metas', icon: 'target' },
    { id: 'investimentos', label: 'Investimentos', icon: 'coins' },
    { id: 'planejamento', label: 'Planejamento', icon: 'wand-sparkles' },
  ] },
];
const SETTINGS_NAV = { id: 'ajustes', label: 'Ajustes', icon: 'settings' };
const NAV = [...NAV_SECTIONS.flatMap((s) => s.items), SETTINGS_NAV, { id: 'busca', label: 'Busca', icon: 'search' }, { id: 'importar', label: 'Importar extrato', icon: 'file-up' }];

/** Endereço antigo → novo, mantendo os parâmetros (ex.: #/plantoes?novo=1 → #/salario?aba=plantoes&novo=1). */
function withAliasQuery(id) {
  const extra = location.hash.split('?')[1];
  return `#/${ALIASES[id]}${extra ? `${ALIASES[id].includes('?') ? '&' : '?'}${extra}` : ''}`;
}

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[id] ? id : 'painel';
}

/** Barra inferior do celular: 3 atalhos configuráveis + "Novo" + "Mais" (padrão: Painel, Agenda, Contas). */
const tabbarIds = () => (store.data.settings.tabbar || ['painel', 'agenda', 'contas']).filter((id) => NAV.some((n) => n.id === id)).slice(0, 3);

// ---------- Ações globais (data-action) ----------

/**
 * Junta os mapas de ações. Dois módulos com a MESMA ação faziam um apagar
 * o outro em silêncio (ex.: "Nova assinatura" abria "Nova subcategoria"):
 * agora isso aparece no console durante o desenvolvimento.
 */
function joinActions(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [name, fn] of Object.entries(map || {})) {
      if (name in out) console.warn(`[ações] "${name}" definida em dois lugares; vale a última.`);
      out[name] = fn;
    }
  }
  return out;
}

const ACTIONS = {
  ...joinActions(itemActions, helpActions, outlookActions, cloudActions, authActions, ...VIEWS.map((v) => v.actions)),

  'new:menu': () => (store.guest ? openAuth('signin') : E.openNewMenu()),
  'month:prev': () => store.setUI({ ym: addMonthsYM(store.ui.ym, -1) }),
  'month:next': () => store.setUI({ ym: addMonthsYM(store.ui.ym, 1) }),
  'month:today': () => store.setUI({ ym: currentYM() }),
  'theme:toggle': () => {
    const mode = resolveTheme(store.data.settings.theme);
    A.setTheme(mode === 'light' ? (store.data.settings.theme === 'oled' ? 'oled' : 'dark') : 'light');
  },
  'discreet:toggle': () => {
    setDiscreet(!isDiscreet());
    toast(isDiscreet() ? 'Modo discreto ligado: os valores ficam escondidos (toque num valor para ver).' : 'Valores visíveis.', { type: 'info' });
    renderAll();
  },
  'alerts:open': () => openAlerts(),
  'cloud:open': () => openCloud(),
  'cloud:sync': async () => { await cloud.syncNow(); toast(cloud.state.status === 'idle' ? 'Sincronizado.' : cloud.state.error || 'Sem conexão agora; as alterações sobem quando a internet voltar (não feche o app).', { type: cloud.state.status === 'idle' ? 'success' : 'info' }); },
  'nav:more': () => actionSheet({
    title: 'Mais',
    actions: NAV.filter((n) => !tabbarIds().includes(n.id) && n.id !== 'busca').map((n) => ({
      label: n.label, icon: n.icon, run: () => { location.hash = `#/${n.id}`; },
    })),
  }),
  'top:menu': () => topMenu(),
  'backup:export': () => exportBackup(),
  'backup:import': () => importBackup(),
  'export:open': (el) => openExportDialog(el.dataset.kind || 'summary'),
  'palette:open': () => palette(),
  'install:app': () => installApp(),
  'onb:bills': () => E.editRecurring(),
  'onb:card': () => E.editCard(),
  'onb:goal': () => E.editGoal(),
  'onb:wizard': () => onboardingWizard(),
  'undo:last': () => { try { const l = store.undo(); if (l) toast(`Desfeito: ${l}.`, { type: 'info' }); } catch (err) { toastError(err.message); } },
};

/** Busca rápida (Ctrl+K): telas, ações, lançamentos e lançamento em linguagem natural. */
function palette({ voice = false } = {}) {
  openPalette({
    voice,
    nav: NAV,
    commands: [
      { label: 'Registrar gasto pago', icon: 'circle-check', run: () => E.editExpense(null, { paid: true }) },
      { label: 'Nova conta a pagar', icon: 'receipt', run: () => E.editExpense() },
      { label: 'Compra no cartão', icon: 'credit-card', run: () => E.editPurchase() },
      { label: 'Nova despesa recorrente', icon: 'repeat', run: () => E.editRecurring() },
      { label: 'Novo parcelamento (carnê, empréstimo)', icon: 'calendar-range', run: () => E.editInstallment() },
      { label: 'Lançar receita / plantão', icon: 'stethoscope', run: () => E.editExtraIncome() },
      { label: 'Transferência entre contas bancárias', icon: 'arrow-left-right', run: () => E.transferDialog() },
      { label: 'Alguém me deve', icon: 'hand-coins', run: () => E.editReceivable() },
      { label: 'Aporte em investimento', icon: 'coins', run: () => IE.quickMovement('aporte') },
      { label: 'Novo investimento', icon: 'landmark', run: () => IE.editInvestment() },
      { label: 'Posso comprar?', icon: 'calculator', run: () => { location.hash = '#/planejamento?aba=comprar'; } },
      { label: 'Importar extrato ou fatura', icon: 'file-up', run: () => pickFile() },
      { label: 'Baixar dados (planilhas, holerite, relatório)', icon: 'download', run: () => openExportDialog('summary') },
      { label: 'Fazer backup', icon: 'shield-check', run: () => exportBackup() },
      { label: 'Alternar tema claro/escuro', icon: 'moon', run: () => ACTIONS['theme:toggle']() },
      { label: 'Fale conosco: feedback, sugestão ou reclamação', icon: 'mail', run: () => { location.hash = '#/ajustes?aba=contato'; } },
      { label: isDiscreet() ? 'Mostrar valores' : 'Modo discreto (esconder valores)', icon: isDiscreet() ? 'eye' : 'eye-off', run: () => ACTIONS['discreet:toggle']() },
      ...(store.undoable ? [{ label: `Desfazer: ${store.undoable.label}`, icon: 'undo-2', run: () => ACTIONS['undo:last']() }] : []),
    ],
    openEditor: (kind, x) => {
      if (kind === 'expense') E.editExpense(x);
      if (kind === 'recurring') E.editRecurring(x);
      if (kind === 'installment') E.installmentDetails(x.id);
      if (kind === 'purchase') E.editPurchase(x);
      if (kind === 'goal') E.editGoal(x);
      if (kind === 'investment') IE.investmentHistory(x);
    },
  });
}

/** Menu do topo no celular: busca, alertas, conta, tema, modo discreto, instalar. */
function topMenu() {
  const alerts = alertItems().length;
  const st = cloud.state;
  actionSheet({
    title: store.data.settings.profileName ? `Olá, ${store.data.settings.profileName}` : 'Menu',
    actions: [
      { label: 'Buscar ou lançar', hint: 'Também por voz', icon: 'search', run: () => palette() },
      { label: alerts ? `Alertas (${alerts})` : 'Alertas', hint: alerts ? 'Contas atrasadas ou vencendo' : 'Nada urgente', icon: 'bell', run: () => openAlerts() },
      store.guest
        ? { label: 'Entrar', hint: 'Use o app com os seus dados', icon: 'log-in', run: () => openAuth('signin') }
        : { label: 'Nuvem', hint: statusText(st), icon: 'cloud', run: () => openCloud() },
      { label: resolveTheme(store.data.settings.theme) === 'light' ? 'Tema escuro' : 'Tema claro', icon: resolveTheme(store.data.settings.theme) === 'light' ? 'moon' : 'sun', run: () => ACTIONS['theme:toggle']() },
      { label: isDiscreet() ? 'Mostrar valores' : 'Esconder valores (modo discreto)', icon: isDiscreet() ? 'eye' : 'eye-off', run: () => ACTIONS['discreet:toggle']() },
      ...(canInstall() ? [{ label: 'Instalar o app', icon: 'smartphone', run: () => installApp() }] : []),
      { label: 'Fale conosco', hint: 'Feedback, sugestão ou reclamação', icon: 'mail', run: () => { location.hash = '#/ajustes?aba=contato'; } },
      { label: 'Ajustes', icon: 'settings', run: () => { location.hash = '#/ajustes'; } },
    ],
  });
}

function dispatch(name, el = null, ev = null) {
  const handler = ACTIONS[name];
  if (!handler) { console.warn('Ação sem handler:', name); return; }
  run(() => handler(el || document.createElement('span'), ev));
}

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    // Links com data-action continuam navegando se não houver ação (ex.: #/salario)
    if (!ACTIONS[el.dataset.action]) return console.warn('Ação sem handler:', el.dataset.action);
    // Caixa de seleção/rádio: deixa o navegador marcar (cancelar desfazia a marca
    // na tela, e o redesenho não corrige o campo que está com o foco)
    if (!el.matches('input[type="checkbox"], input[type="radio"]')) ev.preventDefault();
    run(() => ACTIONS[el.dataset.action](el, ev));
  });
  // Elementos de gráfico (role=button) e linhas: Enter/Espaço também disparam
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-action][role="button"]:not(button)')) {
      ev.preventDefault();
      ev.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  document.addEventListener('dhenors:action', (ev) => dispatch(ev.detail));
  // "Pular para o conteúdo": só move o foco (o #main mudaria a rota para o Painel)
  document.querySelector('.skip-link')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    $('#main')?.focus();
  });

  // Filtros (busca, selects) das telas
  const onFilter = (ev) => {
    const el = ev.target.closest('[data-filter]');
    if (!el || el.tagName === 'BUTTON') return;
    ROUTES[currentRoute()].onFilter?.(el.dataset.filter, el.value, el);
  };
  document.addEventListener('input', (ev) => { if (ev.target.type !== 'checkbox') onFilter(ev); });
  document.addEventListener('change', (ev) => { if (ev.target.tagName === 'SELECT' || ev.target.type === 'checkbox' || ev.target.type === 'date' || ev.target.type === 'month') onFilter(ev); });

  // Atalhos: N = novo · Ctrl/⌘+K ou "/" = busca · Ctrl+Z = desfazer · D = modo discreto
  document.addEventListener('keydown', (ev) => {
    if (document.body.classList.contains('has-auth')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette(); return; }
    if (ev.target.closest('input, textarea, select, [contenteditable], dialog')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && store.undoable) { ev.preventDefault(); dispatch('undo:last'); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!singleKeyShortcuts()) return; // desligados em Ajustes → Geral → Aparência
    if (ev.key === 'n') { ev.preventDefault(); dispatch('new:menu'); }
    if (ev.key === '/') { ev.preventDefault(); palette(); }
    if (ev.key === 'd') { ev.preventDefault(); dispatch('discreet:toggle'); }
  });
  document.addEventListener('dhenors:palette', () => palette());
  // Modo discreto: tocar num valor mostra só ele por 3 s
  document.addEventListener('click', (ev) => {
    if (!isDiscreet()) return;
    const money = ev.target.closest(DISCREET_VALUES);
    if (!money || ev.target.closest('[data-action]')) return;
    money.classList.add('is-peek');
    setTimeout(() => money.classList.remove('is-peek'), 3000);
  });
  // Barra do topo: transparente no início, "vidro" ao rolar
  const onScroll = () => document.body.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  bindDrop();

  window.addEventListener('hashchange', () => {
    const id = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (ALIASES[id]) { location.replace(withAliasQuery(id)); return; }
    // Só a aba (ou outro parâmetro) mudou, na mesma tela: não rola para o
    // topo nem tira o foco da lista de abas (setas ← → do teclado)
    const sameRoute = lastRendered.split('|')[0] === currentRoute();
    const onTabs = document.activeElement?.closest?.('[data-tabs]');
    renderAll({ routeChanged: !sameRoute });
    if (sameRoute && onTabs) {
      const tabEl = $('#view [data-tabs] [aria-selected="true"]');
      tabEl?.focus({ preventScroll: true });
      tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // abas que rolam de lado
    }
    handleRouteParams();
  });

  // Redesenha os gráficos quando a largura muda bastante (girar o celular, redimensionar)
  let lastWidth = innerWidth;
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(innerWidth - lastWidth) > 80) { lastWidth = innerWidth; renderAll(); }
    }, 200);
  });
  // Tentou salvar sem login: abre a tela de entrar
  document.addEventListener('dhenors:need-login', () => { if (!authOpen()) openAuth(cloud.user ? 'passphrase' : 'signin'); });

  // Atualiza "hoje" quando o app volta do segundo plano em outro dia
  let lastDay = todayISO();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayISO() !== lastDay) {
      if (ymOf(lastDay) === store.ui.ym) store.ui.ym = currentYM();
      lastDay = todayISO();
      renderAll();
      dailyChores();
    }
    if (document.visibilityState === 'visible' && !store.guest) runReminders();
  });
}

/** Executa uma ação mostrando erros de validação como aviso. */
async function run(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof GuestError) return; // a tela de entrar já abriu
    if (err instanceof A.ValidationError) toastError(err.message);
    else { console.error(err); logError(err, 'ação'); toastError('Algo deu errado. Tente novamente.'); }
  }
}

// ---------- Tema ----------

function applyTheme() {
  applyAppearance(store.data.settings);
  document.documentElement.toggleAttribute('data-discreet', isDiscreet());
}

// ---------- Renderização ----------

function avatar() {
  const name = store.data.settings.profileName || '';
  return html`<span class="avatar avatar--sm" aria-hidden="true">${(name.trim()[0] || 'D').toUpperCase()}</span>`;
}

function renderShell(routeId) {
  const view = ROUTES[routeId];
  const ym = store.ui.ym;
  const isCurrent = ym === currentYM();
  const alerts = alertItems();
  const light = resolveTheme(store.data.settings.theme) === 'light';
  const tabs = tabbarIds();

  render($('#sidebar-nav'), html`
    <button type="button" class="nav-search" data-action="palette:open">
      ${icon('search')}<span>Buscar ou lançar…</span><kbd>Ctrl K</kbd>
    </button>
    ${NAV_SECTIONS.map((sec) => html`
      <p class="nav-section">${sec.title}</p>
      ${sec.items.map((n) => navLink(n, routeId))}`)}
    <p class="nav-section">Ajustes</p>
    ${navLink(SETTINGS_NAV, location.hash.includes('aba=contato') ? '' : routeId)}
    <a class="nav-link" href="#/ajustes?aba=contato" ${routeId === 'ajustes' && location.hash.includes('aba=contato') ? html`aria-current="page"` : ''}>${icon('mail')}<span>Fale conosco</span></a>
    ${canInstall() ? html`<button type="button" class="nav-link nav-link--install" data-action="install:app">${icon('smartphone')}<span>Instalar o app</span></button>` : ''}`);

  // Rodapé fixo do menu: status da nuvem, versão e avatar
  render($('#sidebar-foot'), html`
    ${cloudButton({ compact: true })}
    <a class="sidebar__me" href="#/ajustes">
      ${avatar()}
      <span><strong>${store.data.settings.profileName || 'Seu perfil'}</strong><small>Dhenors ${APP_VERSION}</small></span>
      ${icon('settings', 'icon--xs')}
    </a>`);

  render($('#tabbar'), html`
    ${tabs.slice(0, 2).map((id) => tab(id, routeId))}
    <button type="button" class="tabbar__new" data-action="new:menu" aria-label="Novo lançamento">${icon('plus')}</button>
    ${tabs[2] ? tab(tabs[2], routeId) : ''}
    <button type="button" class="tabbar__item ${tabs.includes(routeId) ? '' : 'is-active'}" data-action="nav:more">
      ${icon('menu')}<span>Mais</span>
    </button>`);

  const short = view.shortTitle || view.title;
  render($('#topbar'), html`
    ${store.guest ? html`<div class="demo-bar guest-bar" role="note">${icon('eye', 'icon--xs')}<span>Você está vendo um exemplo. Entre para usar com os seus dados.</span>
      <span class="guest-bar__actions"><button type="button" class="btn btn--primary btn--sm" data-action="auth:open">Entrar</button><button type="button" class="btn btn--ghost btn--sm" data-action="auth:signup">Criar conta</button></span></div>` : ''}
    <div class="topbar__title">
      <h1 class="page-title"><span class="page-title__full">${view.title}</span><span class="page-title__short">${short}</span></h1>
      ${store.data.settings.profileName && routeId === 'painel' ? html`<p class="muted small topbar__hello">Olá, ${store.data.settings.profileName}!</p>` : ''}
    </div>
    ${view.monthNav ? html`
      <div class="month-nav" role="group" aria-label="Mês exibido">
        <button type="button" class="icon-btn" data-action="month:prev" aria-label="Mês anterior">${icon('chevron-left')}</button>
        <span class="month-nav__label" aria-live="polite"><span class="month-nav__long">${formatMonthTitle(ym)}</span><span class="month-nav__short">${formatMonthShort(ym)}</span>${store.data.closedMonths[ym] ? html` ${icon('lock', 'icon--xs')}<span class="sr-only">(fechado)</span>` : ''}</span>
        <button type="button" class="icon-btn" data-action="month:next" aria-label="Próximo mês">${icon('chevron-right')}</button>
        ${isCurrent ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-action="month:today">Hoje</button>`}
      </div>` : ''}
    <div class="topbar__actions">
      <button type="button" class="icon-btn topbar__desk" data-action="palette:open" aria-label="Buscar ou lançar (Ctrl+K)" title="Buscar ou lançar (Ctrl+K)">${icon('search')}</button>
      <button type="button" class="btn btn--primary topbar__new" data-action="new:menu" title="Atalho: tecla N">${icon('plus')} Novo</button>
      ${store.guest ? "" : html`<span class="topbar__desk">${cloudButton()}</span>`}
      <button type="button" class="icon-btn bell topbar__desk" data-action="alerts:open" aria-label="Alertas: ${alerts.length}">
        ${icon('bell')}${alerts.length ? html`<span class="bell__count" aria-hidden="true">${alerts.length > 9 ? '9+' : alerts.length}</span>` : ''}
      </button>
      <button type="button" class="icon-btn topbar__desk" data-action="discreet:toggle" aria-pressed="${isDiscreet()}" aria-label="${isDiscreet() ? 'Mostrar valores' : 'Esconder valores (modo discreto)'}" title="Modo discreto (tecla D)">${icon(isDiscreet() ? 'eye-off' : 'eye')}</button>
      <button type="button" class="icon-btn topbar__desk" data-action="theme:toggle" aria-label="${light ? 'Usar tema escuro' : 'Usar tema claro'}">${icon(light ? 'moon' : 'sun')}</button>
      <button type="button" class="topbar__me topbar__mobile" data-action="top:menu" aria-label="Menu: busca, alertas${alerts.length ? ` (${alerts.length})` : ''}, nuvem e tema">
        ${avatar()}${alerts.length ? html`<span class="bell__count" aria-hidden="true">${alerts.length > 9 ? '9+' : alerts.length}</span>` : ''}
        <span class="topbar__me-cloud topbar__me-cloud--${cloud.state.status}" aria-hidden="true"></span>
      </button>
    </div>`);
}

function navLink(n, routeId) {
  return html`
    <a class="nav-link" href="#/${n.id}" ${routeId === n.id ? html`aria-current="page"` : ''}>
      ${icon(n.icon)}<span>${n.label}</span>
    </a>`;
}

function tab(id, routeId) {
  const n = NAV.find((x) => x.id === id);
  return html`
    <a class="tabbar__item ${routeId === id ? 'is-active' : ''}" href="#/${id}" ${routeId === id ? html`aria-current="page"` : ''}>
      ${icon(n.icon)}<span>${n.label.split(' ')[0]}</span>
    </a>`;
}

let lastRendered = '';

function renderAll({ routeChanged = false } = {}) {
  const routeId = currentRoute();
  const view = ROUTES[routeId];
  document.title = `${view.title} · Dhenors`;
  renderShell(routeId);
  const tabKey = new URLSearchParams(location.hash.split('?')[1] || '').get('aba') || '';
  try {
    render($('#view'), view.render());
  } catch (err) {
    console.error(err);
    logError(err, `render ${routeId}`);
    render($('#view'), html`<div class="card empty"><p><strong>Erro ao exibir esta tela.</strong></p><p class="muted">${err.message}</p><p class="small muted">O erro foi guardado em Ajustes → Dados → Registro de erros.</p></div>`);
  }
  // Entrada animada só ao trocar de tela/aba, abrir o app ou mudar de mês
  const sig = `${routeId}|${tabKey}|${store.ui.ym}`;
  const entering = routeChanged || !lastRendered || lastRendered !== sig;
  // Só a aba mudou (mesma tela e mês): transição curta só no conteúdo
  const [lastRoute, lastTab, lastYM] = lastRendered.split('|');
  const tabOnly = entering && !routeChanged && lastRoute === routeId && lastYM === store.ui.ym && lastTab !== tabKey;
  // Só o mês mudou (setas do topo): o conteúdo desliza para o lado, sem a cascata de tela nova
  const monthOnly = entering && !routeChanged && lastRoute === routeId && lastTab === tabKey && lastYM !== store.ui.ym;
  lastRendered = sig;
  const moved = syncIndicators($('#view'), { animate: !routeChanged });
  const dir = tabOnly ? moved.tabs : monthOnly ? (store.ui.ym > lastYM ? 1 : -1) : 0;
  afterViewRender($('#view'), routeId, { entering, tabOnly: tabOnly || monthOnly, dir });
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

// ---------- Novidades ----------

function whatsNew(force = false) {
  const last = store.data.settings.lastSeenVersion;
  if (!force && (!last || !newerThan(APP_VERSION, last))) {
    if (!last) A.markVersionSeen(APP_VERSION);
    return;
  }
  // no máximo as 3 últimas versões; o resto fica em Ajustes → Novidades
  const items = CHANGELOG.filter((c) => force ? c.version === APP_VERSION : newerThan(c.version, last)).slice(0, 3);
  A.markVersionSeen(APP_VERSION);
  if (!items.length) return;
  openDialog({
    title: `Novidades do Dhenors ${APP_VERSION}`,
    size: 'md',
    body: html`${items.map((c) => html`
      ${c.groups.map((g) => html`
        <h3 class="dialog__subtitle">${g.title}</h3>
        <ul class="tips">${g.items.map((t) => html`<li>${t}</li>`)}</ul>`)}`)}
      <p class="field__hint"><a href="#/ajustes?aba=novidades">Ver todas as versões</a></p>`,
  });
}

// ---------- Parâmetros de rota (atalhos do ícone, compartilhar) ----------

function handleRouteParams() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const novo = params.get('novo');
  if (!novo) return;
  const clean = () => history.replaceState(null, '', location.hash.replace(/([?&])novo=[^&]*&?/, '$1').replace(/[?&]$/, ''));
  setTimeout(() => {
    if (novo === 'gasto') E.editExpense(null, { paid: true });
    else if (novo === 'conta') E.editExpense();
    else if (novo === 'cartao') E.editPurchase();
    clean();
  }, 300);
}

// ---------- Tarefas do dia (ao abrir e ao virar o dia) ----------

async function dailyChores() {
  if (store.guest) return;
  // Reajuste automático das recorrentes no mês do aniversário
  try {
    const changes = A.applyReadjustments(todayISO());
    for (const c of changes) toast(`${c.description} reajustada: ${(c.from / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} → ${(c.to / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${(c.pctBp / 100).toLocaleString('pt-BR')}%).`, { type: 'info', duration: 9000 });
  } catch (err) { logError(err, 'reajuste'); }
  // CDI/Selic/IPCA/IGP-M do Banco Central, uma vez por semana (só se você usa investimentos ou reajustes)
  const d = store.data;
  const needs = (d.investments || []).length || d.recurring.some((r) => r.adjust);
  if (needs && navigator.onLine && ratesStale(d.settings.indices?.updatedAt)) {
    try { A.applyMarketRates(await fetchRates()); } catch { /* sem internet ou API fora: tenta outro dia */ }
  }
}

// ---------- Inicialização ----------

/** A conta abriu (login): boas-vindas, novidades, lembretes e tarefas do dia. */
function onAccountOpen() {
  store.ui.ym = currentYM();
  if (!store.data.onboarded) onboardingWizard();
  else whatsNew();
  handleRouteParams();
  runReminders();
  dailyChores();
}

async function start() {
  initErrorLog();
  // O antigo modo offline guardava o app no cache do navegador: sai tudo
  purgeCaches();
  // Volta de um link de e-mail do Supabase (#access_token=…&type=… ou #error=…):
  // confirmação de cadastro ou "Esqueci minha senha"
  let recovery = null;
  let emailNotice = null;
  if (/access_token=|error_description=/.test(location.hash)) {
    const p = new URLSearchParams(location.hash.slice(1));
    window.history.replaceState(null, '', `${location.pathname}#/painel`);
    if (p.get('type') === 'recovery' && p.get('access_token')) {
      recovery = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') };
    } else {
      const ok = p.has('access_token');
      emailNotice = { ok, text: ok ? 'E-mail confirmado! Agora entre com o seu e-mail e senha.'
        : p.get('error_code') === 'otp_expired' ? 'O link do e-mail expirou ou já foi usado. Peça outro na tela de entrar.'
        : `Não foi possível usar o link do e-mail: ${p.get('error_description') || 'erro desconhecido'}.` };
    }
  }
  const aliasId = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (ALIASES[aliasId]) window.history.replaceState(null, '', `${location.pathname}${withAliasQuery(aliasId)}`);

  mountIconSprite();
  onAfterRender((root) => { mountFeedback(root); enhanceWithin(root); fitCharts(root); fitValues(root); }); // selects estilizados, texto dos gráficos no tamanho real e números que cabem no card
  let fitTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitCharts(document); fitValues(document); }, 120); });
  autoEnhance(document.body);
  initViewport();
  initInstall();
  store.init(); // visitante: dados de exemplo, só na memória
  applyTheme();
  bindEvents();
  initScrollHints();
  initDiscreet();
  initChartTips();
  initSwipe();
  initListKeys();
  initPullToRefresh(async () => {
    renderAll();
    if (cloud.linked) await cloud.syncNow();
    toast(cloud.linked ? (cloud.state.status === 'idle' ? 'Atualizado e sincronizado.' : cloud.state.error || 'Atualizado.') : 'Atualizado.', { type: 'info', duration: 2000 });
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); renderAll(); });

  // Modo só leitura (dados de uma versão mais nova do app): aviso fixo no topo
  const showReadOnly = () => {
    let bar = document.getElementById('readonly-banner');
    if (!store.readOnly) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'readonly-banner';
      bar.className = 'readonly-banner';
      bar.setAttribute('role', 'alert');
      document.getElementById('main')?.before(bar);
    }
    bar.textContent = store.readOnly;
  };

  let frame = 0;
  store.subscribe((reason) => {
    if (reason === 'readonly' || reason === 'open' || reason === 'close') showReadOnly();
    if (reason === 'silent') return;
    applyTheme();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => renderAll());
    if (reason === 'open') setTimeout(onAccountOpen, 0);
  });
  onInstallChange(() => renderAll());

  // Nuvem: status no topo e avisos
  cloud.onChange((st) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => renderAll());
    // A frase foi trocada em outro aparelho (ou o login venceu): pede de novo
    if (!store.guest && ((st.status === 'locked' && !cloud.hasKey) || (st.status === 'signedout' && !cloud.user))) {
      store.close();
      openAuth(st.status === 'locked' ? 'passphrase' : 'signin');
    }
  });
  document.addEventListener('dhenors:cloud-notice', (ev) => {
    const d = ev.detail || {};
    toast(d.text || d, { type: 'info', duration: 9000, ...(d.action === 'conflicts' ? { action: { label: 'Resolver', run: () => dispatch('cloud:conflicts') } } : {}) });
  });

  renderAll();
  document.body.classList.remove('is-loading');

  // Login lembrado: abre direto os dados da nuvem (tela de carregamento enquanto isso)
  if (recovery) {
    openAuth('newpass', { recovery });
  } else if (readAuth()?.session && (await readLegacy().catch(() => null))) {
    // Login lembrado, mas ainda há dados de uma versão anterior no aparelho
    // (migração interrompida): a frase é pedida de novo para terminar de levá-los
    await cloud.init({ open: false }).catch(() => {});
    openAuth(cloud.user ? 'passphrase' : 'signin');
  } else if (readAuth()?.session) {
    openAuth('loading');
    try { await cloud.init(); } catch (err) { logError(err, 'nuvem'); }
    settle();
  } else {
    await cloud.init().catch(() => {});
    // Quem vinha de uma versão que guardava os dados aqui: pede para entrar e levá-los
    const legacy = await readLegacy().catch(() => null);
    if (legacy) openAuth('signin');
    else if (emailNotice?.ok) openAuth('signin');
  }
  if (emailNotice) setTimeout(() => toast(emailNotice.text, { type: emailNotice.ok ? 'success' : 'error', duration: 9000 }), 400);

  initServiceWorker();
}

start().catch((err) => {
  console.error(err);
  logError(err, 'início');
  document.getElementById('view').innerHTML =
    '<div class="card empty"><p><strong>Não foi possível iniciar o app.</strong></p><p class="muted">Recarregue a página. Se continuar, atualize o navegador.</p></div>';
  document.body.classList.remove('is-loading');
});

