// =============================================================
// Painel — visão geral do mês exibido
// -------------------------------------------------------------
// Personalizável: "Organizar painel" deixa subir/descer, esconder
// e fixar no topo cada card (fica salvo em settings.dashboard).
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { donutChart, barChart, lineChart, meter, chartWidth, sparkline } from '../ui/charts.js';
import { groupedItemList, itemList } from '../ui/items.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { catIcon } from '../ui/catIcon.js';
import { helpTip } from '../ui/help.js';
import { profileChecklist } from '../ui/onboarding.js';
import { pauseBanner } from '../ui/cloudUI.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, formatCompactBRL, percent, formatPercent, plural, sumCents } from '../core/money.js';
import {
  currentYM, todayISO, formatMonth, formatMonthShort, diffDays, formatDateBR, relativeDays, addMonthsYM, daysInMonth, parseYM, addDaysISO, ymOf,
} from '../core/dates.js';
import { computeMonth, overdueBefore } from '../domain/ledger.js';
import { financialScore, budgetStatus, spendingRoom, scoreHistory, dailyCashflow } from '../domain/planning.js';
import { monthSeries, nextActions, envelopeStatus, ruleStatus } from '../domain/analysis.js';
import { subscriptionAlerts } from '../domain/debts.js';
import { portfolio } from '../domain/investments.js';
import { invoicesIn } from '../domain/cards.js';
import { GROUP_LABELS } from '../domain/defaults.js';
import * as A from '../domain/actions.js';
import { monthMoney, outlookRow } from '../domain/outlook.js';
import { futureWeight, futureWeightSummary } from '../domain/weights.js';
import { adviceFor } from '../domain/advice.js';
import { yearPlan } from '../domain/yearplan.js';
import { STATUS_LABELS, STATUS_TONES, STATUS_ICONS } from '../domain/monthStatus.js';
import { statusBadge, monthStrip, adviceList, weightList } from '../ui/outlookUI.js';
import { flipLayout } from '../ui/motion.js';

const FILTERS = [
  { id: 'pending', label: 'A pagar' },
  { id: 'all', label: 'Todas' },
  { id: 'paid', label: 'Pagas' },
];

/**
 * Cards do painel (ordem padrão). `wide` = ocupa a largura toda; os
 * largos que estão no começo da ordem ficam no topo da tela, acima
 * dos indicadores. Cards novos entram na posição padrão também para
 * quem já organizou o painel (ver dashboardOrder).
 */
const CARDS = [
  { id: 'summary', label: 'Salário, ganhos e gastos', wide: true },
  { id: 'outlook', label: 'Próximos 12 meses', wide: true },
  { id: 'checklist', label: 'Complete seu perfil' },
  { id: 'older', label: 'Atrasadas de meses anteriores' },
  { id: 'limit', label: 'Meta de gastos' },
  { id: 'bills', label: 'Contas do mês' },
  { id: 'actions', label: 'O que fazer agora' },
  { id: 'tips', label: 'Dicas para o seu dinheiro' },
  { id: 'weight', label: 'Gastos que pesam no futuro' },
  { id: 'cashflow', label: 'Fluxo até o próximo salário' },
  { id: 'score', label: 'Saúde financeira' },
  { id: 'cards', label: 'Faturas dos cartões' },
  { id: 'budgets', label: 'Orçamentos' },
  { id: 'envelopes', label: 'Envelopes' },
  { id: 'rule', label: 'Regra 50/30/20' },
  { id: 'income', label: 'Receitas extras' },
  { id: 'invest', label: 'Investimentos' },
  { id: 'categories', label: 'Gastos por categoria' },
  { id: 'history', label: 'Renda × gastos (6 meses)' },
];

const editing = () => Boolean(store.ui.dashEdit);
const isWide = (id) => Boolean(CARDS.find((c) => c.id === id)?.wide);

/**
 * Ordem dos cards: a salva pela pessoa + os que ela ainda não conhece,
 * cada um logo depois do card que vem antes dele na ordem padrão
 * (assim o "Salário, ganhos e gastos" aparece primeiro também para
 * quem já tinha organizado o painel antes dele existir).
 */
export function dashboardOrder(saved = []) {
  const out = saved.filter((id, i) => CARDS.some((c) => c.id === id) && saved.indexOf(id) === i);
  CARDS.forEach((c, i) => {
    if (out.includes(c.id)) return;
    const prev = CARDS.slice(0, i).reverse().find((p) => out.includes(p.id));
    out.splice(prev ? out.indexOf(prev.id) + 1 : 0, 0, c.id);
  });
  return out;
}

export default {
  id: 'painel',
  title: 'Painel',
  monthNav: true,

  render() {
    const d = store.data;
    const ym = store.ui.ym;
    const today = todayISO();
    const m = computeMonth(d, ym, today);
    const isCurrent = ym === currentYM();
    const ctx = { d, ym, today, m, isCurrent, older: isCurrent ? overdueBefore(d, ym, today) : [] };
    const layout = d.settings.dashboard || { order: [], hidden: [], pinned: [] };
    const order = dashboardOrder(layout.order);
    const pinned = order.filter((id) => layout.pinned.includes(id));
    const rest = order.filter((id) => !layout.pinned.includes(id));
    const seq = [...pinned, ...rest];
    const rendered = seq.map((id) => {
      const hidden = layout.hidden.includes(id);
      if (hidden && !editing()) return null;
      const content = BLOCKS[id]?.(ctx);
      if (!content && !editing()) return null;
      const block = editing() ? editWrap(id, content, { hidden, pinned: layout.pinned.includes(id), first: id === order[0], last: id === order[order.length - 1] }) : content;
      return { id, block };
    }).filter(Boolean);
    // Os largos do começo vão para o topo; os demais largos ocupam a linha toda na grade
    let leadCount = 0;
    while (leadCount < rendered.length && isWide(rendered[leadCount].id)) leadCount++;
    const lead = rendered.slice(0, leadCount);
    const blocks = rendered.slice(leadCount).map((r) => (isWide(r.id) ? html`<div class="masonry__wide">${r.block}</div>` : r.block));
    const showSummary = rendered.some((r) => r.id === 'summary');

    return html`
      ${pauseBanner()}
      ${backupReminder(d)}
      ${lead.length ? html`<section class="dash-lead">${lead.map((r) => r.block)}</section>` : ''}

      <section class="grid grid--kpis" aria-label="Resumo do mês">
        ${showSummary ? '' : incomeKpi(ctx)}
        ${kpis(ctx)}
      </section>

      <div class="dash-tools">
        ${editing()
          ? html`<p class="muted small">Use as setas para reordenar, o olho para esconder e o alfinete para fixar no topo.</p>
              <button type="button" class="btn btn--ghost btn--sm" data-action="dash:reset">Voltar ao padrão</button>
              <button type="button" class="btn btn--primary btn--sm" data-action="dash:edit">${icon('check', 'icon--xs')} Pronto</button>`
          : html`<button type="button" class="btn btn--ghost btn--sm" data-action="dash:edit">${icon('sliders-horizontal', 'icon--xs')} Organizar painel</button>`}
      </div>

      <section class="masonry ${editing() ? 'is-editing' : ''}">${blocks}</section>`;
  },

  actions: {
    'score:open': () => scoreDialog(),
    'dash:payslip': (el) => { store.setUI({ ym: el.dataset.ym }); location.hash = '#/salario'; },
    'dash:filter': (el) => store.setUI({ filters: { ...store.ui.filters, dashboard: el.dataset.filter } }),
    'dash:edit': () => store.setUI({ dashEdit: !editing() }),
    'dash:reset': () => { flipLayout('.dash-edit', () => A.resetDashboardLayout()); toast('Painel no padrão.'); },
    'dash:move': (el) => moveCard(el.dataset.id, Number(el.dataset.dir)),
    'dash:hide': (el) => toggleIn('hidden', el.dataset.id),
    'dash:pin': (el) => toggleIn('pinned', el.dataset.id),
    'dash:month': (el) => { store.setUI({ ym: el.dataset.key }); location.hash = '#/analise?aba=historico'; setTimeout(() => document.dispatchEvent(new CustomEvent('dhenors:action', { detail: 'hist:report-current' })), 50); },
    'dash:category': (el) => {
      store.setUI({ filters: { ...store.ui.filters, bills: { ...(store.ui.filters.bills || {}), category: el.dataset.id, status: '' } } });
      location.hash = '#/contas?aba=mes';
    },
    'dash:go': (el) => { location.hash = el.dataset.route; },
    'dash:salary': () => E.editSalaryBase(store.ui.ym), // o mês exibido no Painel
    'limit:edit': () => E.editSpendingLimit(),
    'extra:new': () => E.editExtraIncome(),
    'extra:new-outside': () => E.editExtraIncome(null, { preset: { description: 'Freela', kind: 'freela', payroll: false } }),
    'extra:edit': (el) => E.editExtraIncome(store.data.extraIncomes.find((x) => x.id === el.dataset.id)),
    'extra:rec-edit': (el) => E.editRecurringIncome(store.data.recurringIncomes.find((x) => x.id === el.dataset.id)),
    'extra:rec-skip': (el) => {
      const r = store.data.recurringIncomes.find((x) => x.id === el.dataset.id);
      if (!r) return;
      const ym = store.ui.ym;
      A.skipRecurringIncomeMonth(r.id, ym, true);
      toast(`${r.description} fora de ${formatMonth(ym)}.`, { action: { label: 'Desfazer', run: () => A.skipRecurringIncomeMonth(r.id, ym, false) } });
    },
    'dash:weight': () => weightDialog(store.ui.ym),
    'extra:delete': (el) => {
      const x = store.data.extraIncomes.find((i) => i.id === el.dataset.id);
      if (x) E.deleteWithUndo(() => A.deleteExtraIncome(x.id), `"${x.description}" excluída.`);
    },
    'month:close': async () => {
      const ym = store.ui.ym;
      const m = computeMonth(store.data, ym);
      const pending = m.items.filter((i) => i.status !== 'paid');
      const ok = await confirmDialog({
        title: `Fechar ${formatMonth(ym)}`,
        message: `Os números do mês serão guardados no Histórico (com o relatório automático do mês) e o mês fica bloqueado para edições.${pending.length ? ` Atenção: ${plural(pending.length, 'conta ainda não paga', 'contas ainda não pagas')} — ${pending.length === 1 ? 'ela continuará' : 'elas continuarão'} aparecendo como atrasadas até serem pagas.` : ''} Você pode reabrir depois.`,
        confirmLabel: 'Fechar mês',
      });
      if (ok) {
        const snap = A.closeMonth(ym);
        toast(`${formatMonth(ym)} fechado. ${snap.report?.highlights?.[0] || ''}`, { duration: 9000 });
      }
    },
  },
};

// ---------- Organizar painel ----------

function layout() {
  const l = store.data.settings.dashboard || { order: [], hidden: [], pinned: [] };
  return { ...l, order: dashboardOrder(l.order) };
}

function moveCard(id, dir) {
  const l = layout();
  const i = l.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l.order.length) return;
  [l.order[i], l.order[j]] = [l.order[j], l.order[i]];
  // Os cards deslizam até o novo lugar em vez de pular
  flipLayout('.dash-edit', () => A.setDashboardLayout({ order: l.order }));
}

function toggleIn(list, id) {
  const l = layout();
  const set = new Set(l[list]);
  if (set.has(id)) set.delete(id); else set.add(id);
  flipLayout('.dash-edit', () => A.setDashboardLayout({ [list]: [...set] }));
}

function editWrap(id, content, { hidden, pinned, first, last }) {
  const label = CARDS.find((c) => c.id === id)?.label || id;
  return html`
    <div class="dash-edit ${hidden ? 'is-hidden' : ''}" data-key="dash-${id}">
      <div class="dash-edit__bar">
        <strong>${label}</strong>
        <span>
          <button type="button" class="icon-btn icon-btn--sm" data-action="dash:move" data-id="${id}" data-dir="-1" aria-label="Subir ${label}" ${first ? 'disabled' : ''}>${icon('arrow-up')}</button>
          <button type="button" class="icon-btn icon-btn--sm" data-action="dash:move" data-id="${id}" data-dir="1" aria-label="Descer ${label}" ${last ? 'disabled' : ''}>${icon('arrow-down')}</button>
          <button type="button" class="icon-btn icon-btn--sm" data-action="dash:pin" data-id="${id}" aria-pressed="${pinned}" aria-label="${pinned ? 'Desafixar' : 'Fixar no topo'} ${label}">${icon(pinned ? 'pin-off' : 'pin')}</button>
          <button type="button" class="icon-btn icon-btn--sm" data-action="dash:hide" data-id="${id}" aria-pressed="${hidden}" aria-label="${hidden ? 'Mostrar' : 'Esconder'} ${label}">${icon(hidden ? 'eye-off' : 'eye')}</button>
        </span>
      </div>
      ${content || html`<p class="muted small dash-edit__empty">Aparece quando houver dados.</p>`}
    </div>`;
}

// ---------- Topo: salário, ganhos, gastos e saldo do mês ----------

const STATUS_SENTENCE = {
  ok: (mm) => `Folga de ${formatPercent(mm.freePct)} dos ganhos`,
  tight: (mm) => `Apertado: sobra só ${formatPercent(mm.freePct)} dos ganhos`,
  short: (mm) => `Não fecha: faltam ${formatBRL(-mm.balance)}`,
  none: () => 'Cadastre seu salário e suas contas',
};

/** Anel de proporção: quanto dos ganhos já está comprometido com gastos. */
function commitRing(pct, status) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(100, pct));
  return html`
    <div class="commit-ring commit-ring--${status}" role="img" aria-label="${formatPercent(pct)} dos ganhos comprometidos com gastos">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="12" class="commit-ring__track"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="12" class="commit-ring__bar" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - shown / 100)).toFixed(1)}"/>
      </svg>
      <div class="commit-ring__num"><strong>${pct > 999 ? '>999' : Math.round(pct)}%</strong><small>comprometido</small></div>
    </div>`;
}

/** Barra empilhada: pago · a pagar · em atraso · livre (sobre os ganhos ou os gastos, o que for maior). */
function moneyStack(mm) {
  const s = mm.spending;
  const free = Math.max(0, mm.balance);
  const base = Math.max(mm.earnings, s.total, 1);
  const w = (c) => `${((c / base) * 100).toFixed(2)}%`;
  const parts = [
    { k: 'paid', label: 'Pago', cents: s.paid },
    { k: 'open', label: 'A pagar', cents: s.open },
    { k: 'overdue', label: 'Em atraso', cents: s.overdue },
    { k: 'free', label: mm.balance < 0 ? 'Falta' : 'Livre', cents: mm.balance < 0 ? -mm.balance : free },
  ];
  return html`
    <div class="mstack" role="img" aria-label="${parts.map((p) => `${p.label}: ${formatBRL(p.cents)}`).join('; ')}">
      ${parts.filter((p) => p.cents > 0).map((p) => html`<span class="mstack__part mstack__part--${p.k} ${p.k === 'free' && mm.balance < 0 ? 'is-missing' : ''}" style="width:${w(p.cents)}"></span>`)}
    </div>
    <ul class="mstack__legend">
      ${parts.map((p) => html`<li class="mstack__key mstack__key--${p.k} ${p.k === 'free' && mm.balance < 0 ? 'is-missing' : ''}"><span aria-hidden="true"></span>${p.label} <strong class="money">${formatBRL(p.cents)}</strong></li>`)}
    </ul>`;
}

function summaryCard({ d, m, ym, isCurrent, today }) {
  const mm = monthMoney(d, ym, today);
  const room = isCurrent ? spendingRoom(d, today) : null;
  const canClose = ym <= currentYM() && !m.closed;
  const negative = mm.balance < 0;
  const tone = mm.status === 'ok' && (mm.spending.overdue > 0 || (room && room.free <= 0)) ? 'warn' : STATUS_TONES[mm.status];
  const sal = mm.salary;
  const row = outlookRow(d, ym, today);
  const weight = futureWeightSummary(futureWeight(d, ym, today));
  const showForecast = row && (row.status !== mm.status || Math.abs(row.balance - mm.balance) >= 1000);
  const fromOther = mm.others.total;

  return html`
    <article class="card summary tone-${tone}" data-key="summary" aria-labelledby="summary-title">
      <header class="summary__top">
        <h2 class="summary__title" id="summary-title">${icon('wallet')} <span class="hero__label-long">Seu dinheiro em ${formatMonth(ym)}</span><span class="hero__label-short">Seu dinheiro · ${formatMonthShort(ym)}</span></h2>
        <div class="summary__top-actions">
          ${statusBadge(mm.status)}
          ${m.closed
            ? html`<span class="badge badge--muted">${icon('lock', 'icon--xs')} Mês fechado</span>`
            : canClose ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="month:close">${icon('lock', 'icon--xs')} Fechar mês</button>` : ''}
        </div>
      </header>

      <div class="summary__figs">
        <section class="sfig sfig--salary" aria-label="Salário do mês">
          <p class="sfig__label">${icon('banknote', 'icon--xs')} Salário do mês ${helpTip('salarioMes')}</p>
          <p class="sfig__value money">${formatBRL(sal.net)}</p>
          ${sal.hasProfile && !sal.legacyNet ? html`
            <details class="sfig__details">
              <summary>Bruto ${formatBRL(sal.gross)} · descontos ${formatBRL(sal.deductionsTotal)}</summary>
              <dl class="sfig__lines">
                <div><dt>Salário base</dt><dd class="money">${formatBRL(sal.base)}</dd></div>
                ${sal.additions.map((a) => html`<div class="is-add"><dt>+ ${a.label}</dt><dd class="money">${formatBRL(a.cents)}</dd></div>`)}
                <div class="is-total"><dt>= Bruto</dt><dd class="money">${formatBRL(sal.gross)}</dd></div>
                ${sal.deductions.map((x) => html`<div class="is-sub"><dt>− ${x.label}</dt><dd class="money">${formatBRL(x.cents)}</dd></div>`)}
                <div class="is-total"><dt>= Líquido${sal.actual != null ? ' (conferido no holerite)' : ''}</dt><dd class="money">${formatBRL(sal.net)}</dd></div>
              </dl>
              ${sal.actual != null && sal.estimatedNet !== sal.net ? html`<p class="small muted">O cálculo estimava ${formatBRL(sal.estimatedNet)}; vale o valor conferido.</p>` : ''}
              <a class="link small" href="#/salario" data-action="dash:payslip" data-ym="${sal.competence || ym}">Ver contracheque ${icon('arrow-right', 'icon--xs')}</a>
            </details>`
          : sal.net ? html`<p class="sfig__sub">Líquido informado${sal.competence && sal.competence !== ym ? ` · holerite de ${formatMonthShort(sal.competence)}` : ''}</p>`
            : html`<button type="button" class="btn btn--secondary btn--sm" data-action="dash:salary">${icon('plus', 'icon--xs')} Cadastrar salário</button>`}
        </section>

        <section class="sfig sfig--earn" aria-label="Ganhos do mês">
          <p class="sfig__label">${icon('trending-up', 'icon--xs')} Ganhos do mês ${helpTip('ganhosMes')}</p>
          <p class="sfig__value money pos">${formatBRL(mm.earnings)}</p>
          <p class="sfig__sub">
            ${formatBRL(sal.net)} da folha
            ${mm.extras.total ? html` + <strong>${formatBRL(mm.extras.total)} fora da folha</strong>` : ''}
            ${fromOther ? html` + ${formatBRL(fromOther)} de ${mm.others.list.map((o) => o.label.toLowerCase()).join(', ') || 'outras fontes'}` : ''}
          </p>
          ${mm.extras.list.length ? html`<p class="sfig__chips">${mm.extras.list.slice(0, 3).map((x) => html`<span class="badge badge--good">${x.recurring ? icon('repeat', 'icon--xs') : ''} ${x.label}</span>`)}${mm.extras.list.length > 3 ? html`<span class="badge badge--muted">+${mm.extras.list.length - 3}</span>` : ''}</p>` : ''}
          ${m.closed ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-action="extra:new-outside">${icon('plus', 'icon--xs')} Ganho extra</button>`}
        </section>

        <section class="sfig sfig--spend" aria-label="Gasto no mês">
          <p class="sfig__label">${icon('receipt', 'icon--xs')} Gasto no mês</p>
          <p class="sfig__value money">${formatBRL(mm.spending.total)}</p>
          <p class="sfig__sub"><span class="pos">${formatBRL(mm.spending.paid)} pago</span> · ${mm.spending.openCount ? html`<strong>${formatBRL(mm.spending.pending)} falta</strong> (${plural(mm.spending.openCount, 'conta')})` : 'nada a pagar'}</p>
          ${mm.spending.overdue ? html`<p class="sfig__sub neg">${icon('circle-alert', 'icon--xs')} ${formatBRL(mm.spending.overdue)} em atraso</p>` : ''}
        </section>
      </div>

      <div class="summary__balance">
        ${commitRing(mm.committedPct, mm.status)}
        <div class="summary__balance-text">
          <p class="sfig__label">Saldo do mês · ganhos − gastos ${helpTip('saldoPrevisto')}</p>
          <p class="summary__big summary__big--${mm.status} money ${negative ? 'neg' : ''}">${negative ? '−' : '+'}${formatBRL(Math.abs(mm.balance))}</p>
          <p class="summary__status summary__status--${mm.status}">${icon(STATUS_ICONS[mm.status], 'icon--xs')} ${STATUS_SENTENCE[mm.status](mm)}</p>
        </div>
        ${mm.thirteenth ? html`
          <div class="hero__mini" aria-label="13º salário, pago à parte">
            <p class="hero__mini-label">${icon('sparkles', 'icon--xs')} 13º salário · ${mm.thirteenth.part === 1 ? '1ª' : '2ª'} parcela</p>
            <p class="hero__mini-value money">${formatBRL(mm.thirteenth.net)}</p>
            <p class="hero__mini-note">até ${mm.thirteenth.part === 1 ? '30/11' : '20/12'} · fora do saldo do mês</p>
          </div>` : ''}
      </div>

      ${mm.earnings || mm.spending.total ? moneyStack(mm) : ''}

      <div class="summary__notes">
        ${showForecast ? html`
          <button type="button" class="summary__note" data-action="outlook:month" data-ym="${ym}">
            ${icon('activity', 'icon--xs')} <span>Previsão com o dia a dia estimado${row.thirteenth ? ' e o 13º' : ''}: <strong class="${row.balance < 0 ? 'neg' : ''}">${row.balance < 0 ? '−' : ''}${formatBRL(Math.abs(row.balance))}</strong> · ${STATUS_LABELS[row.status].toLowerCase()}</span> ${icon('chevron-right', 'icon--xs')}
          </button>` : ''}
        ${weight ? html`
          <button type="button" class="summary__note" data-action="dash:weight">
            ${icon('hourglass', 'icon--xs')} <span>${weight}</span> ${icon('chevron-right', 'icon--xs')}
          </button>` : ''}
      </div>

      ${room ? html`
        <div class="hero__payday">
          ${icon('calendar')}
          <span>Próximo salário: <strong>${formatDateBR(room.nextPay)}</strong> (${relativeDays(room.nextPay, today)})</span>
          <span class="hero__perday">${room.free > 0
            ? html`Dá para gastar <strong>${formatBRL(room.perDay)}/dia</strong> até lá`
            : html`<strong>Sem folga</strong> até o salário: faltam ${formatBRL(-room.free)}`}</span>
          <span class="hero__split">${formatBRL(room.dueBefore)} vencem antes do salário · ${formatBRL(room.dueAfter)} depois${room.source === 'accounts' ? ' · pelo saldo das suas contas' : ''}</span>
        </div>` : ''}
    </article>`;
}

/** Janela: o que deste mês continua pesando, mês a mês. */
function weightDialog(ym) {
  const today = todayISO();
  const fw = futureWeight(store.data, ym, today);
  const months = Object.keys(fw.byMonth).sort().slice(0, 12);
  const max = Math.max(1, ...months.map((k) => fw.byMonth[k]));
  openDialog({
    title: `O que ${formatMonth(ym)} deixa para os próximos meses`,
    size: 'md',
    body: html`
      ${fw.count ? html`
        <p class="dialog__text">${futureWeightSummary(fw)}.</p>
        ${weightList(fw)}
        <h3 class="dialog__subtitle">Quanto pesa em cada mês</h3>
        <ul class="causes">
          ${months.map((k) => html`
            <li class="causes__row">
              <span class="causes__label">${formatMonth(k)}</span>
              <span class="money">${formatBRL(fw.byMonth[k])}</span>
              <span class="causes__bar" aria-hidden="true"><span style="width:${Math.round((fw.byMonth[k] / max) * 100)}%"></span></span>
            </li>`)}
        </ul>`
      : html`<p class="muted">Nada lançado neste mês continua nos próximos meses.</p>`}`,
  });
}

/** Meta de gastos com o RITMO do mês: linha ideal × real, dia a dia. */
function limitCard({ m, isCurrent, today }) {
  const limit = store.data.settings.spendingLimitCents;
  if (!limit) {
    return html`
      <article class="card card--center tone-info" data-key="limit">
        ${icon('target', 'icon--lg muted')}
        <h2 class="card__title">Meta de gastos</h2>
        <p class="muted">Defina um teto mensal e acompanhe o ritmo dos gastos aqui.</p>
        <button type="button" class="btn btn--secondary" data-action="limit:edit">Definir meta</button>
      </article>`;
  }
  const used = percent(m.totals.all, limit);
  const tone = used > 100 ? 'over' : used >= 80 ? 'warn' : 'good';
  const { y, m: mm } = parseYM(m.ym);
  const days = daysInMonth(y, mm);
  const dayNow = isCurrent ? Number(today.slice(8)) : days;
  // gasto acumulado por dia (pelo vencimento, inclui o que já está agendado) × linha ideal
  const actual = [];
  let acc = 0;
  for (let i = 1; i <= days; i++) {
    const date = `${m.ym}-${String(i).padStart(2, '0')}`;
    acc += sumCents(m.items.filter((it) => it.dueDate === date).map((it) => it.cents));
    actual.push(acc);
  }
  const ideal = Array.from({ length: days }, (_, i) => Math.round((limit * (i + 1)) / days));
  const spentSoFar = actual[dayNow - 1];
  const idealSoFar = ideal[dayNow - 1];
  const pace = idealSoFar ? spentSoFar / idealSoFar : 0;
  const top = [...m.items].sort((a, b) => b.cents - a.cents).slice(0, 3);
  return html`
    <article class="card limit-card tone-${tone === 'over' ? 'bad' : tone === 'warn' || (isCurrent && pace > 1.1) ? 'warn' : 'good'}" data-key="limit">
      <header class="card__header">
        <h2 class="card__title">${icon('target')} Meta de gastos</h2>
        <button type="button" class="icon-btn" data-action="limit:edit" aria-label="Editar meta de gastos">${icon('pencil')}</button>
      </header>
      <div class="limit-card__top">
        <div>
          <p class="big-number money state--${tone}">${formatPercent(used)}</p>
          ${meter(m.totals.all, { max: limit, label: 'Uso da meta de gastos', tone: tone === 'over' ? 'over' : tone === 'warn' || (isCurrent && pace > 1.1) ? 'warn' : 'good' })}
          <p class="muted small">${formatBRL(m.totals.all)} de ${formatBRL(limit)} ·
            ${used <= 100 ? `restam ${formatBRL(limit - m.totals.all)}` : html`<strong class="state--over">${formatBRL(m.totals.all - limit)} acima</strong>`}</p>
          ${isCurrent ? html`<p class="small ${pace > 1.1 ? 'state--warn' : 'muted'}">${pace > 1.1 ? `Ritmo ${Math.round((pace - 1) * 100)}% acima do ideal para o dia ${dayNow}.` : pace < 0.9 ? 'Ritmo abaixo do ideal.' : 'No ritmo do ideal.'}</p>` : ''}
        </div>
        <div class="limit-card__chart">
          ${lineChart(Array.from({ length: days }, (_, i) => String(i + 1)), [
            { name: 'Ideal', values: ideal, className: 'is-ideal', dashed: true },
            { name: 'Real (com o agendado)', values: actual, className: 'is-spent' },
          ], { label: 'Ritmo dos gastos no mês: ideal e real', height: 120, width: 300, every: 7, marks: isCurrent ? [{ index: dayNow - 1, label: 'hoje' }] : [] })}
        </div>
      </div>
      ${top.length ? html`<ul class="mini-list mini-list--compact">${top.map((i) => html`<li><span>${i.description}</span><span class="money">${formatBRL(i.cents)}</span></li>`)}</ul>` : ''}
    </article>`;
}

// ---------- KPIs (com minigráfico de 6 meses e variação) ----------

function delta(cur, prev, { upGood = true } = {}) {
  if (!prev) return '';
  const pct = percent(cur - prev, prev);
  if (Math.abs(pct) < 1) return html`<span class="kpi__delta">= mês anterior</span>`;
  const good = upGood ? pct > 0 : pct < 0;
  return html`<span class="kpi__delta ${good ? 'is-good' : 'is-bad'}">${icon(pct > 0 ? 'trending-up' : 'trending-down', 'icon--xs')} ${formatPercent(Math.abs(pct))} vs ${formatMonthShort(addMonthsYM(store.ui.ym, -1))}</span>`;
}

function incomeKpi({ m }) {
  const p = m.income.payroll;
  const taxes = p.inss + p.ir.value;
  const series = monthSeries(store.data, m.ym, 6, todayISO());
  const sub = p.legacyNet || !p.hasProfile
    ? `${formatBRL(m.income.salary)} salário${m.income.extrasCents ? ` + ${formatBRL(m.income.extrasCents)} extras` : ''}`
    : `bruto ${formatBRL(m.income.gross)} · impostos ${formatBRL(taxes)}${p.deductionsTotal ? ` · descontos ${formatBRL(p.deductionsTotal)}` : ''}`;
  return html`
    <article class="card kpi tone-${m.income.total > 0 ? 'good' : 'info'}" data-key="kpi-income">
      <span class="kpi__icon">${icon('wallet')}</span>
      <div class="kpi__body">
        <p class="kpi__label">Renda líquida do mês</p>
        <p class="kpi__value money">${formatBRL(m.income.total)}</p>
        <p class="kpi__sub">${sub}${m.income.competence && m.income.competence !== m.ym ? ` · holerite de ${formatMonthShort(m.income.competence)}` : ''}</p>
        <div class="kpi__trend">${sparkline(series.map((s) => s.income), { label: 'Renda dos últimos 6 meses' })}${delta(series[5]?.income, series[4]?.income)}</div>
        <a class="link kpi__link" href="#/salario" data-action="dash:payslip" data-ym="${m.income.competence || m.ym}">Ver contracheque ${icon('arrow-right', 'icon--xs')}</a>
      </div>
      <button type="button" class="icon-btn kpi__action" data-action="dash:salary" aria-label="Editar salário">${icon('pencil')}</button>
    </article>`;
}

function kpis({ m, d }) {
  const series = Array.from({ length: 6 }, (_, i) => computeMonth(d, addMonthsYM(m.ym, i - 5), todayISO()));
  const list = [
    { key: 'expense', ic: 'receipt', label: 'Contas avulsas', kind: 'expense' },
    { key: 'recurring', ic: 'repeat', label: 'Recorrentes', kind: 'recurring' },
    { key: 'installment', ic: 'calendar-range', label: 'Parcelas', kind: 'installment' },
    ...((d.cards || []).length ? [{ key: 'invoice', ic: 'credit-card', label: 'Faturas', kind: 'invoice' }] : []),
  ];
  return list.map((k) => {
    const values = series.map((s) => s.totals[k.key] || 0);
    const items = m.items.filter((i) => i.kind === k.kind);
    const tone = items.some((i) => i.status === 'overdue') ? 'bad'
      : items.some((i) => i.status === 'today' || i.status === 'soon') ? 'warn'
      : items.length && items.every((i) => i.status === 'paid') ? 'good' : 'info';
    return html`
      <article class="card kpi tone-${tone}" data-key="kpi-${k.key}">
        <span class="kpi__icon">${icon(k.ic)}</span>
        <div class="kpi__body">
          <p class="kpi__label">${k.label}</p>
          <p class="kpi__value money">${formatBRL(m.totals[k.key] || 0)}</p>
          <p class="kpi__sub">${count(m.items, k.kind)}</p>
          <div class="kpi__trend">${sparkline(values, { label: `${k.label} nos últimos 6 meses`, tone: 'up-bad' })}${delta(values[5], values[4], { upGood: false })}</div>
        </div>
      </article>`;
  });
}

function count(items, kind) {
  const list = items.filter((i) => i.kind === kind);
  const open = list.filter((i) => i.status !== 'paid').length;
  if (!list.length) return 'nenhuma no mês';
  return `${list.length} no mês · ${open ? `${open} a pagar` : 'tudo pago'}`;
}

// ---------- Blocos do painel ----------

const BLOCKS = {
  summary: (ctx) => summaryCard(ctx),

  outlook: ({ d, ym, today }) => {
    if (!d.settings.salaryHistory.length && !d.recurring.length && !d.installments.length && !(d.cardPurchases || []).length) return '';
    const plan = yearPlan(d, currentYM(), 12, today);
    const short = plan.months.filter((r) => r.status === 'short');
    const tight = plan.months.filter((r) => r.status === 'tight');
    const tone = short.length ? 'bad' : tight.length ? 'warn' : 'good';
    const first = short[0] || tight[0];
    return html`
      <article class="card outlook tone-${tone}" data-key="outlook">
        <header class="card__header">
          <h2 class="card__title">${icon('calendar-range')} Próximos 12 meses ${helpTip('statusMes')}</h2>
          <span class="outlook__count">${short.length
            ? html`${statusBadge('short', { label: plural(short.length, 'mês não fecha', 'meses não fecham') })}`
            : tight.length ? statusBadge('tight', { label: plural(tight.length, 'mês apertado', 'meses apertados') }) : statusBadge('ok', { label: 'Todos folgados' })}</span>
        </header>
        ${monthStrip(plan.months, { selected: ym, caption: '' })}
        ${first ? html`
          <button type="button" class="summary__note" data-action="outlook:month" data-ym="${first.ym}">
            ${icon(STATUS_ICONS[first.status], 'icon--xs')}
            <span>${first.status === 'short' ? html`Primeiro mês que não fecha: <strong>${formatMonth(first.ym)}</strong>, faltam ${formatBRL(-first.balance)}.` : html`Primeiro mês apertado: <strong>${formatMonth(first.ym)}</strong>, sobra só ${formatBRL(first.balance)}.`} Toque para ver o porquê e como resolver.</span>
            ${icon('chevron-right', 'icon--xs')}
          </button>` : html`<p class="muted small">Toque num mês para ver o que pesa nele. Inclui 13º, férias, plantões, parcelas, faturas e o gasto do dia a dia estimado.</p>`}
      </article>`;
  },

  limit: (ctx) => limitCard(ctx),

  tips: ({ d, ym, today }) => {
    if (!d.settings.salaryHistory.length && !d.expenses.length && !d.recurring.length) return '';
    const advice = adviceFor(d, ym, today);
    const media = advice.media.slice(0, 2);
    const complexa = advice.complexa.slice(0, 2);
    const simples = advice.simples.filter((t) => t.id.startsWith('over:') || t.id.startsWith('unusual:')).slice(0, 2);
    if (!media.length && !complexa.length && !simples.length) return '';
    const tone = [...media, ...complexa].some((t) => t.tone === 'bad') ? 'bad' : [...media, ...complexa, ...simples].some((t) => t.tone === 'warn') ? 'warn' : 'info';
    return html`
      <article class="card tone-${tone}" data-key="tips">
        <header class="card__header">
          <h2 class="card__title">${icon('lightbulb')} Dicas para o seu dinheiro ${helpTip('dicas')}</h2>
          <a class="link small" href="#/analise">Todas ${icon('arrow-right', 'icon--xs')}</a>
        </header>
        ${adviceList({ simples, media, complexa }, { limit: 2 })}
      </article>`;
  },

  weight: ({ d, ym, today }) => {
    const fw = futureWeight(d, ym, today);
    if (!fw.count) return '';
    const next = Object.keys(fw.byMonth).sort().slice(0, 6);
    const max = Math.max(1, ...next.map((k) => fw.byMonth[k]));
    return html`
      <article class="card tone-${fw.until && fw.until > addMonthsYM(ym, 6) ? 'warn' : 'info'}" data-key="weight">
        <header class="card__header">
          <h2 class="card__title">${icon('hourglass')} Gastos que pesam no futuro ${helpTip('pesoFuturo')}</h2>
          <button type="button" class="btn btn--ghost btn--sm" data-action="dash:weight">Detalhes</button>
        </header>
        <p class="small"><strong>${futureWeightSummary(fw)}.</strong></p>
        <ol class="weight-bars" role="list" aria-label="Quanto os gastos de ${formatMonth(ym)} pesam nos próximos meses">
          ${next.map((k) => html`<li title="${formatMonth(k)}: ${formatBRL(fw.byMonth[k])}"><span class="weight-bars__bar" style="--h:${Math.max(8, Math.round((fw.byMonth[k] / max) * 100))}%"></span><span class="weight-bars__m">${formatMonthShort(k).split('/')[0]}</span><span class="weight-bars__v money">${formatCompactBRL(fw.byMonth[k]).replace('R$ ', '')}</span></li>`)}
        </ol>
        ${weightList(fw, 4)}
      </article>`;
  },

  checklist: ({ d }) => {
    const c = profileChecklist(d);
    if (c.done === c.total) return '';
    return html`
      <article class="card tone-info" data-key="checklist">
        <header class="card__header"><h2 class="card__title">${icon('list-checks')} Complete seu perfil</h2><span class="muted small">${c.done}/${c.total}</span></header>
        ${meter(c.done, { max: c.total, label: `${c.done} de ${c.total} passos` })}
        <ul class="checklist">
          ${c.list.map((s) => html`<li class="${s.done ? 'is-done' : ''}">${icon(s.done ? 'circle-check' : 'square', 'icon--xs')}
            ${s.done ? html`<span>${s.label}</span>` : s.href ? html`<a href="${s.href}">${s.label}</a>` : html`<button type="button" class="link" data-action="${s.act}">${s.label}</button>`}</li>`)}
        </ul>
        <button type="button" class="btn btn--ghost btn--sm" data-action="onb:wizard">Abrir o passo a passo</button>
      </article>`;
  },

  older: ({ older }) => (older.length ? html`
    <article class="card card--alert" data-key="older">
      <header class="card__header">
        <h2 class="card__title">${icon('triangle-alert')} Atrasadas de meses anteriores</h2>
        <span class="money neg">${formatBRL(sumCents(older.map((i) => i.cents)))}</span>
      </header>
      ${itemList(older, { showMonth: true })}
    </article>` : ''),

  bills: ({ m, ym }) => {
    const filter = store.ui.filters.dashboard || 'pending';
    const shown = m.items.filter((i) => (filter === 'all' ? true : filter === 'paid' ? i.status === 'paid' : i.status !== 'paid'));
    return html`
      <article class="card" data-key="bills">
        <header class="card__header">
          <h2 class="card__title">${icon('receipt')} Contas de ${formatMonth(ym)}</h2>
          <div class="segmented" role="group" aria-label="Filtrar contas">
            ${FILTERS.map((f) => html`
              <button type="button" class="segmented__btn" data-action="dash:filter" data-filter="${f.id}" aria-pressed="${filter === f.id}">${f.label}</button>`)}
          </div>
        </header>
        ${shown.length ? groupedItemList(shown) : emptyList(filter, m)}
        <footer class="card__footer">
          <a class="link" href="#/contas">Ver lista completa ${icon('arrow-right', 'icon--xs')}</a>
        </footer>
      </article>`;
  },

  actions: ({ d, m, ym, today, isCurrent, older }) => {
    const alertsCount = isCurrent ? older.length + m.items.filter((i) => i.status === 'overdue' || i.status === 'today' || (i.status === 'soon' && i.dueDate <= addDaysISO(today, 1))).length : 0;
    const list = [...nextActions(d, m, today, { alertsCount, advice: adviceFor(d, ym, today) }), ...subscriptionAlerts(d, today).map((s) => ({ ...s, action: { label: 'Ver assinaturas', route: '#/contas?aba=assinaturas' } }))].slice(0, 4);
    if (!list.length) return '';
    const ICON = { good: 'trending-up', warn: 'triangle-alert', bad: 'circle-alert', info: 'lightbulb' };
    const worst = list.some((i) => i.tone === 'bad') ? 'bad' : list.some((i) => i.tone === 'warn') ? 'warn' : 'info';
    return html`
      <article class="card tone-${worst}" data-key="actions">
        <header class="card__header"><h2 class="card__title">${icon('sparkles')} O que fazer agora</h2></header>
        <ul class="next-actions">
          ${list.map((i) => html`
            <li class="next-action next-action--${i.tone}">
              ${icon(ICON[i.tone] || 'info')}
              <div><strong>${i.title}</strong><p>${i.text}</p></div>
              ${i.action ? html`<button type="button" class="btn btn--secondary btn--sm" ${i.action.act ? html`data-action="${i.action.act}"` : html`data-action="dash:go" data-route="${i.action.route}"`}>${i.action.label}</button>` : ''}
            </li>`)}
        </ul>
      </article>`;
  },

  cashflow: ({ d, today, isCurrent }) => {
    if (!isCurrent || !d.settings.salaryHistory.length) return '';
    const flow = dailyCashflow(d, today);
    const pts = flow.points.filter((p) => p.date <= flow.nextPay);
    if (pts.length < 2) return '';
    const minIdx = pts.findIndex((p) => p === pts.reduce((a, p) => (p.balance < a.balance ? p : a), pts[0]));
    const low = pts[minIdx].balance;
    const income = computeMonth(d, ymOf(today), today).income.total;
    const tone = low < 0 ? 'bad' : low < income * 0.1 ? 'warn' : 'good';
    return html`
      <article class="card tone-${tone}" data-key="cashflow">
        <header class="card__header">
          <h2 class="card__title">${icon('activity')} Até o salário (${formatDateBR(flow.nextPay)})</h2>
          <a class="link small" href="#/planejamento?aba=fluxo">Detalhes</a>
        </header>
        ${lineChart(pts.map((p) => p.date.slice(8)), [{ name: 'Saldo', values: pts.map((p) => p.balance), className: 'is-balance' }],
          { label: 'Saldo dia a dia até o próximo salário', height: 160, width: chartWidth(0.5), area: true, marks: [{ index: minIdx, label: 'menor' }] })}
        <p class="small ${pts[minIdx].balance < 0 ? 'neg' : 'muted'}">${pts[minIdx].balance < 0
          ? `Aperta em ${formatDateBR(pts[minIdx].date)}: falta ${formatBRL(-pts[minIdx].balance)} (${pts[minIdx].events.join(', ') || 'contas do dia'}).`
          : `O ponto mais baixo é ${formatDateBR(pts[minIdx].date)}, com ${formatBRL(pts[minIdx].balance)}.`}</p>
      </article>`;
  },

  score: ({ d, ym, today }) => {
    const s = financialScore(d, ym, today);
    const worst = [...s.factors].sort((a, b) => a.points / a.max - b.points / b.max)[0];
    const hist = scoreHistory(d, ym, 6, today).filter((h) => h.score != null);
    const tone = !d.settings.salaryHistory.length ? 'info' : s.tone === 'info' ? 'good' : s.tone;
    return html`
      <article class="card tone-${tone}" data-key="score">
        <header class="card__header">
          <h2 class="card__title">${icon('gauge')} Saúde financeira</h2>
          <button type="button" class="btn btn--ghost btn--sm" data-action="score:open">Detalhes ${icon('arrow-right', 'icon--xs')}</button>
        </header>
        <div class="score score--${s.tone}">
          ${ring(s.score)}
          <div>
            <p class="score__grade">${s.grade}</p>
            ${s.caps.length ? html`<p class="small state--warn">Limitada por: ${s.caps.map((c) => c.reason).join(', ')}</p>` : ''}
            <p class="muted small">Para melhorar: ${worst.tip}</p>
            ${hist.length >= 2 ? html`<div class="kpi__trend">${sparkline(hist.map((h) => h.score), { label: 'Nota nos últimos meses', format: String })}<span class="muted small">últimos ${hist.length} meses</span></div>` : ''}
          </div>
        </div>
      </article>`;
  },

  cards: ({ d, ym, today }) => {
    const invs = invoicesIn(d, ym, today);
    if (!(d.cards || []).length || !invs.length) return '';
    const tone = invs.some((i) => !i.paidAt && i.due < today) ? 'bad' : invs.every((i) => i.paidAt) ? 'good' : 'info';
    return html`
      <article class="card tone-${tone}" data-key="cards">
        <header class="card__header"><h2 class="card__title">${icon('credit-card')} Faturas de ${formatMonth(ym)}</h2><a class="link small" href="#/carteira">Cartões</a></header>
        <ul class="mini-list">
          ${invs.map((inv) => html`<li><span class="stack-text">${inv.card.name} <small class="muted">fecha ${formatDateBR(inv.closing)} · vence ${formatDateBR(inv.due)}</small></span>
            <span class="money">${formatBRL(inv.total)}</span>
            <span class="mini-list__actions">${inv.paidAt ? html`<span class="badge badge--paid">paga</span>` : html`<span class="badge">${inv.status === 'open' ? 'aberta' : 'fechada'}</span>`}</span></li>`)}
        </ul>
      </article>`;
  },

  budgets: ({ d, ym, today }) => {
    const list = budgetStatus(d, ym, today);
    if (!list.length) {
      return html`
        <article class="card" data-key="budgets">
          <header class="card__header"><h2 class="card__title">${icon('scale')} Orçamentos</h2></header>
          <p class="muted small">Defina um teto por categoria (mercado, lazer, transporte…) e acompanhe aqui quanto ainda pode gastar.</p>
          <a class="link" href="#/ajustes?aba=categorias">Definir orçamentos ${icon('arrow-right', 'icon--xs')}</a>
        </article>`;
    }
    const tone = list.some((b) => b.tone === 'bad') ? 'bad' : list.some((b) => b.tone === 'warn') ? 'warn' : 'good';
    return html`
      <article class="card tone-${tone}" data-key="budgets">
        <header class="card__header">
          <h2 class="card__title">${icon('scale')} Orçamentos do mês</h2>
          <a class="link small" href="#/ajustes?aba=categorias">Editar</a>
        </header>
        <ul class="budgets">
          ${list.slice(0, 6).map((b) => html`
            <li class="budget">
              <span class="budget__name">${catIcon(d.categories.find((c) => c.id === b.id), { size: 'xs' })} ${b.name}</span>
              <span class="budget__value ${b.tone === 'bad' ? 'state--over' : ''}">${formatBRL(b.spent)} / ${formatBRL(b.budget)}</span>
              ${meter(Math.min(b.spent, b.budget), { max: b.budget, label: `${b.name}: ${formatPercent(b.pct)}`, tone: b.tone === 'bad' ? 'over' : b.tone === 'warn' ? 'warn' : '' })}
              <small class="${b.left >= 0 ? 'muted' : 'state--over'}">${b.left >= 0 ? `Ainda pode gastar ${formatBRL(b.left)}` : `Estourou: ${formatBRL(-b.left)} acima`}</small>
            </li>`)}
        </ul>
      </article>`;
  },

  envelopes: ({ d, ym, today }) => {
    const list = envelopeStatus(d, ym, today);
    if (!list.length) return '';
    const tone = list.some((e) => e.left < 0) ? 'bad' : list.some((e) => e.pct > 80) ? 'warn' : 'good';
    return html`
      <article class="card tone-${tone}" data-key="envelopes">
        <header class="card__header"><h2 class="card__title">${icon('inbox')} Envelopes</h2><a class="link small" href="#/planejamento?aba=envelopes">Editar</a></header>
        <ul class="budgets">
          ${list.map((e) => html`
            <li class="budget">
              <span class="budget__name">${e.env.icon} ${e.env.name}</span>
              <span class="budget__value ${e.left < 0 ? 'state--over' : ''}">${formatBRL(e.left)} restam</span>
              ${meter(Math.min(e.spent, e.available), { max: e.available || 1, label: e.env.name, tone: e.left < 0 ? 'over' : e.pct > 80 ? 'warn' : '' })}
              <small class="muted">${formatBRL(e.spent)} de ${formatBRL(e.available)}${e.carry ? ` (inclui ${formatBRL(e.carry)} que sobrou)` : ''}</small>
            </li>`)}
        </ul>
      </article>`;
  },

  rule: ({ d, ym, today }) => {
    if (!d.settings.rule503020?.enabled) return '';
    const r = ruleStatus(d, ym, today);
    if (!r.income) return '';
    return html`
      <article class="card tone-${r.groups.every((g) => g.ok) ? 'good' : 'warn'}" data-key="rule">
        <header class="card__header"><h2 class="card__title">${icon('chart-pie')} Regra ${r.rule.needs}/${r.rule.wants}/${r.rule.savings}</h2>${helpTip('regra503020')}</header>
        <ul class="budgets">
          ${r.groups.map((g) => html`
            <li class="budget">
              <span class="budget__name">${GROUP_LABELS[g.key]}</span>
              <span class="budget__value ${g.ok ? '' : 'state--warn'}">${formatPercent(g.pct)} <small class="muted">/ ${g.target}%</small></span>
              ${meter(g.pct, { max: Math.max(100, g.pct), label: GROUP_LABELS[g.key], tone: g.ok ? 'good' : 'warn' })}
              <small class="muted">${formatBRL(g.cents)} · ${g.key === 'savings' ? `meta ${formatBRL(g.targetCents)}` : `limite ${formatBRL(g.targetCents)}`}</small>
            </li>`)}
        </ul>
      </article>`;
  },

  income: ({ m }) => {
    const list = m.income.extras;
    return html`
      <article class="card ${list.length ? 'tone-good' : ''}" data-key="income">
        <header class="card__header">
          <h2 class="card__title">${icon('stethoscope')} Receitas extras</h2>
          <button type="button" class="btn btn--ghost btn--sm" data-action="extra:new" ${m.closed ? 'disabled' : ''}>${icon('plus', 'icon--xs')} Adicionar</button>
        </header>
        ${list.length ? html`
          <ul class="mini-list">
            ${list.map((x) => html`
              <li>
                <span>${x.description}${x.date ? html` <small class="muted">${formatDateBR(x.date)}</small>` : ''}
                  ${x.payroll ? html`<span class="badge" title="Valor bruto pago na folha: sofre INSS e IR">na folha</span>` : html`<span class="badge badge--good" title="Não passa pela folha: valor líquido">fora da folha</span>`}
                  ${x.recurringIncomeId ? html`<span class="badge badge--muted" title="Repete todo mês">${icon('repeat', 'icon--xs')} todo mês</span>`
                    : x.auto ? html`<span class="badge badge--muted" title="Gerado pela escala de plantões">escala</span>` : ''}</span>
                <span class="money pos">+${formatBRL(x.cents)}</span>
                <span class="mini-list__actions">
                  ${x.recurringIncomeId ? html`
                    <button type="button" class="icon-btn icon-btn--sm" data-action="extra:rec-edit" data-id="${x.recurringIncomeId}" aria-label="Editar ${x.description} (todo mês)">${icon('pencil')}</button>
                    <button type="button" class="icon-btn icon-btn--sm" data-action="extra:rec-skip" data-id="${x.recurringIncomeId}" aria-label="Não recebi ${x.description} neste mês" ${m.closed ? 'disabled' : ''}>${icon('skip-forward')}</button>`
                  : x.auto ? html`<a class="icon-btn icon-btn--sm" href="#/salario?aba=plantoes" aria-label="Abrir a escala">${icon('calendar-days')}</a>` : html`
                    <button type="button" class="icon-btn icon-btn--sm" data-action="extra:edit" data-id="${x.id}" aria-label="Editar ${x.description}">${icon('pencil')}</button>
                    <button type="button" class="icon-btn icon-btn--sm" data-action="extra:delete" data-id="${x.id}" aria-label="Excluir ${x.description}">${icon('trash-2')}</button>`}
                </span>
              </li>`)}
          </ul>
          <p class="card__total">
            <span>${m.income.extrasGross !== m.income.extrasCents ? `Bruto ${formatBRL(m.income.extrasGross)} · líquido estimado` : 'Total de extras'}</span>
            <strong class="money pos">+${formatBRL(m.income.extrasCents)}</strong>
          </p>`
        : html`<p class="muted small">Plantões, horas extras, freelas, reembolsos e vendas deste mês entram aqui e somam na renda. Ganhos que se repetem (aluguel recebido, pensão, freela fixo) podem ser lançados como "todo mês".</p>`}
        ${m.income.benefits?.card?.length ? html`<p class="small muted">${icon('wallet-cards', 'icon--xs')} ${m.income.benefits.card.map((b) => `${b.name}: ${formatBRL(b.cents)}`).join(' · ')} (no cartão do benefício)</p>` : ''}
      </article>`;
  },

  invest: ({ d, today }) => {
    if (!d.investments?.length) return '';
    const pf = portfolio(d, today);
    const target = pf.investing.monthlyTargetCents;
    return html`
      <article class="card tone-${pf.totals.gain < 0 ? 'bad' : 'good'}" data-key="invest">
        <header class="card__header">
          <h2 class="card__title">${icon('coins')} Investimentos</h2>
          <a class="link small" href="#/investimentos">Ver carteira ${icon('arrow-right', 'icon--xs')}</a>
        </header>
        <p class="big-number money">${formatBRL(pf.totals.value)}</p>
        <p class="muted small">Rendimento <strong class="${pf.totals.gain < 0 ? 'neg' : 'pos'}">${pf.totals.gain < 0 ? '−' : '+'}${formatBRL(Math.abs(pf.totals.gain))}</strong> (${formatPercent(pf.totals.gainPct, 1)})</p>
        ${target ? html`
          ${meter(Math.max(0, pf.month.net), { max: target, label: 'Meta de aporte do mês', tone: pf.month.net >= target ? 'good' : '' })}
          <p class="muted small">Aportado no mês: ${formatBRL(pf.month.net)} de ${formatBRL(target)}</p>`
        : html`<p class="muted small">Aportado no mês: ${formatBRL(pf.month.net)}</p>`}
        <button type="button" class="btn btn--secondary btn--sm" data-action="invest:quick">${icon('plus', 'icon--xs')} Aportar</button>
      </article>`;
  },

  categories: ({ m }) => html`
    <article class="card" data-key="categories">
      <header class="card__header"><h2 class="card__title">${icon('chart-pie')} Gastos por categoria</h2><span class="muted small">toque numa fatia para ver as contas</span></header>
      ${donutChart(m.categories.map((c) => ({ label: c.name, value: c.cents, color: c.color, id: c.id })),
        { center: formatBRL(m.totals.all), centerSub: 'no mês', label: 'Gastos por categoria', action: 'dash:category' })}
    </article>`,

  history: ({ d, ym, today }) => {
    const series = monthSeries(d, ym, 6, today);
    return html`
      <article class="card" data-key="history">
        <header class="card__header">
          <h2 class="card__title">${icon('chart-column')} Renda × gastos — últimos 6 meses</h2>
          <a class="link" href="#/analise">Análise completa ${icon('arrow-right', 'icon--xs')}</a>
        </header>
        ${barChart(series.map((s) => formatMonthShort(s.ym)), [
          { name: 'Renda', values: series.map((s) => s.income), className: 'is-income' },
          { name: 'Gastos', values: series.map((s) => s.spent), className: 'is-spent' },
        ], { label: 'Renda, gastos e saldo dos últimos 6 meses', width: chartWidth(1), line: { name: 'Saldo', values: series.map((s) => s.balance), className: 'is-balance' }, action: 'dash:month', keys: series.map((s) => s.ym) })}
        <p class="muted small">Passe o mouse (ou toque) para ver os valores; clique num mês para abrir o relatório.</p>
      </article>`;
  },
};

function emptyList(filter, m) {
  if (!m.items.length) {
    return html`
      <div class="empty">
        ${icon('receipt', 'icon--lg')}
        <p><strong>Nenhuma conta neste mês.</strong></p>
        <p class="muted">Cadastre contas, recorrentes, parcelamentos e compras no cartão para acompanhar tudo aqui.</p>
        <button type="button" class="btn btn--primary" data-action="new:menu">${icon('plus')} Adicionar</button>
      </div>`;
  }
  return html`<div class="empty empty--sm">${filter === 'pending'
    ? html`${icon('circle-check', 'icon--lg pos')}<p><strong>Tudo pago neste mês!</strong></p>`
    : html`<p class="muted">Nenhuma conta paga ainda.</p>`}</div>`;
}

function backupReminder(d) {
  const hasData = d.expenses.length + d.recurring.length + d.installments.length + (d.cardPurchases || []).length > 0;
  if (!hasData) return '';
  // Os dados já ficam na nuvem (com histórico de versões): o backup em arquivo
  // é só uma cópia extra, lembrada de vez em quando
  if (store.guest) return '';
  const last = d.lastBackupAt ? diffDays(todayISO(new Date(d.lastBackupAt)), todayISO()) : null;
  if (last == null || last < 90) return '';
  return html`
    <div class="banner" role="note">
      ${icon('shield-check')}
      <p>Seu último backup em arquivo foi há ${last} dias. Os dados estão na nuvem; o backup é uma cópia extra, guardada com você.</p>
      <button type="button" class="btn btn--secondary btn--sm" data-action="backup:export">${icon('download', 'icon--xs')} Fazer backup</button>
    </div>`;
}

// ---------- Saúde financeira ----------

function ring(score, size = 120) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return html`
    <div class="score__ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="score-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ADE80"/><stop offset=".5" stop-color="#2DD4BF"/><stop offset="1" stop-color="#1E7BE8"/></linearGradient></defs>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="12" class="score__track"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="12" class="score__bar" style="--c:${c.toFixed(1)}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/>
      </svg>
      <div class="score__num"><strong>${score}</strong><small>de 100</small></div>
    </div>`;
}

function scoreDialog() {
  const today = todayISO();
  const s = financialScore(store.data, store.ui.ym, today);
  const hist = scoreHistory(store.data, store.ui.ym, 12, today);
  const withData = hist.filter((h) => h.score != null);
  openDialog({
    title: 'Saúde financeira',
    body: html`
      <div class="score score--${s.tone}">${ring(s.score, 104)}<div><p class="score__grade">${s.grade}</p><p class="muted small">Calculada com os últimos 3 meses. Atualiza sozinha.</p></div></div>
      ${s.caps.length ? html`<div class="note note--warn">${icon('triangle-alert')}<span>Sem esses problemas a nota seria <strong>${s.raw}</strong>. Limitada por: ${s.caps.map((c) => `${c.reason} (máx. ${c.max})`).join('; ')}.</span></div>` : ''}
      <ul class="factors" style="margin-top:16px">
        ${s.factors.map((f) => html`
          <li>
            <strong>${f.label}</strong><span class="muted small">${f.points}/${f.max}</span>
            ${meter(f.points, { max: f.max, label: f.label, tone: f.points / f.max >= 0.7 ? 'good' : f.points / f.max >= 0.4 ? 'warn' : 'bad' })}
            <small>${f.value} · ${f.tip}</small>
          </li>`)}
      </ul>
      ${withData.length >= 2 ? html`
        <h3 class="dialog__subtitle">Nota mês a mês</h3>
        ${lineChart(withData.map((h) => formatMonthShort(h.ym)), [{ name: 'Nota', values: withData.map((h) => h.score), className: 'is-balance' }], { label: 'Histórico da nota de saúde financeira', height: 160, width: 520, format: String })}
        <p class="field__hint">Meses fechados guardam a nota do fechamento; os outros são recalculados.</p>` : ''}`,
  });
}
