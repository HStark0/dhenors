// =============================================================
// Simulador "e se" — teste decisões antes de tomá-las
// -------------------------------------------------------------
// Mexa nos controles e veja, mês a mês, como fica o saldo
// comparado ao cenário atual. Nada é salvo: é só simulação.
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { lineChart, chartWidth } from '../ui/charts.js';
import { store } from '../core/store.js';
import { formatBRL, toCents } from '../core/money.js';
import { currentYM, addMonthsYM, formatMonthShort, formatMonth, todayISO } from '../core/dates.js';
import { simulate } from '../domain/planning.js';
import { installmentSummary, recurringActiveIn } from '../domain/ledger.js';

const DEFAULTS = { salaryPct: '', extra: '', parcel: '', count: '', cut: [], payoff: [], discount: '', cutVar: '', months: 12 };

export default {
  id: 'simulador',
  title: 'Simulador',

  render() {
    const d = store.data;
    const f = { ...DEFAULTS, ...store.ui.filters.sim };
    const from = addMonthsYM(currentYM(), 1);
    const today = todayISO();
    const scenario = {
      salaryPct: Number(String(f.salaryPct).replace(',', '.')) || 0,
      extraMonthlyCents: toCents(f.extra) || 0,
      purchase: { parcelCents: toCents(f.parcel) || 0, count: Number(f.count) || 0 },
      cutRecurring: f.cut,
      payoff: f.payoff,
      payoffDiscountPct: Number(String(f.discount).replace(',', '.')) || 0,
      cutVariablePct: Number(String(f.cutVar).replace(',', '.')) || 0,
    };
    const r = simulate(d, scenario, from, Number(f.months), today);
    const labels = r.base.map((p) => formatMonthShort(p.ym));
    const active = Object.entries(f).some(([k, v]) => k !== 'months' && (Array.isArray(v) ? v.length : v));
    const recurring = d.recurring.filter((x) => recurringActiveIn(x, from));
    const installments = d.installments.filter((x) => !installmentSummary(x).finished);
    const better = r.cumulativeDiff >= 0;

    return html`
      <div class="page-head">
        <p class="muted">A partir de ${formatMonth(from)} · nada aqui é salvo, é só simulação</p>
        <div class="page-head__actions">
          <div class="segmented" role="group" aria-label="Horizonte">
            ${[6, 12, 24].map((m) => html`<button type="button" class="segmented__btn" data-action="sim:months" data-months="${m}" aria-pressed="${Number(f.months) === m}">${m} meses</button>`)}
          </div>
          ${active ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="sim:reset">${icon('undo-2', 'icon--xs')} Limpar</button>` : ''}
        </div>
      </div>

      <section class="grid grid--sim">
        <article class="card sim-controls">
          <h2 class="card__title">${icon('wand-sparkles')} E se…</h2>

          ${control('salaryPct', 'Meu salário aumentar', '%', f.salaryPct, 'Ex.: 10 para +10% no salário base')}
          ${control('extra', 'Eu fizer uma renda extra todo mês', 'R$', f.extra, 'Ex.: plantões ou freelas a mais')}
          <div class="sim-pair">
            ${control('parcel', 'Eu comprar parcelado', 'R$', f.parcel, 'Valor da parcela')}
            ${control('count', 'em', '×', f.count, 'Nº de parcelas', 'numeric')}
          </div>
          ${control('cutVar', 'Eu cortar gastos do dia a dia em', '%', f.cutVar, 'Mercado, delivery, compras avulsas…')}

          ${recurring.length ? html`
            <fieldset class="sim-list">
              <legend class="field__label">Cancelar recorrentes</legend>
              ${recurring.map((x) => html`
                <label class="check check--sm"><input type="checkbox" data-filter="cut" data-id="${x.id}" ${f.cut.includes(x.id) ? 'checked' : ''}> ${x.description} <span class="muted">${formatBRL(x.cents)}/mês</span></label>`)}
            </fieldset>` : ''}

          ${installments.length ? html`
            <fieldset class="sim-list">
              <legend class="field__label">Quitar parcelamentos agora</legend>
              ${installments.map((x) => html`
                <label class="check check--sm"><input type="checkbox" data-filter="payoff" data-id="${x.id}" ${f.payoff.includes(x.id) ? 'checked' : ''}> ${x.description} <span class="muted">resta ${formatBRL(installmentSummary(x).remainingCents)}</span></label>`)}
              ${f.payoff.length ? control('discount', 'com desconto de', '%', f.discount, 'Desconto por antecipação (pergunte ao credor)') : ''}
            </fieldset>` : ''}
        </article>

        <div class="stack">
          <section class="grid grid--kpis grid--kpis-3">
            ${stat('Saldo acumulado hoje', formatBRL(r.cumulativeBase), `${f.months} meses sem mudanças`)}
            ${stat('Com a simulação', formatBRL(r.cumulativeScenario), active ? 'cenário escolhido' : 'mexa nos controles', active ? (better ? 'good' : 'bad') : '')}
            ${stat('Diferença', `${r.cumulativeDiff > 0 ? '+' : ''}${formatBRL(r.cumulativeDiff)}`, active ? (better ? 'você teria a mais' : 'você teria a menos') : '—', active ? (better ? 'good' : 'bad') : '')}
          </section>

          <article class="card">
            <header class="card__header"><h2 class="card__title">${icon('chart-line')} Saldo mês a mês</h2></header>
            ${lineChart(labels, [
              { name: 'Hoje', values: r.base.map((p) => p.balance), className: 'is-spent', dashed: true },
              { name: 'Simulação', values: r.scenario.map((p) => p.balance), className: 'is-balance' },
            ], { label: 'Saldo mensal atual e simulado', width: chartWidth(0.62) })}
          </article>

          <article class="card">
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th scope="col">Mês</th><th scope="col">Renda</th><th scope="col">Gastos</th><th scope="col">Saldo hoje</th><th scope="col">Saldo simulado</th><th scope="col">Diferença</th></tr></thead>
                <tbody>
                  ${r.scenario.map((p, i) => html`
                    <tr>
                      <th scope="row">${formatMonthShort(p.ym)}</th>
                      <td class="money">${formatBRL(p.salary + p.extras)}</td>
                      <td class="money">${formatBRL(p.spent)}</td>
                      <td class="money">${formatBRL(r.base[i].balance)}</td>
                      <td class="money strong ${p.balance < 0 ? 'neg' : ''}">${formatBRL(p.balance)}</td>
                      <td class="money ${r.diff[i] > 0 ? 'pos' : r.diff[i] < 0 ? 'neg' : ''}">${r.diff[i] ? `${r.diff[i] > 0 ? '+' : ''}${formatBRL(r.diff[i])}` : '—'}</td>
                    </tr>`)}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>`;
  },

  actions: {
    'sim:months': (el) => setSim({ months: Number(el.dataset.months) }),
    'sim:reset': () => setSim({ ...DEFAULTS, months: store.ui.filters.sim?.months || 12 }, true),
  },

  onFilter(name, value, el) {
    const f = { ...DEFAULTS, ...store.ui.filters.sim };
    if (name === 'cut' || name === 'payoff') {
      const set = new Set(f[name]);
      if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id);
      return setSim({ [name]: [...set] });
    }
    setSim({ [name]: value });
  },
};

function setSim(patch, replace = false) {
  const current = replace ? {} : { ...DEFAULTS, ...store.ui.filters.sim };
  store.setUI({ filters: { ...store.ui.filters, sim: { ...current, ...patch } } });
}

function control(name, label, unit, value, hint, mode = 'decimal') {
  const id = `sim-${name}`;
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${label}</label>
      <div class="field__control has-prefix">
        <span class="field__prefix" aria-hidden="true">${unit}</span>
        <input class="input" id="${id}" data-filter="${name}" value="${value}" inputmode="${mode}" autocomplete="off" placeholder="0">
      </div>
      <p class="field__hint">${hint}</p>
    </div>`;
}

function stat(label, value, sub, tone = '') {
  return html`
    <article class="card kpi ${tone ? `kpi--${tone}` : ''}">
      <div class="kpi__body">
        <p class="kpi__label">${label}</p>
        <p class="kpi__value money">${value}</p>
        <p class="kpi__sub">${sub}</p>
      </div>
    </article>`;
}
