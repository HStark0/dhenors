// =============================================================
// Análise — tendências, comparações, histórico e retrospectiva
// -------------------------------------------------------------
// Abas: Período · Comparar · Histórico (fechamento e relatórios) ·
// Saúde (nota mês a mês) · Retrospectiva do ano
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { barChart, lineChart, donutChart, meter, chartWidth } from '../ui/charts.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { catIcon } from '../ui/catIcon.js';
import { confetti } from '../ui/confetti.js';
import { store } from '../core/store.js';
import { formatBRL, formatPercent, percent } from '../core/money.js';
import { formatMonth, formatMonthShort, formatMonthTitle, formatDateBR, currentYM, todayISO, addMonthsYM } from '../core/dates.js';
import {
  periodAnalysis, projection, endingInstallments, spendingAnomalies, comparePeriods, monthsWithData, monthSummary,
  buildSnapshot, monthlyReport, yearWrapped,
} from '../domain/analysis.js';
import { financialScore, scoreHistory } from '../domain/planning.js';
import { adviceFor } from '../domain/advice.js';
import { futureWeight, futureWeightSummary } from '../domain/weights.js';
import { yearPlan } from '../domain/yearplan.js';
import { adviceList, monthStrip, weightList } from '../ui/outlookUI.js';
import { helpTip } from '../ui/help.js';
import * as A from '../domain/actions.js';
import { APP_VERSION } from '../version.js';

const PERIODS = [3, 6, 12];
const TABS = [
  { id: 'periodo', label: 'Período', icon: 'chart-line', monthNav: true },
  { id: 'comparar', label: 'Comparar', icon: 'git-compare' },
  { id: 'historico', label: 'Histórico', icon: 'history' },
  { id: 'saude', label: 'Saúde', icon: 'gauge' },
  { id: 'retrospectiva', label: 'Retrospectiva', icon: 'party-popper' },
];

export default {
  id: 'analise',
  title: 'Análise',
  get monthNav() { return currentTab(TABS) === 'periodo'; },

  render() {
    const active = currentTab(TABS);
    const R = { periodo: period, comparar: compare, historico: historyTab, saude: health, retrospectiva: wrapped };
    return html`${tabsNav('analise', TABS, active)}${R[active]()}`;
  },

  actions: {
    'an:period': (el) => store.setUI({ filters: { ...store.ui.filters, analysisMonths: Number(el.dataset.months) } }),
    'an:month': (el) => report(el.dataset.key),
    'an:category': (el) => {
      store.setUI({ filters: { ...store.ui.filters, bills: { ...(store.ui.filters.bills || {}), category: el.dataset.id, status: '' } } });
      location.hash = '#/contas?aba=mes';
    },
    'cmp:preset': (el) => store.setUI({ filters: { ...store.ui.filters, cmp: presets()[el.dataset.preset] } }),
    'hist:report': (el) => report(el.dataset.ym),
    'hist:report-current': () => report(store.ui.ym),
    'hist:close': async (el) => {
      const ym = el.dataset.ym;
      const ok = await confirmDialog({ title: `Fechar ${formatMonth(ym)}`, message: 'Os números serão congelados (com o relatório automático do mês) e o mês fica bloqueado para edições. Você pode reabrir depois.', confirmLabel: 'Fechar mês' });
      if (ok) { A.closeMonth(ym); toast(`${formatMonth(ym)} fechado.`); report(ym); }
    },
    'hist:reopen': async (el) => {
      const ym = el.dataset.ym;
      const ok = await confirmDialog({ title: `Reabrir ${formatMonth(ym)}`, message: 'O mês volta a aceitar edições e os números passam a ser recalculados. A fotografia salva no fechamento será descartada.', confirmLabel: 'Reabrir' });
      if (ok) { A.reopenMonth(ym); toast(`${formatMonth(ym)} reaberto.`, { action: { label: 'Desfazer', run: () => store.undo() } }); }
    },
    'wrap:year': (el) => store.setUI({ filters: { ...store.ui.filters, wrapYear: Number(el.dataset.year) } }),
    'wrap:party': () => confetti(),
  },

  onFilter(name, value) {
    if (name.startsWith('cmp:')) {
      const k = name.slice(4);
      const cur = store.ui.filters.cmp || presets().quarter;
      store.setUI({ filters: { ...store.ui.filters, cmp: { ...cur, [k]: value } } });
    }
  },
};

// ---------- Período ----------

function stat(label, value, sub, tone = '') {
  return html`
    <article class="card kpi ${tone ? `kpi--${tone}` : ''}">
      <div class="kpi__body">
        <p class="kpi__label">${label}</p>
        <p class="kpi__value">${value}</p>
        <p class="kpi__sub">${sub}</p>
      </div>
    </article>`;
}

function period() {
  const d = store.data;
  const ym = store.ui.ym;
  const months = store.ui.filters.analysisMonths || 6;
  const today = todayISO();
  const a = periodAnalysis(d, ym, months, today);
  const labels = a.series.map((s) => formatMonthShort(s.ym));
  const proj = projection(d, currentYM(), 6, today);
  const ending = endingInstallments(d, currentYM()).slice(0, 8);
  const anomalies = spendingAnomalies(d, ym, today);
  const advice = adviceFor(d, ym, today);
  const weight = futureWeight(d, ym, today);
  const outlook = yearPlan(d, currentYM(), 12, today).months.slice(0, 6);

  return html`
    <div class="page-head">
      <p class="muted">${formatMonth(a.series[0].ym)} a ${formatMonth(ym)}</p>
      <div class="page-head__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-action="export:open" data-kind="summary">${icon('download', 'icon--xs')} Exportar</button>
        <div class="segmented" role="group" aria-label="Período">
          ${PERIODS.map((p) => html`<button type="button" class="segmented__btn" data-action="an:period" data-months="${p}" aria-pressed="${p === months}">${p} meses</button>`)}
        </div>
      </div>
    </div>

    <section class="grid grid--kpis" aria-label="Indicadores do período">
      ${stat('Renda média', formatBRL(a.avgIncome), `${formatBRL(a.avgExtras)} de extras/mês`, a.avgIncome > 0 ? 'good' : '')}
      ${stat('Gasto médio', formatBRL(a.avgSpent), `${formatBRL(a.spent)} no período`, !a.avgIncome ? '' : a.avgSpent > a.avgIncome ? 'bad' : a.avgSpent > a.avgIncome * 0.8 ? 'warn' : '')}
      ${stat('Taxa de poupança', formatPercent(a.savingsRate), a.savingsRate >= 20 ? 'Ótimo (meta: 20%+)' : a.savingsRate >= 0 ? 'Meta saudável: 20%' : 'Gastando mais que ganha', a.savingsRate >= 20 ? 'good' : a.savingsRate < 0 ? 'bad' : 'warn')}
      ${stat('Custos fixos', formatPercent(a.fixedRate), 'recorrentes + parcelas / renda', a.fixedRate > 60 ? 'bad' : a.fixedRate > 40 ? 'warn' : a.avgIncome ? 'good' : '')}
    </section>

    ${anomalies.length ? html`
      <article class="card card--alert">
        <h2 class="card__title">${icon('triangle-alert')} Gastos fora do padrão em ${formatMonth(ym)}</h2>
        <ul class="mini-list">
          ${anomalies.slice(0, 5).map((x) => html`<li><span><strong>${x.name}</strong>${x.parent ? html` <small class="muted">${x.parent}</small>` : ''} está <strong>${formatPercent(x.pct)} acima</strong> da sua média</span><span class="money">${formatBRL(x.cents)} <small class="muted">média ${formatBRL(x.median)}</small></span></li>`)}
        </ul>
        <p class="field__hint">Comparado com a mediana dos últimos 6 meses (só aparece com pelo menos 3 meses de histórico).</p>
      </article>` : ''}

    <section class="grid grid--two grid--top">
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('lightbulb')} Dicas para ${formatMonth(ym)} e os próximos meses ${helpTip('dicas')}</h2></header>
        ${adviceList(advice, { limit: 5 })}
      </article>
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('hourglass')} O que ${formatMonth(ym)} deixa para depois ${helpTip('pesoFuturo')}</h2></header>
        ${weight.count ? html`
          <p class="small"><strong>${futureWeightSummary(weight)}.</strong></p>
          ${weightList(weight, 8)}`
        : html`<p class="muted small">Nada lançado neste mês continua comprometendo os próximos.</p>`}
      </article>
    </section>

    <section class="grid grid--two">
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('chart-column')} Renda × gastos</h2><span class="muted small">clique num mês para o relatório</span></header>
        ${barChart(labels, [
          { name: 'Renda', values: a.series.map((s) => s.income), className: 'is-income' },
          { name: 'Gastos', values: a.series.map((s) => s.spent), className: 'is-spent' },
        ], { label: 'Renda, gastos e saldo por mês', width: chartWidth(0.5), line: { name: 'Saldo', values: a.series.map((s) => s.balance), className: 'is-balance' }, action: 'an:month', keys: a.series.map((s) => s.ym) })}
      </article>
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('chart-line')} Saldo de cada mês</h2></header>
        ${lineChart(labels, [{ name: 'Saldo', values: a.series.map((s) => s.balance), className: 'is-balance' }], { label: 'Saldo por mês', width: chartWidth(0.5), action: 'an:month', keys: a.series.map((s) => s.ym) })}
      </article>
    </section>

    <section class="grid grid--two">
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('chart-pie')} Para onde foi o dinheiro</h2><span class="muted small">toque numa fatia para ver as contas</span></header>
        ${donutChart(a.categories.map((c) => ({ label: c.name, value: c.cents, color: c.color, id: d.categories.find((x) => x.name === c.name)?.id })),
          { center: formatBRL(a.spent), centerSub: `em ${months} meses`, max: 7, label: 'Gastos por categoria no período', action: 'an:category' })}
      </article>
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('layers')} Fixos × variáveis</h2></header>
        ${barChart(labels, [
          { name: 'Fixos (recorrentes + parcelas)', values: a.series.map((s) => s.fixed), className: 'is-fixed' },
          { name: 'Variáveis (avulsas e cartão)', values: a.series.map((s) => s.variable), className: 'is-variable' },
        ], { label: 'Gastos fixos e variáveis por mês', width: chartWidth(0.5) })}
        ${a.extras > 0 ? html`
          <div class="note">
            ${icon('stethoscope')}
            <p><strong>${formatPercent(a.extrasShare)}</strong> da sua renda no período veio de extras (plantões etc.).
            ${a.extrasShare > 25 ? 'É uma parte grande: evite assumir custos fixos contando com ela.' : ''}</p>
          </div>` : ''}
      </article>
    </section>

    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('trending-up')} Projeção dos próximos 6 meses</h2></header>
      <p class="muted small">Considera salário, 13º, férias, benefícios, receitas recorrentes, recorrentes, parcelas e faturas agendadas e uma estimativa de gastos avulsos (mediana dos últimos 3 meses; gastos grandes somam por cima). Renda extra avulsa futura só entra se já estiver lançada.</p>
      ${lineChart(proj.map((p) => formatMonthShort(p.ym)), [
        { name: 'Saldo projetado', values: proj.map((p) => p.balance), className: 'is-balance' },
        { name: 'Compromissos', values: proj.map((p) => p.spent), className: 'is-spent', dashed: true },
      ], { label: 'Projeção de saldo e compromissos', width: chartWidth(1) })}
      ${monthStrip(outlook)}
    </article>

    <section class="grid grid--two">
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('calendar-range')} Parcelamentos terminando</h2></header>
        ${ending.length ? html`
          <ul class="mini-list">
            ${ending.map((e) => html`<li><span>${e.description} <small class="muted">última em ${formatMonthShort(e.lastYM)}</small></span><span class="money pos">+${formatBRL(e.monthlyCents)}/mês livre</span></li>`)}
          </ul>` : html`<p class="muted small">Nenhum parcelamento em andamento.</p>`}
      </article>
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('tags')} Maiores categorias</h2></header>
        ${a.categories.length ? html`
          <ul class="rank">
            ${a.categories.slice(0, 6).map((c) => html`
              <li>
                <span class="rank__label">${catIcon(d.categories.find((x) => x.name === c.name) || c, { size: 'xs' })} ${c.name}</span>
                <span class="money">${formatBRL(Math.round(c.cents / (a.months || 1)))}<small>/mês</small></span>
                ${meter(c.cents, { max: a.categories[0].cents, label: c.name })}
              </li>`)}
          </ul>` : html`<p class="muted small">Sem gastos no período.</p>`}
      </article>
    </section>`;
}

// ---------- Comparar períodos ----------

function presets() {
  const now = currentYM();
  const q = (ym) => addMonthsYM(ym, -((Number(ym.slice(5)) - 1) % 3));
  const thisQ = q(now);
  return {
    quarter: { aFrom: thisQ, aTo: now, bFrom: addMonthsYM(thisQ, -12), bTo: addMonthsYM(now, -12) },
    month: { aFrom: now, aTo: now, bFrom: addMonthsYM(now, -12), bTo: addMonthsYM(now, -12) },
    semester: { aFrom: addMonthsYM(now, -5), aTo: now, bFrom: addMonthsYM(now, -11), bTo: addMonthsYM(now, -6) },
    year: { aFrom: `${now.slice(0, 4)}-01`, aTo: now, bFrom: `${Number(now.slice(0, 4)) - 1}-01`, bTo: addMonthsYM(now, -12) },
  };
}

function compare() {
  const d = store.data;
  const f = store.ui.filters.cmp || presets().quarter;
  const r = comparePeriods(d, { from: f.aFrom, to: f.aTo }, { from: f.bFrom, to: f.bTo }, todayISO());
  const row = (label, x, upGood = false) => html`
    <tr><th scope="row">${label}</th><td class="money">${formatBRL(x.a)}</td><td class="money">${formatBRL(x.b)}</td>
      <td class="money ${x.diff === 0 ? '' : (x.diff > 0) === upGood ? 'pos' : 'neg'}">${x.diff > 0 ? '+' : ''}${formatBRL(x.diff)}${x.pct != null ? html` <small>(${x.pct > 0 ? '+' : ''}${formatPercent(x.pct)})</small>` : ''}</td></tr>`;
  const period = (p) => `${formatMonthShort(p.from)}${p.from !== p.to ? ` a ${formatMonthShort(p.to)}` : ''}`;
  return html`
    <article class="card">
      <h2 class="card__title">${icon('git-compare')} Comparar períodos</h2>
      <div class="segmented" role="group" aria-label="Atalhos">
        <button type="button" class="segmented__btn" data-action="cmp:preset" data-preset="quarter">Trimestre × ano passado</button>
        <button type="button" class="segmented__btn" data-action="cmp:preset" data-preset="month">Mês × ano passado</button>
        <button type="button" class="segmented__btn" data-action="cmp:preset" data-preset="semester">Últimos 6 × 6 anteriores</button>
        <button type="button" class="segmented__btn" data-action="cmp:preset" data-preset="year">Ano até agora × ano passado</button>
      </div>
      <div class="form-grid form-grid--4 cmp-range">
        <div class="field"><label class="field__label" for="cmp-af">Período A: de</label><input class="input" type="month" id="cmp-af" data-filter="cmp:aFrom" value="${f.aFrom}"></div>
        <div class="field"><label class="field__label" for="cmp-at">até</label><input class="input" type="month" id="cmp-at" data-filter="cmp:aTo" value="${f.aTo}"></div>
        <div class="field"><label class="field__label" for="cmp-bf">Período B: de</label><input class="input" type="month" id="cmp-bf" data-filter="cmp:bFrom" value="${f.bFrom}"></div>
        <div class="field"><label class="field__label" for="cmp-bt">até</label><input class="input" type="month" id="cmp-bt" data-filter="cmp:bTo" value="${f.bTo}"></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col"></th><th scope="col">A · ${period(r.a)}</th><th scope="col">B · ${period(r.b)}</th><th scope="col">Diferença</th></tr></thead>
          <tbody>
            ${row('Renda', r.income, true)}
            ${row('Gastos', r.spent)}
            ${row('Fixos', r.fixed)}
            ${row('Variáveis', r.variable)}
            ${row('Saldo', r.balance, true)}
          </tbody>
        </table>
      </div>
    </article>
    <article class="card">
      <h2 class="card__title">${icon('tags')} Por categoria</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col">Categoria</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Diferença</th></tr></thead>
          <tbody>${r.rows.map((x) => html`<tr><th scope="row">${x.name}</th><td class="money">${formatBRL(x.a)}</td><td class="money">${formatBRL(x.b)}</td>
            <td class="money ${x.diff > 0 ? 'neg' : x.diff < 0 ? 'pos' : ''}">${x.diff > 0 ? '+' : ''}${formatBRL(x.diff)}${x.pct != null ? html` <small>(${x.pct > 0 ? '+' : ''}${formatPercent(x.pct)})</small>` : ''}</td></tr>`)}</tbody>
        </table>
      </div>
    </article>`;
}

// ---------- Histórico ----------

function historyTab() {
  const d = store.data;
  const today = todayISO();
  const months = monthsWithData(d, today);
  if (!months.length) {
    return html`
      <div class="card empty">
        ${icon('history', 'icon--lg')}
        <p><strong>Nada no histórico ainda.</strong></p>
        <p class="muted">Os meses aparecem aqui conforme você lança renda e contas. Ao fechar um mês, os números ficam congelados e o app gera o relatório do mês.</p>
      </div>`;
  }
  return html`
    <p class="muted page-intro">Fechar um mês guarda uma "fotografia" dos números, a nota de saúde e um relatório automático ("você gastou 12% menos com delivery"). Nada é apagado e você pode reabrir quando quiser.</p>
    <article class="card">
      <div class="table-wrap">
        <table class="table table--history">
          <thead>
            <tr><th scope="col">Mês</th><th scope="col">Renda</th><th scope="col">Gastos</th><th scope="col">Saldo</th><th scope="col">Situação</th><th scope="col"><span class="sr-only">Ações</span></th></tr>
          </thead>
          <tbody>
            ${months.map((ym) => {
              const s = monthSummary(d, ym, today);
              return html`
                <tr>
                  <th scope="row">${formatMonthTitle(ym)}</th>
                  <td class="money">${formatBRL(s.income)}</td>
                  <td class="money">${formatBRL(s.spent)}</td>
                  <td class="money strong ${s.balance < 0 ? 'neg' : 'pos'}">${formatBRL(s.balance)}</td>
                  <td>${s.closed
                    ? html`<span class="badge badge--muted">${icon('lock', 'icon--xs')} Fechado${d.scoreHistory?.[ym] != null ? ` · nota ${d.scoreHistory[ym]}` : ''}</span>`
                    : html`<span class="badge">${ym === currentYM() ? 'Mês atual' : 'Aberto'}</span>`}</td>
                  <td><div class="table__actions">
                    <button type="button" class="btn btn--ghost btn--sm" data-action="hist:report" data-ym="${ym}">Relatório</button>
                    ${s.closed
                      ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="hist:reopen" data-ym="${ym}">${icon('lock-open', 'icon--xs')} Reabrir</button>`
                      : html`<button type="button" class="btn btn--ghost btn--sm" data-action="hist:close" data-ym="${ym}">${icon('lock', 'icon--xs')} Fechar</button>`}
                  </div></td>
                </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </article>`;
}

/** Relatório do mês (usa a fotografia se fechado), pronto para imprimir/salvar em PDF com a marca. */
export function report(ym) {
  const d = store.data;
  const today = todayISO();
  const snap = d.closedMonths[ym] || buildSnapshot(d, ym, today);
  const rep = snap.report || monthlyReport(d, ym, today);
  const t = snap.totals;
  const top = [...snap.items].sort((a, b) => b.cents - a.cents).slice(0, 10);
  const score = snap.score ?? financialScore(d, ym, ym === currentYM() ? today : `${ym}-28`).score;

  openDialog({
    title: `Relatório de ${formatMonth(ym)}`,
    size: 'lg',
    footer: html`<button type="button" class="btn btn--secondary" data-print>${icon('printer')} Imprimir / salvar PDF</button>`,
    body: html`
      <div class="report report--brand">
        <header class="report__brand">
          <img src="${document.querySelector('img[src*="logo-64"], img[src^="data:image"]')?.src || 'assets/icons/logo-64.png'}" alt="" width="36" height="36">
          <div><strong>Dhenors</strong><span>Relatório mensal · ${formatMonthTitle(ym)}${d.settings.profileName ? ` · ${d.settings.profileName}` : ''}</span></div>
        </header>
        <p class="muted small">${d.closedMonths[ym] ? `Mês fechado em ${formatDateBR(snap.closedOn || snap.closedAt.slice(0, 10))}.` : 'Mês em aberto — valores calculados agora.'}</p>
        <div class="kv kv--4">
          <div><span>Renda</span><strong class="money">${formatBRL(snap.income.total)}</strong></div>
          <div><span>Gastos</span><strong class="money">${formatBRL(t.all)}</strong></div>
          <div><span>Saldo</span><strong class="money ${snap.balance < 0 ? 'neg' : 'pos'}">${formatBRL(snap.balance)}</strong></div>
          <div><span>Saúde financeira</span><strong>${score}/100</strong></div>
        </div>

        ${rep.highlights.length ? html`
          <h3 class="dialog__subtitle">Resumo do mês</h3>
          <ul class="tips">${rep.highlights.map((h) => html`<li>${h}</li>`)}</ul>` : ''}

        <h3 class="dialog__subtitle">Composição</h3>
        <ul class="mini-list">
          ${snap.income.payroll ? html`
            <li><span>Bruto da folha</span><span class="money">${formatBRL(snap.income.payroll.gross)}</span></li>
            <li><span>INSS + Imposto de Renda</span><span class="money neg">−${formatBRL(snap.income.payroll.inss + snap.income.payroll.ir)}</span></li>
            ${snap.income.payroll.deductions ? html`<li><span>Descontos em folha</span><span class="money neg">−${formatBRL(snap.income.payroll.deductions)}</span></li>` : ''}` : ''}
          <li><span>Salário líquido</span><span class="money">${formatBRL(snap.income.salary)}</span></li>
          ${snap.income.extras.map((x) => html`<li><span>${x.description}${x.payroll ? ' (bruto, na folha)' : ''}</span><span class="money pos">+${formatBRL(x.cents)}</span></li>`)}
          ${snap.income.extras.length ? html`<li><span>Extras (líquido)</span><span class="money pos">+${formatBRL(snap.income.extrasCents)}</span></li>` : ''}
          <li><span>Contas avulsas</span><span class="money">${formatBRL(t.expense)}</span></li>
          <li><span>Recorrentes</span><span class="money">${formatBRL(t.recurring)}</span></li>
          <li><span>Parcelas</span><span class="money">${formatBRL(t.installment)}</span></li>
          ${t.invoice ? html`<li><span>Faturas de cartão</span><span class="money">${formatBRL(t.invoice)}</span></li>` : ''}
          <li><span>Pago / não pago</span><span class="money">${formatBRL(t.paid)} / ${formatBRL(t.pending)}</span></li>
        </ul>

        <h3 class="dialog__subtitle">Por categoria</h3>
        ${snap.categories.length ? html`
          <ul class="rank">
            ${snap.categories.map((c) => html`
              <li>
                <span class="rank__label">${c.name}</span>
                <span class="money">${formatBRL(c.cents)} <small>${formatPercent(percent(c.cents, t.all))}</small></span>
                ${meter(c.cents, { max: snap.categories[0].cents, label: c.name })}
              </li>`)}
          </ul>` : html`<p class="muted small">Sem gastos.</p>`}

        <h3 class="dialog__subtitle">Maiores lançamentos</h3>
        ${top.length ? html`
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col">Valor</th></tr></thead>
              <tbody>
                ${top.map((i) => html`
                  <tr>
                    <td>${formatDateBR(i.dueDate)}</td>
                    <td>${i.description}${i.parcel ? ` (${i.parcel.n}/${i.parcel.count})` : ''}${i.paid ? '' : html` <span class="badge badge--bad">não pago</span>`}</td>
                    <td>${i.category}</td>
                    <td class="money">${formatBRL(i.cents)}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>` : html`<p class="muted small">Nenhum lançamento.</p>`}
        <footer class="report__foot">Gerado pelo Dhenors ${APP_VERSION} em ${formatDateBR(today)}</footer>
      </div>`,
    onMount: (dlg) => dlg.querySelector('[data-print]').addEventListener('click', () => {
      document.body.classList.add('is-printing');
      window.print();
      document.body.classList.remove('is-printing');
    }),
  });
}

// ---------- Saúde (histórico da nota) ----------

function health() {
  const d = store.data;
  const today = todayISO();
  const hist = scoreHistory(d, currentYM(), 12, today);
  const withData = hist.filter((h) => h.score != null);
  const now = financialScore(d, currentYM(), today);
  return html`
    <section class="grid grid--kpis grid--kpis-3">
      ${stat('Nota agora', `${now.score}/100`, now.grade, now.tone === 'bad' ? 'bad' : now.tone === 'warn' ? 'warn' : 'good')}
      ${stat('Melhor nota (12 meses)', withData.length ? `${Math.max(...withData.map((h) => h.score))}` : '—', withData.length ? formatMonthShort(withData.reduce((a, h) => (h.score > a.score ? h : a)).ym) : '')}
      ${stat('Média (12 meses)', withData.length ? `${Math.round(withData.reduce((a, h) => a + h.score, 0) / withData.length)}` : '—', `${withData.length} meses com dados`)}
    </section>
    <article class="card">
      <h2 class="card__title">${icon('gauge')} Nota de saúde financeira mês a mês</h2>
      ${withData.length >= 2 ? lineChart(withData.map((h) => formatMonthShort(h.ym)), [{ name: 'Nota', values: withData.map((h) => h.score), className: 'is-balance' }], { label: 'Histórico da nota', width: chartWidth(1), format: String })
        : html`<p class="muted">A nota aparece aqui mês a mês conforme você usa o app. Meses fechados guardam a nota do fechamento.</p>`}
      <p class="field__hint">A nota considera quanto sobra da renda, custos fixos, contas em dia, reserva de emergência e gastos do mês × renda e meta. Atrasos e meta estourada limitam a nota máxima.</p>
    </article>`;
}

// ---------- Retrospectiva do ano ----------

function wrapped() {
  const d = store.data;
  const thisYear = Number(currentYM().slice(0, 4));
  const year = store.ui.filters.wrapYear || (Number(currentYM().slice(5)) <= 2 ? thisYear - 1 : thisYear);
  const w = yearWrapped(d, year, todayISO());
  return html`
    <div class="page-head">
      <div class="segmented" role="group" aria-label="Ano">
        ${[thisYear - 1, thisYear].map((y) => html`<button type="button" class="segmented__btn" data-action="wrap:year" data-year="${y}" aria-pressed="${y === year}">${y}</button>`)}
      </div>
      <button type="button" class="btn btn--ghost btn--sm" data-action="wrap:party">${icon('party-popper', 'icon--xs')} Comemorar</button>
    </div>
    <section class="wrapped">
      <article class="card hero wrapped__hero">
        <p class="hero__label">Seu ${year} no Dhenors</p>
        <p class="hero__value money">${formatBRL(w.saved)}</p>
        <p class="hero__formula"><span>${w.saved >= 0 ? 'guardados' : 'no vermelho'} · ${formatPercent(w.savedPct)} da renda em ${w.months} meses</span></p>
      </article>
      <div class="wrapped__grid">
        <article class="card"><p class="kpi__label">Renda no ano</p><p class="big-number money">${formatBRL(w.income)}</p></article>
        <article class="card"><p class="kpi__label">Gastos no ano</p><p class="big-number money">${formatBRL(w.spent)}</p></article>
        <article class="card"><p class="kpi__label">Investido (líquido)</p><p class="big-number money">${formatBRL(w.invested)}</p></article>
        <article class="card"><p class="kpi__label">Metas batidas</p><p class="big-number">${w.goalsReached.length}</p><p class="small muted">${w.goalsReached.map((g) => `${g.icon} ${g.description}`).join(' · ')}</p></article>
        ${w.shifts ? html`<article class="card"><p class="kpi__label">Plantões</p><p class="big-number">${w.shifts}</p></article>` : ''}
        ${w.bestMonth ? html`<article class="card"><p class="kpi__label">Melhor mês</p><p class="big-number">${formatMonthShort(w.bestMonth.ym)}</p><p class="small muted">sobrou ${formatBRL(w.bestMonth.balance)}</p></article>` : ''}
      </div>
      <section class="grid grid--two">
        <article class="card">
          <h2 class="card__title">${icon('chart-pie')} Onde mais gastou</h2>
          <ol class="rank">${w.topCategories.map((c) => html`<li><span class="rank__label">${c.name}</span><span class="money">${formatBRL(c.cents)}</span>${meter(c.cents, { max: w.topCategories[0].cents, label: c.name })}</li>`)}</ol>
        </article>
        <article class="card">
          <h2 class="card__title">${icon('receipt')} Maiores gastos</h2>
          <ol class="mini-list">${w.biggest.map((i) => html`<li><span>${i.description} <small class="muted">${formatDateBR(i.dueDate)}</small></span><span class="money">${formatBRL(i.cents)}</span></li>`)}</ol>
        </article>
      </section>
    </section>`;
}
