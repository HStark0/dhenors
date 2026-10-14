// =============================================================
// Análise — tendências do período e projeção dos próximos meses
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { barChart, lineChart, donutChart, meter, chartWidth } from '../ui/charts.js';
import { store } from '../core/store.js';
import { formatBRL, formatPercent } from '../core/money.js';
import { formatMonth, formatMonthShort, currentYM, todayISO } from '../core/dates.js';
import { periodAnalysis, projection, endingInstallments } from '../domain/analysis.js';

const PERIODS = [3, 6, 12];

export default {
  id: 'analise',
  title: 'Análise',
  monthNav: true,

  render() {
    const d = store.data;
    const ym = store.ui.ym;
    const months = store.ui.filters.analysisMonths || 6;
    const today = todayISO();
    const a = periodAnalysis(d, ym, months, today);
    const labels = a.series.map((s) => formatMonthShort(s.ym));
    const proj = projection(d, currentYM(), 6, today);
    const ending = endingInstallments(d, currentYM()).slice(0, 8);

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
        ${stat('Renda média', formatBRL(a.avgIncome), `${formatBRL(a.avgExtras)} de extras/mês`)}
        ${stat('Gasto médio', formatBRL(a.avgSpent), `${formatBRL(a.spent)} no período`)}
        ${stat('Taxa de poupança', formatPercent(a.savingsRate), a.savingsRate >= 20 ? 'Ótimo (meta: 20%+)' : a.savingsRate >= 0 ? 'Meta saudável: 20%' : 'Gastando mais que ganha', a.savingsRate >= 20 ? 'good' : a.savingsRate < 0 ? 'bad' : 'warn')}
        ${stat('Custos fixos', formatPercent(a.fixedRate), 'recorrentes + parcelas / renda', a.fixedRate > 50 ? 'warn' : '')}
      </section>

      <section class="grid grid--two">
        <article class="card">
          <header class="card__header"><h2 class="card__title">Renda × gastos</h2></header>
          ${barChart(labels, [
            { name: 'Renda', values: a.series.map((s) => s.income), className: 'is-income' },
            { name: 'Gastos', values: a.series.map((s) => s.spent), className: 'is-spent' },
          ], { label: 'Renda e gastos por mês', width: chartWidth(0.5) })}
        </article>
        <article class="card">
          <header class="card__header"><h2 class="card__title">Saldo de cada mês</h2></header>
          ${lineChart(labels, [{ name: 'Saldo', values: a.series.map((s) => s.balance), className: 'is-balance' }], { label: 'Saldo por mês', width: chartWidth(0.5) })}
        </article>
      </section>

      <section class="grid grid--two">
        <article class="card">
          <header class="card__header"><h2 class="card__title">Para onde foi o dinheiro</h2></header>
          ${donutChart(a.categories.map((c) => ({ label: `${c.icon} ${c.name}`, value: c.cents, color: c.color })),
            { center: formatBRL(a.spent), centerSub: `em ${months} meses`, max: 7, label: 'Gastos por categoria no período' })}
        </article>
        <article class="card">
          <header class="card__header"><h2 class="card__title">Fixos × variáveis</h2></header>
          ${barChart(labels, [
            { name: 'Fixos (recorrentes + parcelas)', values: a.series.map((s) => s.fixed), className: 'is-fixed' },
            { name: 'Variáveis (avulsas)', values: a.series.map((s) => s.variable), className: 'is-variable' },
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
        <header class="card__header">
          <h2 class="card__title">${icon('trending-up')} Projeção dos próximos 6 meses</h2>
        </header>
        <p class="muted small">Considera salário, recorrentes, parcelas agendadas e uma estimativa de gastos avulsos (mediana dos últimos 3 meses). Renda extra futura só entra se já estiver lançada.</p>
        ${lineChart(proj.map((p) => formatMonthShort(p.ym)), [
          { name: 'Saldo projetado', values: proj.map((p) => p.balance), className: 'is-balance' },
          { name: 'Compromissos', values: proj.map((p) => p.spent), className: 'is-spent', dashed: true },
        ], { label: 'Projeção de saldo e compromissos', width: chartWidth(1) })}
        <div class="table-wrap">
          <table class="table">
            <caption class="sr-only">Projeção mês a mês</caption>
            <thead><tr><th scope="col">Mês</th><th scope="col">Renda</th><th scope="col">Recorrentes</th><th scope="col">Parcelas</th><th scope="col">Avulsas (est.)</th><th scope="col">Saldo</th></tr></thead>
            <tbody>
              ${proj.map((p) => html`
                <tr>
                  <th scope="row">${formatMonthShort(p.ym)}</th>
                  <td class="money">${formatBRL(p.salary + p.extras)}</td>
                  <td class="money">${formatBRL(p.recurring)}</td>
                  <td class="money">${formatBRL(p.installment)}</td>
                  <td class="money">${formatBRL(p.variable)}</td>
                  <td class="money strong ${p.balance < 0 ? 'neg' : 'pos'}">${formatBRL(p.balance)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </article>

      <section class="grid grid--two">
        <article class="card">
          <header class="card__header"><h2 class="card__title">${icon('credit-card')} Parcelamentos terminando</h2></header>
          ${ending.length ? html`
            <ul class="mini-list">
              ${ending.map((e) => html`
                <li>
                  <span>${e.description} <small class="muted">última em ${formatMonthShort(e.lastYM)}</small></span>
                  <span class="money pos">+${formatBRL(e.monthlyCents)}/mês livre</span>
                </li>`)}
            </ul>` : html`<p class="muted small">Nenhum parcelamento em andamento.</p>`}
        </article>
        <article class="card">
          <header class="card__header"><h2 class="card__title">Maiores categorias</h2></header>
          ${a.categories.length ? html`
            <ul class="rank">
              ${a.categories.slice(0, 6).map((c) => html`
                <li>
                  <span class="rank__label">${c.icon} ${c.name}</span>
                  <span class="money">${formatBRL(Math.round(c.cents / (a.months || 1)))}<small>/mês</small></span>
                  ${meter(c.cents, { max: a.categories[0].cents, label: c.name })}
                </li>`)}
            </ul>` : html`<p class="muted small">Sem gastos no período.</p>`}
        </article>
      </section>`;
  },

  actions: {
    'an:period': (el) => store.setUI({ filters: { ...store.ui.filters, analysisMonths: Number(el.dataset.months) } }),
  },
};

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

