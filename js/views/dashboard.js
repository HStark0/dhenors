// =============================================================
// Painel — visão geral do mês exibido
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { donutChart, barChart, meter, chartWidth } from '../ui/charts.js';
import { itemList } from '../ui/items.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, percent, formatPercent, plural } from '../core/money.js';
import {
  currentYM, todayISO, formatMonth, formatMonthShort, diffDays, formatDateBR, relativeDays,
} from '../core/dates.js';
import { computeMonth, overdueBefore } from '../domain/ledger.js';
import { nextPaydayFrom } from '../domain/payroll.js';
import { financialScore, budgetStatus } from '../domain/planning.js';
import { insightsFor, monthSeries } from '../domain/analysis.js';
import * as A from '../domain/actions.js';
import { cloud } from '../core/cloud.js';

const FILTERS = [
  { id: 'pending', label: 'A pagar' },
  { id: 'all', label: 'Todas' },
  { id: 'paid', label: 'Pagas' },
];

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
    const filter = store.ui.filters.dashboard || 'pending';
    const older = isCurrent ? overdueBefore(d, ym, today) : [];

    const shown = m.items.filter((i) =>
      filter === 'all' ? true : filter === 'paid' ? i.status === 'paid' : i.status !== 'paid');

    return html`
      ${backupReminder(d)}
      <section class="grid grid--hero">
        ${hero(m, isCurrent, today)}
        ${limitCard(m, d.settings.spendingLimitCents)}
      </section>

      <section class="grid grid--kpis" aria-label="Resumo do mês">
        ${incomeKpi(m)}
        ${kpi('receipt', 'Contas avulsas', m.totals.expense, count(m.items, 'expense'))}
        ${kpi('repeat', 'Recorrentes', m.totals.recurring, count(m.items, 'recurring'))}
        ${kpi('credit-card', 'Parcelas', m.totals.installment, count(m.items, 'installment'))}
      </section>

      <section class="masonry">
          ${older.length ? html`
            <article class="card card--alert">
              <header class="card__header">
                <h2 class="card__title">${icon('triangle-alert')} Atrasadas de meses anteriores</h2>
                <span class="money neg">${formatBRL(older.reduce((a, i) => a + i.cents, 0))}</span>
              </header>
              ${itemList(older, { showMonth: true })}
            </article>` : ''}

          <article class="card">
            <header class="card__header">
              <h2 class="card__title">Contas de ${formatMonth(ym)}</h2>
              <div class="segmented" role="group" aria-label="Filtrar contas">
                ${FILTERS.map((f) => html`
                  <button type="button" class="segmented__btn" data-action="dash:filter" data-filter="${f.id}" aria-pressed="${filter === f.id}">${f.label}</button>`)}
              </div>
            </header>
            ${shown.length ? itemList(shown) : emptyList(filter, m)}
            <footer class="card__footer">
              <a class="link" href="#/contas">Ver lista completa ${icon('arrow-right', 'icon--xs')}</a>
            </footer>
          </article>
          ${scoreCard(d, ym, today)}
          ${budgetsCard(d, ym, today)}
          ${extraIncomeCard(m)}
          <article class="card">
            <header class="card__header"><h2 class="card__title">Gastos por categoria</h2></header>
            ${donutChart(m.categories.map((c) => ({ label: `${c.icon} ${c.name}`, value: c.cents, color: c.color })),
              { center: formatBRL(m.totals.all), centerSub: 'no mês', label: 'Gastos por categoria' })}
          </article>
          ${insightsCard(d, m, today)}
      </section>

      ${historyCard(d, ym, today)}`;
  },

  actions: {
    'score:open': () => scoreDialog(),
    'dash:payslip': (el) => { store.setUI({ ym: el.dataset.ym }); location.hash = '#/salario'; },
    'dash:filter': (el) => store.setUI({ filters: { ...store.ui.filters, dashboard: el.dataset.filter } }),
    'salary:edit': () => E.editSalaryBase(store.ui.ym),
    'limit:edit': () => E.editSpendingLimit(),
    'extra:new': () => E.editExtraIncome(),
    'extra:edit': (el) => E.editExtraIncome(store.data.extraIncomes.find((x) => x.id === el.dataset.id)),
    'extra:delete': (el) => {
      const x = store.data.extraIncomes.find((i) => i.id === el.dataset.id);
      if (x) E.confirmDelete(`"${x.description}" (${formatBRL(x.cents)})`, () => A.deleteExtraIncome(x.id));
    },
    'month:close': async () => {
      const ym = store.ui.ym;
      const m = computeMonth(store.data, ym);
      const pending = m.items.filter((i) => i.status !== 'paid');
      const ok = await confirmDialog({
        title: `Fechar ${formatMonth(ym)}`,
        message: `Os números do mês serão guardados no Histórico e o mês fica bloqueado para edições.${pending.length ? ` Atenção: ${plural(pending.length, 'conta ainda não paga', 'contas ainda não pagas')} — ${pending.length === 1 ? 'ela continuará' : 'elas continuarão'} aparecendo como atrasadas até serem pagas.` : ''} Você pode reabrir depois.`,
        confirmLabel: 'Fechar mês',
      });
      if (ok) { A.closeMonth(ym); toast(`${formatMonth(ym)} fechado e salvo no Histórico.`); }
    },
  },
};

// ---------- Blocos ----------

function hero(m, isCurrent, today) {
  const s = store.data.settings;
  const usedPct = percent(m.totals.all, m.income.total);
  const negative = m.balance < 0;
  const payday = nextPaydayFrom(s, today);
  const daysToPay = Math.max(1, diffDays(today, payday));
  const perDay = isCurrent && m.balance > 0 ? Math.floor(m.balance / daysToPay) : null;
  const canClose = m.ym <= currentYM() && !m.closed;

  return html`
    <article class="card hero ${negative ? 'hero--negative' : ''}">
      <div class="hero__top">
        <p class="hero__label">Saldo previsto de ${formatMonth(m.ym)}</p>
        ${m.closed
          ? html`<span class="badge badge--muted">${icon('lock', 'icon--xs')} Mês fechado</span>`
          : canClose ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="month:close">${icon('lock', 'icon--xs')} Fechar mês</button>` : ''}
      </div>
      <p class="hero__value money ${negative ? 'neg' : ''}">${negative ? '−' : ''}${formatBRL(Math.abs(m.balance))}</p>
      <p class="hero__formula">
        <span>${formatBRL(m.income.total)} de renda</span>
        <span aria-hidden="true">−</span>
        <span>${formatBRL(m.totals.all)} em contas</span>
      </p>
      ${meter(m.totals.all, { max: m.income.total || m.totals.all || 1, label: `Renda comprometida: ${formatPercent(usedPct)}`, tone: usedPct > 100 ? 'bad' : usedPct > 85 ? 'warn' : '' })}
      <p class="hero__meter-label">${m.income.total ? `${formatPercent(usedPct)} da renda comprometida` : 'Cadastre seu salário para ver o quanto da renda está comprometida.'}</p>

      <dl class="hero__chips">
        <div class="chip chip--paid"><dt>Pago</dt><dd class="money">${formatBRL(m.totals.paid)}</dd></div>
        <div class="chip chip--pending"><dt>A pagar</dt><dd class="money">${formatBRL(m.totals.pending - m.totals.overdue)}</dd></div>
        <div class="chip chip--overdue"><dt>Em atraso</dt><dd class="money">${formatBRL(m.totals.overdue)}</dd></div>
      </dl>

      ${isCurrent ? html`
        <div class="hero__payday">
          ${icon('calendar')}
          <span>Próximo salário: <strong>${formatDateBR(payday)}</strong> (${relativeDays(payday, today)})</span>
          ${perDay != null ? html`<span class="hero__perday">Dá para gastar <strong>${formatBRL(perDay)}/dia</strong> até lá</span>` : ''}
        </div>` : ''}
    </article>`;
}

function limitCard(m, limit) {
  if (!limit) {
    return html`
      <article class="card card--center">
        ${icon('target', 'icon--lg muted')}
        <h2 class="card__title">Meta de gastos</h2>
        <p class="muted">Defina um teto mensal e acompanhe aqui.</p>
        <button type="button" class="btn btn--secondary" data-action="limit:edit">Definir meta</button>
      </article>`;
  }
  const used = percent(m.totals.all, limit);
  const tone = used > 100 ? 'bad' : used >= 80 ? 'warn' : 'good';
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('target')} Meta de gastos</h2>
        <button type="button" class="icon-btn" data-action="limit:edit" aria-label="Editar meta de gastos">${icon('pencil')}</button>
      </header>
      <p class="big-number money">${formatPercent(used)}</p>
      ${meter(m.totals.all, { max: limit, label: 'Uso da meta de gastos', tone })}
      <p class="muted small">${formatBRL(m.totals.all)} de ${formatBRL(limit)} ·
        ${used <= 100 ? `restam ${formatBRL(limit - m.totals.all)}` : `${formatBRL(m.totals.all - limit)} acima`}</p>
    </article>`;
}

function kpi(ic, label, cents, sub, tone = '') {
  return html`
    <article class="card kpi ${tone ? `kpi--${tone}` : ''}">
      <span class="kpi__icon">${icon(ic)}</span>
      <div class="kpi__body">
        <p class="kpi__label">${label}</p>
        <p class="kpi__value money">${formatBRL(cents)}</p>
        <p class="kpi__sub">${sub}</p>
      </div>
    </article>`;
}

/** Renda líquida, com acesso ao contracheque. */
function incomeKpi(m) {
  const p = m.income.payroll;
  const taxes = p.inss + p.ir.value;
  const sub = p.legacyNet || !p.hasProfile
    ? `${formatBRL(m.income.salary)} salário${m.income.extrasCents ? ` + ${formatBRL(m.income.extrasCents)} extras` : ''}`
    : `bruto ${formatBRL(m.income.gross)} · impostos ${formatBRL(taxes)}${p.deductionsTotal ? ` · descontos ${formatBRL(p.deductionsTotal)}` : ''}`;
  return html`
    <article class="card kpi kpi--income">
      <span class="kpi__icon">${icon('wallet')}</span>
      <div class="kpi__body">
        <p class="kpi__label">Renda líquida do mês</p>
        <p class="kpi__value money">${formatBRL(m.income.total)}</p>
        <p class="kpi__sub">${sub}${m.income.competence && m.income.competence !== m.ym ? ` · holerite de ${formatMonthShort(m.income.competence)}` : ''}</p>
        <a class="link kpi__link" href="#/salario" data-action="dash:payslip" data-ym="${m.income.competence || m.ym || store.ui.ym}">Ver contracheque ${icon('arrow-right', 'icon--xs')}</a>
      </div>
      <button type="button" class="icon-btn kpi__action" data-action="salary:edit" aria-label="Editar salário">${icon('pencil')}</button>
    </article>`;
}

function count(items, kind) {
  const list = items.filter((i) => i.kind === kind);
  const open = list.filter((i) => i.status !== 'paid').length;
  if (!list.length) return 'nenhuma no mês';
  return `${list.length} no mês · ${open ? `${open} a pagar` : 'tudo pago'}`;
}

function emptyList(filter, m) {
  if (!m.items.length) {
    return html`
      <div class="empty">
        ${icon('receipt', 'icon--lg')}
        <p><strong>Nenhuma conta neste mês.</strong></p>
        <p class="muted">Cadastre contas, recorrentes e parcelamentos para acompanhar tudo aqui.</p>
        <button type="button" class="btn btn--primary" data-action="new:menu">${icon('plus')} Adicionar</button>
      </div>`;
  }
  return html`<div class="empty empty--sm">${filter === 'pending'
    ? html`${icon('circle-check', 'icon--lg pos')}<p><strong>Tudo pago neste mês!</strong></p>`
    : html`<p class="muted">Nenhuma conta paga ainda.</p>`}</div>`;
}

function extraIncomeCard(m) {
  const list = m.income.extras;
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('stethoscope')} Renda extra</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="extra:new" ${m.closed ? 'disabled' : ''}>${icon('plus', 'icon--xs')} Adicionar</button>
      </header>
      ${list.length ? html`
        <ul class="mini-list">
          ${list.map((x) => html`
            <li>
              <span>${x.description}${x.date ? html` <small class="muted">${formatDateBR(x.date)}</small>` : ''}
                ${x.payroll ? html`<span class="badge" title="Valor bruto pago na folha: sofre INSS e IR">na folha</span>` : ''}</span>
              <span class="money pos">+${formatBRL(x.cents)}</span>
              <span class="mini-list__actions">
                <button type="button" class="icon-btn icon-btn--sm" data-action="extra:edit" data-id="${x.id}" aria-label="Editar ${x.description}">${icon('pencil')}</button>
                <button type="button" class="icon-btn icon-btn--sm" data-action="extra:delete" data-id="${x.id}" aria-label="Excluir ${x.description}">${icon('trash-2')}</button>
              </span>
            </li>`)}
        </ul>
        <p class="card__total">
          <span>${m.income.extrasGross !== m.income.extrasCents ? `Bruto ${formatBRL(m.income.extrasGross)} · líquido estimado` : 'Total de extras'}</span>
          <strong class="money pos">+${formatBRL(m.income.extrasCents)}</strong>
        </p>`
      : html`<p class="muted small">Plantões, horas extras ou freelas deste mês entram aqui e somam na renda.</p>`}
    </article>`;
}

function insightsCard(d, m, today) {
  const list = insightsFor(d, m, today);
  if (!list.length) return '';
  const ICON = { good: 'trending-up', warn: 'triangle-alert', bad: 'triangle-alert', info: 'sparkles' };
  return html`
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('sparkles')} Insights</h2></header>
      <ul class="insights">
        ${list.map((i) => html`
          <li class="insight insight--${i.tone}">
            ${icon(ICON[i.tone])}
            <div><strong>${i.title}</strong><p>${i.text}</p></div>
          </li>`)}
      </ul>
    </article>`;
}

function historyCard(d, ym, today) {
  const series = monthSeries(d, ym, 6, today);
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">Renda × gastos — últimos 6 meses</h2>
        <a class="link" href="#/analise">Análise completa ${icon('arrow-right', 'icon--xs')}</a>
      </header>
      ${barChart(series.map((s) => formatMonthShort(s.ym)), [
        { name: 'Renda', values: series.map((s) => s.income), className: 'is-income' },
        { name: 'Gastos', values: series.map((s) => s.spent), className: 'is-spent' },
      ], { label: 'Renda e gastos dos últimos 6 meses', width: chartWidth(1) })}
    </article>`;
}

function backupReminder(d) {
  const hasData = d.expenses.length + d.recurring.length + d.installments.length > 0;
  if (!hasData || cloud.linked) return '';
  const last = d.lastBackupAt ? diffDays(todayISO(new Date(d.lastBackupAt)), todayISO()) : null;
  if (last != null && last < 30) return '';
  return html`
    <div class="banner" role="note">
      ${icon('shield-check')}
      <p>${last == null
        ? html`Seus dados ficam só neste aparelho. Ligue a <button type="button" class="link" data-action="cloud:open">nuvem</button> para acessar de qualquer lugar, ou faça um backup.`
        : `Seu último backup foi há ${last} dias.`}</p>
      <button type="button" class="btn btn--secondary btn--sm" data-action="backup:export">${icon('download', 'icon--xs')} Fazer backup</button>
    </div>`;
}

// ---------- Saúde financeira e orçamentos ----------

function ring(score, size = 120) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return html`
    <div class="score__ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="score-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#06B6D4"/></linearGradient></defs>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="12" class="score__track"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke-width="12" class="score__bar" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/>
      </svg>
      <div class="score__num"><strong>${score}</strong><small>de 100</small></div>
    </div>`;
}

function scoreCard(d, ym, today) {
  const s = financialScore(d, ym, today);
  const worst = [...s.factors].sort((a, b) => a.points / a.max - b.points / b.max)[0];
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('gauge')} Saúde financeira</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="score:open">Detalhes ${icon('arrow-right', 'icon--xs')}</button>
      </header>
      <div class="score score--${s.tone}">
        ${ring(s.score)}
        <div>
          <p class="score__grade">${s.grade}</p>
          <p class="muted small">Para melhorar: ${worst.tip}</p>
        </div>
      </div>
    </article>`;
}

function scoreDialog() {
  const s = financialScore(store.data, store.ui.ym, todayISO());
  openDialog({
    title: 'Saúde financeira',
    size: 'sm',
    body: html`
      <div class="score score--${s.tone}">${ring(s.score, 104)}<div><p class="score__grade">${s.grade}</p><p class="muted small">Calculada com os últimos 3 meses. Atualiza sozinha.</p></div></div>
      <ul class="factors" style="margin-top:16px">
        ${s.factors.map((f) => html`
          <li>
            <strong>${f.label}</strong><span class="muted small">${f.points}/${f.max}</span>
            ${meter(f.points, { max: f.max, label: f.label, tone: f.points / f.max >= 0.7 ? 'good' : f.points / f.max >= 0.4 ? 'warn' : 'bad' })}
            <small>${f.value} · ${f.tip}</small>
          </li>`)}
      </ul>`,
  });
}

function budgetsCard(d, ym, today) {
  const list = budgetStatus(d, ym, today);
  if (!list.length) {
    return html`
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('scale')} Orçamentos</h2></header>
        <p class="muted small">Defina um teto por categoria (mercado, lazer, transporte…) e acompanhe aqui quanto ainda pode gastar.</p>
        <a class="link" href="#/categorias">Definir orçamentos ${icon('arrow-right', 'icon--xs')}</a>
      </article>`;
  }
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('scale')} Orçamentos do mês</h2>
        <a class="link small" href="#/categorias">Editar</a>
      </header>
      <ul class="budgets">
        ${list.slice(0, 6).map((b) => html`
          <li class="budget">
            <span class="budget__name">${b.icon} ${b.name}</span>
            <span class="budget__value ${b.tone === 'bad' ? 'neg' : ''}">${formatBRL(b.spent)} / ${formatBRL(b.budget)}</span>
            ${meter(Math.min(b.spent, b.budget), { max: b.budget, label: `${b.name}: ${formatPercent(b.pct)}`, tone: b.tone === 'good' ? '' : b.tone })}
            <small class="muted">${b.left >= 0 ? `Ainda pode gastar ${formatBRL(b.left)}` : `Passou ${formatBRL(-b.left)} do limite`}</small>
          </li>`)}
      </ul>
    </article>`;
}
