// =============================================================
// Planejamento — simular, olhar o futuro e organizar o dinheiro
// -------------------------------------------------------------
// Abas: Simulador (com cenários salvos e comparação lado a lado) ·
// Fluxo diário · Ano (12 meses) · Posso comprar? · Envelopes · 50/30/20
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { lineChart, barChart, chartWidth, meter } from '../ui/charts.js';
import { tabsNav, currentTab, routeParams } from '../ui/tabs.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { helpTip } from '../ui/help.js';
import { field, switchField, catText } from '../ui/forms.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, toCents, formatPercent, sumCents } from '../core/money.js';
import { currentYM, addMonthsYM, formatMonthShort, formatMonth, todayISO, formatDateBR, weekdayLong } from '../core/dates.js';
import { simulate, dailyCashflow, spendingRoom } from '../domain/planning.js';
import { installmentSummary, recurringActiveIn } from '../domain/ledger.js';
import { yearPlan, canIBuy } from '../domain/yearplan.js';
import { envelopeStatus, ruleStatus } from '../domain/analysis.js';
import { GROUP_LABELS } from '../domain/defaults.js';
import * as A from '../domain/actions.js';

const TABS = [
  { id: 'simulador', label: 'Simulador', icon: 'wand-sparkles' },
  { id: 'fluxo', label: 'Fluxo diário', icon: 'activity' },
  { id: 'ano', label: '12 meses', icon: 'calendar-range' },
  { id: 'comprar', label: 'Posso comprar?', icon: 'calculator' },
  { id: 'envelopes', label: 'Envelopes', icon: 'inbox' },
  { id: 'regra', label: '50/30/20', icon: 'chart-pie' },
];

const DEFAULTS = { salaryPct: '', extra: '', parcel: '', count: '', cut: [], payoff: [], discount: '', cutVar: '', months: 12 };

export default {
  id: 'planejamento',
  title: 'Planejamento',

  render() {
    const active = currentTab(TABS);
    const R = { simulador: simulator, fluxo: cashflow, ano: year, comprar: canBuy, envelopes, regra: rule };
    return html`${tabsNav('planejamento', TABS, active)}${R[active]()}`;
  },

  actions: {
    'sim:months': (el) => setSim({ months: Number(el.dataset.months) }),
    'sim:reset': () => setSim({ ...DEFAULTS, months: store.ui.filters.sim?.months || 12 }, true),
    'sim:save': () => saveScenarioDialog(),
    'sim:load': (el) => { const s = store.data.settings.scenarios.find((x) => x.id === el.dataset.id); if (s) setSim({ ...DEFAULTS, ...s.scenario.form }, true); },
    'sim:delete': (el) => E.deleteWithUndo(() => A.deleteScenario(el.dataset.id), 'Cenário excluído.'),
    'sim:compare': (el) => {
      const set = new Set(store.ui.filters.simCompare || []);
      if (set.has(el.dataset.id)) set.delete(el.dataset.id); else set.add(el.dataset.id);
      store.setUI({ filters: { ...store.ui.filters, simCompare: [...set].slice(0, 3) } });
    },
    'buy:check': () => { /* o resultado é recalculado a cada digitação */ },
    'env:new': () => E.editEnvelope(),
    'env:edit': (el) => E.editEnvelope(store.data.settings.envelopes.find((e) => e.id === el.dataset.id)),
    'env:delete': (el) => E.deleteWithUndo(() => A.deleteEnvelope(el.dataset.id), 'Envelope excluído.'),
    'rule:save': () => ruleDialog(),
  },

  onFilter(name, value, el) {
    if (name.startsWith('buy:')) {
      const key = name.slice(4);
      return store.setUI({ filters: { ...store.ui.filters, buy: { ...(store.ui.filters.buy || {}), [key]: value } } });
    }
    const f = { ...DEFAULTS, ...store.ui.filters.sim };
    if (name === 'cut' || name === 'payoff') {
      const set = new Set(f[name]);
      if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id);
      return setSim({ [name]: [...set] });
    }
    return setSim({ [name]: value });
  },
};

function setSim(patch, replace = false) {
  const current = replace ? {} : { ...DEFAULTS, ...store.ui.filters.sim };
  store.setUI({ filters: { ...store.ui.filters, sim: { ...current, ...patch } } });
}

const scenarioOf = (f) => ({
  salaryPct: Number(String(f.salaryPct).replace(',', '.')) || 0,
  extraMonthlyCents: toCents(f.extra) || 0,
  purchase: { parcelCents: toCents(f.parcel) || 0, count: Number(f.count) || 0 },
  cutRecurring: f.cut,
  payoff: f.payoff,
  payoffDiscountPct: Number(String(f.discount).replace(',', '.')) || 0,
  cutVariablePct: Number(String(f.cutVar).replace(',', '.')) || 0,
});

// ---------- Simulador ----------

function simulator() {
  const d = store.data;
  const f = { ...DEFAULTS, ...store.ui.filters.sim };
  const from = addMonthsYM(currentYM(), 1);
  const today = todayISO();
  const r = simulate(d, scenarioOf(f), from, Number(f.months), today);
  const labels = r.base.map((p) => formatMonthShort(p.ym));
  const active = Object.entries(f).some(([k, v]) => k !== 'months' && (Array.isArray(v) ? v.length : v));
  const recurring = d.recurring.filter((x) => recurringActiveIn(x, from));
  const installments = d.installments.filter((x) => !installmentSummary(x).finished);
  const better = r.cumulativeDiff >= 0;
  const saved = d.settings.scenarios || [];
  const compare = (store.ui.filters.simCompare || []).map((id) => saved.find((s) => s.id === id)).filter(Boolean);
  const compared = compare.map((s) => ({ s, r: simulate(d, scenarioOf({ ...DEFAULTS, ...s.scenario.form }), from, Number(f.months), today) }));

  return html`
    <div class="page-head">
      <p class="muted">A partir de ${formatMonth(from)} · nada aqui muda seus dados, é só simulação</p>
      <div class="page-head__actions">
        <div class="segmented" role="group" aria-label="Horizonte">
          ${[6, 12, 24].map((m) => html`<button type="button" class="segmented__btn" data-action="sim:months" data-months="${m}" aria-pressed="${Number(f.months) === m}">${m} meses</button>`)}
        </div>
        ${active ? html`
          <button type="button" class="btn btn--secondary btn--sm" data-action="sim:save">${icon('save', 'icon--xs')} Salvar cenário</button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="sim:reset">${icon('undo-2', 'icon--xs')} Limpar</button>` : ''}
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
              <label class="check check--sm"><input type="checkbox" data-filter="cut" data-id="${x.id}" ${f.cut.includes(x.id) ? 'checked' : ''}> ${x.description} <span class="muted">${formatBRL(x.cents)}</span></label>`)}
          </fieldset>` : ''}
        ${installments.length ? html`
          <fieldset class="sim-list">
            <legend class="field__label">Quitar parcelamentos agora</legend>
            ${installments.map((x) => html`
              <label class="check check--sm"><input type="checkbox" data-filter="payoff" data-id="${x.id}" ${f.payoff.includes(x.id) ? 'checked' : ''}> ${x.description} <span class="muted">resta ${formatBRL(installmentSummary(x).remainingCents)}</span></label>`)}
            ${f.payoff.length ? control('discount', 'com desconto de', '%', f.discount, 'Desconto por antecipação (pergunte ao credor)') : ''}
          </fieldset>` : ''}
        ${saved.length ? html`
          <fieldset class="sim-list">
            <legend class="field__label">Cenários salvos</legend>
            <ul class="mini-list mini-list--compact">
              ${saved.map((s) => html`<li>
                <label class="check check--sm"><input type="checkbox" data-action="sim:compare" data-id="${s.id}" ${compare.includes(s) ? 'checked' : ''} aria-label="Comparar ${s.name}"> ${s.name}</label>
                <span class="mini-list__actions">
                  <button type="button" class="btn btn--ghost btn--sm" data-action="sim:load" data-id="${s.id}">Abrir</button>
                  <button type="button" class="icon-btn icon-btn--sm danger" data-action="sim:delete" data-id="${s.id}" aria-label="Excluir ${s.name}">${icon('trash-2')}</button>
                </span></li>`)}
            </ul>
            <p class="field__hint">Marque até 3 para comparar lado a lado.</p>
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
            ...compared.map((c, i) => ({ name: c.s.name, values: c.r.scenario.map((p) => p.balance), className: `is-cmp${i + 1}` })),
          ], { label: 'Saldo mensal atual, simulado e cenários salvos', width: chartWidth(0.62) })}
        </article>

        ${compared.length ? html`
          <article class="card">
            <header class="card__header"><h2 class="card__title">${icon('columns-3')} Cenários lado a lado</h2></header>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th scope="col">Cenário</th><th scope="col">Saldo acumulado</th><th scope="col">Diferença</th><th scope="col">Pior mês</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Sem mudanças</th><td class="money">${formatBRL(r.cumulativeBase)}</td><td>—</td><td class="money">${formatBRL(Math.min(...r.base.map((p) => p.balance)))}</td></tr>
                  ${active ? html`<tr><th scope="row">Atual (não salvo)</th><td class="money">${formatBRL(r.cumulativeScenario)}</td><td class="money ${r.cumulativeDiff >= 0 ? 'pos' : 'neg'}">${formatBRL(r.cumulativeDiff)}</td><td class="money">${formatBRL(Math.min(...r.scenario.map((p) => p.balance)))}</td></tr>` : ''}
                  ${compared.map((c) => html`<tr><th scope="row">${c.s.name}</th><td class="money">${formatBRL(c.r.cumulativeScenario)}</td><td class="money ${c.r.cumulativeDiff >= 0 ? 'pos' : 'neg'}">${formatBRL(c.r.cumulativeDiff)}</td><td class="money">${formatBRL(Math.min(...c.r.scenario.map((p) => p.balance)))}</td></tr>`)}
                </tbody>
              </table>
            </div>
          </article>` : ''}

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
}

function saveScenarioDialog() {
  const f = { ...DEFAULTS, ...store.ui.filters.sim };
  openDialog({
    title: 'Salvar cenário',
    size: 'sm',
    submitLabel: 'Salvar',
    body: field({ label: 'Nome', name: 'name', required: true, placeholder: 'Ex.: Aumento de 10% + corte de streaming', extra: { maxlength: 60 } }),
    onSubmit: (form) => { A.saveScenario(form.name.value, { form: f }); toast('Cenário salvo.'); },
  });
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

// ---------- Fluxo diário ----------

function cashflow() {
  const d = store.data;
  const today = todayISO();
  const flow = dailyCashflow(d, today);
  const room = spendingRoom(d, today);
  const days = flow.points;
  const events = days.filter((p) => p.events.length);
  return html`
    <section class="grid grid--kpis grid--kpis-3">
      ${stat('Dinheiro agora', formatBRL(room.cash), room.source === 'accounts' ? 'saldo das suas contas' : 'estimado pelos lançamentos')}
      ${stat('Menor saldo no período', formatBRL(flow.min.balance), `${formatDateBR(flow.min.date)} (${weekdayLong(flow.min.date)})`, flow.min.balance < 0 ? 'bad' : '')}
      ${stat('Dá para gastar por dia', formatBRL(room.perDay), `até o salário de ${formatDateBR(room.nextPay)}`, room.perDay ? 'good' : 'bad')}
    </section>
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('activity')} Saldo dia a dia até ${formatDateBR(days[days.length - 1].date)}</h2></header>
      ${lineChart(days.map((p) => `${p.date.slice(8)}/${p.date.slice(5, 7)}`), [{ name: 'Saldo previsto', values: days.map((p) => p.balance), className: 'is-balance' }],
        { label: 'Fluxo de caixa diário', width: chartWidth(1), area: true, marks: [{ index: days.indexOf(flow.min), label: 'aperta' }, ...(days.findIndex((p) => p.date === room.nextPay) >= 0 ? [{ index: days.findIndex((p) => p.date === room.nextPay), label: 'salário' }] : [])] })}
      ${room.source === 'estimate' ? html`<p class="field__hint">Para um fluxo exato, cadastre suas contas bancárias com o saldo de hoje em <a href="#/carteira?aba=contas">Cartões e contas bancárias</a>.</p>` : ''}
    </article>
    <article class="card">
      <h2 class="card__title">${icon('calendar')} O que entra e sai</h2>
      ${events.length ? html`
        <ul class="mini-list">
          ${events.map((p) => html`<li class="${p.balance < 0 ? 'is-negative' : ''}"><span><strong>${formatDateBR(p.date)}</strong> <small class="muted">${weekdayLong(p.date)}</small><br><small>${p.events.join(' · ')}</small></span>
            <span class="money">${p.in ? html`<span class="pos">+${formatBRL(p.in)}</span> ` : ''}${p.out ? html`<span class="neg">−${formatBRL(p.out)}</span>` : ''}</span>
            <span class="money strong ${p.balance < 0 ? 'neg' : ''}">${formatBRL(p.balance)}</span></li>`)}
        </ul>` : html`<p class="muted">Nada agendado no período.</p>`}
    </article>`;
}

// ---------- 12 meses ----------

function year() {
  const d = store.data;
  const start = currentYM();
  const plan = yearPlan(d, start, 12, todayISO());
  return html`
    <section class="grid grid--kpis grid--kpis-3">
      ${stat('Renda em 12 meses', formatBRL(plan.totals.income), 'com 13º, férias e benefícios')}
      ${stat('Gastos previstos', formatBRL(plan.totals.spent), 'fixos, parcelas e dia a dia (média)')}
      ${stat('Sobra prevista', formatBRL(plan.totals.balance), plan.tightMonths.length ? `${plan.tightMonths.length} mês(es) apertado(s)` : 'nenhum mês apertado', plan.totals.balance < 0 ? 'bad' : plan.tightMonths.length ? 'warn' : 'good')}
    </section>
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('calendar-range')} Próximos 12 meses</h2></header>
      ${barChart(plan.months.map((m) => formatMonthShort(m.ym)), [
        { name: 'Renda', values: plan.months.map((m) => m.income), className: 'is-income' },
        { name: 'Gastos', values: plan.months.map((m) => m.spent), className: 'is-spent' },
      ], { label: 'Renda e gastos previstos por mês', width: chartWidth(1), line: { name: 'Sobra', values: plan.months.map((m) => m.balance), className: 'is-balance' } })}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col">Mês</th><th scope="col">Renda</th><th scope="col">Fixos</th><th scope="col">Parcelas</th><th scope="col">Dia a dia</th><th scope="col">Sobra</th><th scope="col">Destaques</th></tr></thead>
          <tbody>
            ${plan.months.map((m) => html`
              <tr class="${m.tight ? 'is-tight' : ''}">
                <th scope="row">${formatMonthShort(m.ym)}${m.tight ? html` <span class="badge badge--warn">aperta</span>` : ''}</th>
                <td class="money">${formatBRL(m.income)}</td>
                <td class="money">${formatBRL(m.fixed)}</td>
                <td class="money">${formatBRL(m.installments)}</td>
                <td class="money">${formatBRL(m.variable)}</td>
                <td class="money strong ${m.balance < 0 ? 'neg' : 'pos'}">${formatBRL(m.balance)}</td>
                <td class="small">${[m.thirteenth ? `13º +${formatBRL(m.thirteenth)}` : '', m.vacation ? `férias +${formatBRL(m.vacation)}` : '', ...m.annual.map((a) => `${a.label} ${formatBRL(a.cents)}`)].filter(Boolean).join(' · ')}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      <p class="field__hint">IPVA, IPTU, seguro, matrícula e material escolar: cadastre como recorrente <strong>Anual</strong> (Novo → Despesa recorrente → Repete: Anual) para aparecerem no mês certo.</p>
    </article>`;
}

// ---------- Posso comprar? ----------

function canBuy() {
  const d = store.data;
  const params = routeParams();
  const f = { value: params.get('valor') ? (Number(params.get('valor')) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', count: '1', ...(store.ui.filters.buy || {}) };
  const cents = toCents(f.value);
  const count = Math.max(1, Math.min(48, Number(f.count) || 1));
  const r = Number.isFinite(cents) && cents > 0 ? canIBuy(d, { cents, count }, 12, todayISO()) : null;
  const V = { sim: { t: 'Pode comprar', tone: 'good', ic: 'circle-check' }, apertado: { t: 'Pode, mas vai apertar', tone: 'warn', ic: 'triangle-alert' }, nao: { t: 'Melhor não agora', tone: 'bad', ic: 'circle-alert' } };
  return html`
    <section class="grid grid--two">
      <article class="card">
        <h2 class="card__title">${icon('calculator')} Posso comprar?</h2>
        <div class="form-grid">
          <div class="field"><label class="field__label" for="buy-value">Valor total</label>
            <div class="field__control has-prefix"><span class="field__prefix" aria-hidden="true">R$</span><input class="input" id="buy-value" data-filter="buy:value" data-money="1" inputmode="decimal" value="${f.value}" placeholder="0,00"></div></div>
          <div class="field"><label class="field__label" for="buy-count">Parcelas</label><input class="input" id="buy-count" type="number" min="1" max="48" data-filter="buy:count" value="${f.count}" inputmode="numeric"></div>
        </div>
        ${r ? html`
          <div class="verdict verdict--${V[r.verdict].tone}">${icon(V[r.verdict].ic)}<div><strong>${V[r.verdict].t}</strong>
            <p>${count > 1 ? `${count}× de ${formatBRL(r.parcel)}` : `à vista, ${formatBRL(cents)}`}${r.reasons.length ? '' : ' · nenhum mês fica no vermelho.'}</p></div></div>
          ${r.reasons.length ? html`<ul class="tips">${r.reasons.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
          <p class="small muted">Reserva de emergência: ${r.reserve.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses de gastos ${helpTip('reserva')}</p>`
        : html`<p class="muted small">Digite o valor e o número de parcelas: o app mostra o saldo dos próximos 12 meses com e sem a compra.</p>`}
      </article>
      ${r ? html`
        <article class="card">
          <h2 class="card__title">${icon('chart-line')} Impacto nos próximos meses</h2>
          ${lineChart(r.months.map((m) => formatMonthShort(m.ym)), [
            { name: 'Sem a compra', values: r.months.map((m) => m.before), className: 'is-spent', dashed: true },
            { name: 'Com a compra', values: r.months.map((m) => m.after), className: 'is-balance' },
          ], { label: 'Saldo mensal com e sem a compra', width: chartWidth(0.5) })}
        </article>` : ''}
    </section>`;
}

// ---------- Envelopes ----------

function envelopes() {
  const d = store.data;
  const list = envelopeStatus(d, store.ui.ym, todayISO());
  const total = sumCents((d.settings.envelopes || []).map((e) => e.monthlyCents));
  return html`
    <div class="page-head">
      <p class="muted">Separe o dinheiro do mês em potes logo que o salário cair ${helpTip('envelope')} · total separado: <strong>${formatBRL(total)}</strong>/mês</p>
      <button type="button" class="btn btn--primary" data-action="env:new">${icon('plus')} Novo envelope</button>
    </div>
    ${list.length ? html`
      <div class="cards-grid">
        ${list.map((e) => html`
          <article class="card entity">
            <header class="entity__head">
              <span class="entity__icon">${e.env.icon}</span>
              <div class="entity__title"><h3>${e.env.name}</h3><p class="muted small">${e.env.categoryIds.map((id) => catText(d.categories.find((c) => c.id === id))).join(', ') || 'sem categorias'}</p></div>
              <p class="entity__value money ${e.left < 0 ? 'state--over' : ''}">${formatBRL(e.left)}</p>
            </header>
            ${meter(Math.min(e.spent, e.available), { max: e.available || 1, label: e.env.name, tone: e.left < 0 ? 'over' : e.pct > 80 ? 'warn' : '' })}
            <p class="entity__progress"><span>${formatBRL(e.spent)} usados</span><span>de ${formatBRL(e.available)}${e.carry ? ` (+${formatBRL(e.carry)} do mês passado)` : ''}</span></p>
            <footer class="entity__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-action="env:edit" data-id="${e.env.id}">${icon('pencil', 'icon--xs')} Editar</button>
              <button type="button" class="btn btn--ghost btn--sm danger" data-action="env:delete" data-id="${e.env.id}">${icon('trash-2', 'icon--xs')} Excluir</button>
            </footer>
          </article>`)}
      </div>`
    : html`<div class="card empty">${icon('inbox', 'icon--lg')}<p><strong>Nenhum envelope ainda.</strong></p><p class="muted">Ex.: "Mercado" R$ 1.200 (categoria Alimentação), "Lazer" R$ 300. O que sai de cada categoria é descontado do pote.</p><button type="button" class="btn btn--primary" data-action="env:new">${icon('plus')} Novo envelope</button></div>`}`;
}

// ---------- Regra 50/30/20 ----------

function rule() {
  const d = store.data;
  const r = ruleStatus(d, store.ui.ym, todayISO());
  return html`
    <div class="page-head">
      <p class="muted">Divida a renda entre necessidades, desejos e poupança ${helpTip('regra503020')}. O grupo de cada categoria fica em Ajustes → Categorias.</p>
      <button type="button" class="btn btn--secondary" data-action="rule:save">${icon('sliders-horizontal')} Ajustar percentuais</button>
    </div>
    <section class="grid grid--kpis grid--kpis-3">
      ${r.groups.map((g) => html`
        <article class="card kpi kpi--${g.ok ? 'good' : 'warn'}">
          <div class="kpi__body">
            <p class="kpi__label">${GROUP_LABELS[g.key]} · meta ${g.target}%</p>
            <p class="kpi__value">${formatPercent(g.pct)}</p>
            <p class="kpi__sub">${formatBRL(g.cents)} de ${formatBRL(g.targetCents)}</p>
            ${meter(g.pct, { max: Math.max(100, g.pct), label: GROUP_LABELS[g.key], tone: g.ok ? 'good' : 'warn' })}
          </div>
        </article>`)}
    </section>
    <p class="muted small">${d.settings.rule503020?.enabled ? 'Acompanhamento ligado no Painel.' : 'Ligue o acompanhamento para ver no Painel.'} Poupança inclui a sobra do mês e a categoria Investimentos.</p>`;
}

function ruleDialog() {
  const r = store.data.settings.rule503020 || { needs: 50, wants: 30, savings: 20, enabled: false };
  openDialog({
    title: 'Regra do orçamento',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Necessidades (%)', name: 'needs', value: r.needs, type: 'number', extra: { min: 0, max: 100 } })}
        ${field({ label: 'Desejos (%)', name: 'wants', value: r.wants, type: 'number', extra: { min: 0, max: 100 } })}
        ${field({ label: 'Poupança (%)', name: 'savings', value: r.savings, type: 'number', extra: { min: 0, max: 100 } })}
        ${switchField({ label: 'Acompanhar no Painel', name: 'enabled', checked: r.enabled })}
      </div>
      <p class="field__hint">Precisa somar 100%. Outras regras comuns: 60/30/10, 70/20/10.</p>`,
    onSubmit: (form) => { A.setRule503020({ enabled: form.enabled.checked, needs: Number(form.needs.value), wants: Number(form.wants.value), savings: Number(form.savings.value) }); toast('Regra salva.'); },
  });
}

