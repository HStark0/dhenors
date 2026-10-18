// =============================================================
// Investimentos — carteira, rendimento, alocação e projeção
// -------------------------------------------------------------
// • Patrimônio, rendimento (bruto e líquido de IR estimado) e
//   aportes do mês, com meta de aporte.
// • Evolução do patrimônio × dinheiro investido (12 meses).
// • Alocação por classe × carteira ideal, com sugestão de onde
//   colocar o próximo aporte.
// • Cada investimento: aportar, resgatar, proventos, atualizar
//   saldo, histórico. Renda fixa rende sozinha por estimativa.
// • Projeção com juros compostos (com ou sem inflação).
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { donutChart, lineChart, meter, chartWidth } from '../ui/charts.js';
import * as IE from '../ui/investEditors.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, formatPercent, toCents, plural } from '../core/money.js';
import { todayISO, currentYM, formatDateBR, formatMonthShort, diffDays } from '../core/dates.js';
import {
  portfolio, evolution, rebalance, project, passiveIncome, investInsights, averageMonthlyContribution,
  INVEST_CLASSES, LIQUIDITY, typeOf, classOf, rateLabel, annualRate, irRate, isLiquid, investingOf,
} from '../domain/investments.js';
import { emergencyCoverage } from '../domain/planning.js';
import { dividendsCalendar, benchmarks, stockSalesTax, fiPlan, realRate, pensionCompare, saleTaxLabel } from '../domain/investPlus.js';
import { fetchRates, fetchQuotes, fetchIbovMonthly, ratesStale } from '../core/market.js';
import { barChart } from '../ui/charts.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { toast, toastError } from '../ui/toast.js';
import { openDialog } from '../ui/dialog.js';
import { field, moneyField } from '../ui/forms.js';
import { helpTip } from '../ui/help.js';
import * as A from '../domain/actions.js';

const YEARS = [1, 5, 10, 20, 30];
const TABS = [
  { id: 'carteira', label: 'Carteira', icon: 'layers' },
  { id: 'proventos', label: 'Proventos', icon: 'hand-coins' },
  { id: 'comparar', label: 'Comparar', icon: 'chart-line' },
  { id: 'ir', label: 'IR nas vendas', icon: 'receipt' },
  { id: 'independencia', label: 'Independência', icon: 'sunrise' },
  { id: 'previdencia', label: 'PGBL × VGBL', icon: 'umbrella' },
];
let busy = '';

export default {
  id: 'investimentos',
  title: 'Investimentos',

  render() {
    const active = currentTab(TABS);
    const R = { carteira: wallet, proventos: dividends, comparar: compare, ir: salesTax, independencia: independence, previdencia: pension };
    return html`${tabsNav('investimentos', TABS, active)}${R[active]()}`;
  },

  actions: {
    'invest:new': () => IE.editInvestment(),
    'invest:quick': () => IE.quickMovement('aporte'),
    'invest:settings': () => IE.investingSettings(),
    'invest:edit': (el) => IE.editInvestment(find(el)),
    'invest:move': (el) => IE.movementDialog(find(el), el.dataset.kind),
    'invest:history': (el) => IE.investmentHistory(find(el)),
    'invest:delete': (el) => {
      const inv = find(el);
      E.confirmDelete(`o investimento "${inv.name}" e todo o seu histórico`, () => A.deleteInvestment(inv.id));
    },
    'invest:cls': (el) => setF({ cls: el.dataset.cls }),
    'invest:years': (el) => setF({ years: Number(el.dataset.years) }),
    'invest:rates': () => updateRates(),
    'invest:quotes': () => updateQuotes(),
    'invest:fi': () => fiDialog(),
    'invest:taxyear': (el) => setF({ taxYear: Number(el.dataset.year) }),
  },

  onFilter(name, value, el) {
    if (name === 'real' || name === 'fullDecl') return setF({ [name]: el.checked });
    setF({ [name]: value });
  },
};

/** Atualiza CDI, Selic, IPCA e IGP-M pelo Banco Central (e o Ibovespa pela brapi). */
export async function updateRates({ silent = false } = {}) {
  if (busy) return;
  busy = 'rates';
  store.setUI({});
  try {
    const rates = await fetchRates();
    let ibovMonthly = null;
    try { ibovMonthly = await fetchIbovMonthly(); } catch { /* Ibovespa é opcional */ }
    A.applyMarketRates({ ...rates, ibovMonthly });
    if (!silent) toast(`Taxas atualizadas: CDI ${(rates.cdiBp / 100).toLocaleString('pt-BR')}% · IPCA 12m ${(rates.ipca12Bp / 100).toLocaleString('pt-BR')}%.`);
  } catch (err) {
    if (!silent) toastError(`Não consegui falar com o Banco Central (${err.message}). Tente mais tarde ou ajuste em Configurar.`);
  } finally { busy = ''; store.setUI({}); }
}

async function updateQuotes() {
  if (store.guest) { document.dispatchEvent(new CustomEvent('dhenors:need-login')); return undefined; } // nada a buscar para o exemplo
  const tickers = (store.data.investments || []).map((i) => i.ticker).filter(Boolean);
  if (!tickers.length) return toast('Cadastre o código (ex.: PETR4) e a quantidade de cotas nos seus ativos para usar as cotações.', { type: 'info' });
  busy = 'quotes';
  store.setUI({});
  try {
    const { prices, errors } = await fetchQuotes(tickers);
    A.applyQuotes(prices);
    toast(`${plural(Object.keys(prices).length, 'cotação atualizada', 'cotações atualizadas')}${errors.length ? ` · ${errors.length} com erro` : ''}.`);
  } catch (err) { toastError(err.message); } finally { busy = ''; store.setUI({}); }
  return undefined;
}

// ---------- Carteira ----------

function wallet() {
    const d = store.data;
    const today = todayISO();
    const pf = portfolio(d, today);
    if (!pf.positions.length) return empty();

    const f = store.ui.filters.invest || {};
    const shownClass = f.cls && pf.byClass.some((c) => c.key === f.cls && c.value > 0) ? f.cls : 'all';
    const list = pf.positions
      .filter((p) => shownClass === 'all' || classOf(p.inv) === shownClass)
      .sort((a, b) => b.pos.value - a.pos.value);
    const reserve = emergencyCoverage(d, currentYM(), today);

    return html`
      <div class="page-head">
        <p class="muted">Estimativas com CDI de ${(pf.investing.cdiBp / 100).toLocaleString('pt-BR')}% e IPCA de ${(pf.investing.ipcaBp / 100).toLocaleString('pt-BR')}% ao ano
          · ${pf.investing.ratesUpdatedAt ? `atualizadas em ${formatDateBR(pf.investing.ratesUpdatedAt.slice(0, 10))}` : 'taxas digitadas à mão'}
          ${ratesStale(pf.investing.ratesUpdatedAt) ? html`<span class="badge badge--warn">desatualizadas</span>` : ''}</p>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost" data-action="invest:rates" ${busy ? 'disabled' : ''}>${icon(busy === 'rates' ? 'loader' : 'refresh-cw', busy === 'rates' ? 'spin' : '')} Atualizar taxas</button>
          ${(d.investments || []).some((i) => i.ticker) ? html`<button type="button" class="btn btn--ghost" data-action="invest:quotes" ${busy ? 'disabled' : ''}>${icon(busy === 'quotes' ? 'loader' : 'chart-candlestick', busy === 'quotes' ? 'spin' : '')} Atualizar cotações</button>` : ''}
          <button type="button" class="btn btn--ghost" data-action="invest:settings">${icon('settings')} Configurar</button>
          <button type="button" class="btn btn--secondary" data-action="invest:quick">${icon('coins')} Aportar</button>
          <button type="button" class="btn btn--primary" data-action="invest:new">${icon('plus')} Novo investimento</button>
        </div>
      </div>

      <section class="grid grid--kpis" aria-label="Resumo da carteira">
        ${kpi('landmark', 'Patrimônio investido', formatBRL(pf.totals.value),
          pf.totals.ir ? `líquido de IR ≈ ${formatBRL(pf.totals.net)}` : plural(pf.positions.length, 'investimento'), 'income')}
        ${kpi(pf.totals.gain >= 0 ? 'trending-up' : 'trending-down', 'Rendimento', `${pf.totals.gain < 0 ? '−' : '+'}${formatBRL(Math.abs(pf.totals.gain))}`,
          `${formatPercent(pf.totals.gainPct, 1)} sobre ${formatBRL(pf.totals.principal)}${pf.totals.income ? ` · +${formatBRL(pf.totals.income)} em proventos` : ''}`, pf.totals.gain < 0 ? 'bad' : 'good')}
        ${monthKpi(pf)}
        ${kpi('shield-check', 'Reserva de emergência', !reserve.hasGoal ? '—' : !reserve.monthly ? formatBRL(reserve.saved) : `${reserve.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${reserve.months >= 1 && reserve.months < 2 ? 'mês' : 'meses'}`,
          !reserve.hasGoal ? 'marque um investimento como reserva' : !reserve.monthly ? 'cadastre seus gastos para ver quantos meses cobre' : `${formatBRL(reserve.saved)} · ideal: 6 meses de gastos`, !(reserve.hasGoal && reserve.monthly) ? '' : reserve.months >= 6 ? 'good' : reserve.months >= 3 ? 'warn' : 'bad')}
      </section>

      <section class="grid grid--two">
        ${evolutionCard(d, today)}
        ${allocationCard(pf, d, today)}
      </section>

      <article class="card">
        <header class="card__header">
          <h2 class="card__title">${icon('layers')} Meus investimentos</h2>
          ${classFilter(pf, shownClass)}
        </header>
        <div class="cards-grid invest-list">${list.map((p) => card(p.inv, p.pos, pf.investing, today))}</div>
      </article>

      <section class="grid grid--two">
        ${projectionCard(pf, d, today)}
        ${insightsCard(d, pf, reserve, today)}
      </section>`;
}

const find = (el) => (store.data.investments || []).find((x) => x.id === el.dataset.id);
const setF = (patch) => store.setUI({ filters: { ...store.ui.filters, invest: { ...(store.ui.filters.invest || {}), ...patch } } });
const goalsOf = (inv) => (store.data.goals || []).filter((g) => (g.investmentIds || []).includes(inv.id));
const signed = (c) => `${c < 0 ? '−' : '+'}${formatBRL(Math.abs(c))}`;

// ---------- Blocos ----------

function empty() {
  const ideas = [
    ['landmark', 'Renda fixa que rende sozinha', 'CDB, Tesouro, LCI/LCA e poupança têm o rendimento estimado todo dia, com IR regressivo já descontado.'],
    ['chart-pie', 'Carteira ideal', 'Diga quanto quer em cada classe e o app sugere onde colocar cada aporte.'],
    ['shield-check', 'Reserva de emergência', 'Marque a reserva e veja quantos meses de gastos ela cobre na Saúde financeira.'],
    ['rocket', 'Projeção', 'Veja quanto o patrimônio pode virar em 1, 10 ou 30 anos com juros compostos.'],
  ];
  return html`
    <div class="card empty invest-empty">
      ${icon('coins', 'icon--lg')}
      <p><strong>Comece a acompanhar seus investimentos</strong></p>
      <p class="muted">Cadastre onde seu dinheiro está aplicado e registre aportes e resgates.</p>
      <ul class="invest-ideas">
        ${ideas.map(([ic, t, s]) => html`<li>${icon(ic)}<span><strong>${t}</strong><small>${s}</small></span></li>`)}
      </ul>
      <div class="card__actions" style="justify-content:center">
        <button type="button" class="btn btn--primary" data-action="invest:new">${icon('plus')} Adicionar investimento</button>
        <button type="button" class="btn btn--ghost" data-action="invest:settings">${icon('settings')} Configurar taxas</button>
      </div>
    </div>`;
}

function kpi(ic, label, value, sub, tone = '', extra = '') {
  return html`
    <article class="card kpi ${tone ? `kpi--${tone}` : ''} ${extra}">
      <span class="kpi__icon">${icon(ic)}</span>
      <div class="kpi__body">
        <p class="kpi__label">${label}</p>
        <p class="kpi__value money">${value}</p>
        <p class="kpi__sub">${sub}</p>
      </div>
    </article>`;
}

function monthKpi(pf) {
  const target = pf.investing.monthlyTargetCents;
  const net = pf.month.net;
  return html`
    <article class="card kpi ${!target ? '' : net >= target ? 'kpi--good' : 'kpi--warn'}">
      <span class="kpi__icon">${icon('coins')}</span>
      <div class="kpi__body">
        <p class="kpi__label">Aportes do mês</p>
        <p class="kpi__value money">${formatBRL(net)}</p>
        ${target ? html`
          ${meter(Math.max(0, net), { max: target, label: 'Meta de aporte do mês', tone: net >= target ? 'good' : '' })}
          <p class="kpi__sub">meta ${formatBRL(target)}${net < target ? ` · faltam ${formatBRL(target - net)}` : ' · batida!'}</p>`
        : html`<p class="kpi__sub">${pf.month.resgates ? `${formatBRL(pf.month.aportes)} aportados − ${formatBRL(pf.month.resgates)} resgatados` : html`<button type="button" class="link" data-action="invest:settings">Definir meta de aporte</button>`}</p>`}
      </div>
    </article>`;
}

function evolutionCard(d, today) {
  const series = evolution(d, currentYM(), 12, today);
  const first = series.findIndex((p) => p.value > 0 || p.principal > 0);
  const shown = first > 0 ? series.slice(Math.min(first, series.length - 2)) : series;
  return html`
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('chart-line')} Evolução do patrimônio</h2></header>
      ${lineChart(shown.map((p) => formatMonthShort(p.ym)), [
        { name: 'Patrimônio', values: shown.map((p) => p.value), className: 'is-balance' },
        { name: 'Dinheiro investido', values: shown.map((p) => p.principal), className: 'is-spent', dashed: true },
      ], { label: 'Patrimônio e dinheiro investido mês a mês', width: chartWidth(0.5) })}
      <p class="muted small">A distância entre as linhas é o rendimento acumulado.</p>
    </article>`;
}

function allocationCard(pf, d, today) {
  const segments = pf.byClass.map((c) => ({ label: c.label, value: c.value, color: c.color }));
  const hasTargets = pf.byClass.some((c) => c.target > 0);
  const next = pf.investing.monthlyTargetCents || averageMonthlyContribution(d, 6, today) || 100000;
  const plan = hasTargets ? rebalance(pf.byClass, next) : [];
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('chart-pie')} Alocação</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="invest:settings">${hasTargets ? 'Carteira ideal' : 'Definir carteira ideal'}</button>
      </header>
      ${donutChart(segments, { center: formatBRL(pf.totals.value), centerSub: 'na carteira', label: 'Alocação por classe' })}
      ${hasTargets ? html`
        <ul class="alloc">
          ${pf.byClass.filter((c) => c.target > 0 || c.value > 0).map((c) => html`
            <li>
              <span class="alloc__name"><span class="dot" style="background:${c.color}"></span>${c.label}</span>
              <span class="alloc__bar" aria-hidden="true">
                <span class="alloc__fill" style="width:${Math.min(100, c.pct).toFixed(1)}%;background:${c.color}"></span>
                <span class="alloc__target" style="left:${Math.min(100, c.target)}%"></span>
              </span>
              <span class="alloc__pct">${c.pct.toFixed(0)}% <small>/ ${c.target}%</small></span>
            </li>`)}
        </ul>
        ${plan.length ? html`
          <div class="note">${icon('sparkles')}<span>Próximo aporte de <strong>${formatBRL(next)}</strong>: ${plan.map((p, i) => html`${i ? (i === plan.length - 1 ? ' e ' : ', ') : ''}<strong>${formatBRL(p.cents)}</strong> em ${p.label.toLowerCase()}`)}.</span></div>`
        : html`<p class="muted small">Carteira equilibrada com a ideal. 👌</p>`}`
      : ''}
    </article>`;
}

function classFilter(pf, shown) {
  const present = pf.byClass.filter((c) => c.value > 0 || pf.positions.some((p) => classOf(p.inv) === c.key));
  if (present.length < 2) return '';
  return html`
    <div class="segmented" role="group" aria-label="Filtrar por classe">
      <button type="button" class="segmented__btn" data-action="invest:cls" data-cls="all" aria-pressed="${shown === 'all'}">Todos</button>
      ${present.map((c) => html`<button type="button" class="segmented__btn" data-action="invest:cls" data-cls="${c.key}" aria-pressed="${shown === c.key}">${c.label}</button>`)}
    </div>`;
}

function card(inv, pos, investing, today) {
  const t = typeOf(inv);
  const cls = INVEST_CLASSES[classOf(inv)];
  const days = inv.maturity ? diffDays(today, inv.maturity) : null;
  const rate = annualRate(inv, investing);
  const sub = [t.label, inv.institution, rate != null ? rateLabel(inv) : ''].filter(Boolean).join(' · ');
  return html`
    <article class="card entity invest ${pos.value <= 0 ? 'is-muted' : pos.gain < 0 ? 'tone-bad' : pos.gain > 0 ? 'tone-good' : 'tone-info'}" style="--cat:${cls.color}">
      <header class="entity__head">
        <span class="entity__icon">${t.icon}</span>
        <div class="entity__title">
          <h3>${inv.name}</h3>
          <p class="muted small">${sub}</p>
        </div>
        <p class="entity__value money">${formatBRL(pos.value)}${pos.estimated ? html`<small>estimado</small>` : pos.lastUpdate ? html`<small>em ${formatDateBR(pos.lastUpdate)}</small>` : ''}</p>
      </header>

      <dl class="invest__nums">
        <div><dt>Investido</dt><dd class="money">${formatBRL(pos.principal)}</dd></div>
        <div><dt>Rendimento</dt><dd class="money ${pos.gain < 0 ? 'neg' : pos.gain > 0 ? 'pos' : ''}">${signed(pos.gain)} <small>${formatPercent(pos.gainPct, 1)}</small></dd></div>
        ${pos.ir ? html`<div><dt>Líquido de IR</dt><dd class="money">${formatBRL(pos.net)} <small>IR ${(irRate(pos.avgDays) * 100).toLocaleString('pt-BR')}%</small></dd></div>` : ''}
        ${pos.income ? html`<div><dt>Proventos</dt><dd class="money pos">+${formatBRL(pos.income)}</dd></div>` : ''}
        ${pos.realized ? html`<div><dt>Lucro resgatado</dt><dd class="money">${signed(pos.realized)}</dd></div>` : ''}
      </dl>

      <p class="entity__meta">
        <span class="badge ${isLiquid(inv.liquidity) ? 'badge--good' : 'badge--muted'}">${icon('clock', 'icon--xs')} ${LIQUIDITY[inv.liquidity]}</span>
        ${inv.maturity ? html`<span class="badge ${days < 0 ? 'badge--bad' : days <= 30 ? 'badge--info' : 'badge--muted'}">${icon('calendar', 'icon--xs')} ${days < 0 ? `venceu em ${formatDateBR(inv.maturity)}` : `vence ${formatDateBR(inv.maturity)}`}</span>` : ''}
        ${inv.emergency ? html`<span class="badge badge--info">${icon('shield-check', 'icon--xs')} Reserva</span>` : ''}
        ${inv.ticker ? html`<span class="badge badge--muted" title="${saleTaxLabel(inv)}">${inv.ticker}${pos.qty ? ` · ${pos.qty.toLocaleString('pt-BR')} cotas` : ''}${pos.quoted ? ' · pela cotação' : ''}</span>` : ''}
        ${inv.pension ? html`<span class="badge badge--muted">${inv.pension.toUpperCase()}</span>` : ''}
        ${goalsOf(inv).map((g) => html`<a class="badge badge--good" href="#/metas">${icon('target', 'icon--xs')} ${g.description}</a>`)}
      </p>

      <footer class="entity__actions">
        <button type="button" class="btn btn--primary btn--sm" data-action="invest:move" data-kind="aporte" data-id="${inv.id}">${icon('plus', 'icon--xs')} Aportar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="invest:move" data-kind="resgate" data-id="${inv.id}" ${pos.value <= 0 ? 'disabled' : ''}>Resgatar</button>
        <span class="entity__icons">
          <button type="button" class="icon-btn" data-action="invest:move" data-kind="saldo" data-id="${inv.id}" aria-label="Atualizar saldo de ${inv.name}" title="Atualizar saldo">${icon('refresh-cw')}</button>
          ${inv.ticker ? html`<button type="button" class="icon-btn" data-action="invest:move" data-kind="venda" data-id="${inv.id}" aria-label="Registrar venda de ${inv.name}" title="Venda (calcula o IR)" ${pos.value <= 0 ? 'disabled' : ''}>${icon('arrow-down-right')}</button>` : ''}
          <button type="button" class="icon-btn" data-action="invest:move" data-kind="provento" data-id="${inv.id}" aria-label="Registrar provento de ${inv.name}" title="Provento / rendimento recebido">${icon('hand-coins')}</button>
          <button type="button" class="icon-btn" data-action="invest:history" data-id="${inv.id}" aria-label="Histórico de ${inv.name}" title="Histórico">${icon('history')}</button>
          <button type="button" class="icon-btn" data-action="invest:edit" data-id="${inv.id}" aria-label="Editar ${inv.name}" title="Editar">${icon('pencil')}</button>
          <button type="button" class="icon-btn danger" data-action="invest:delete" data-id="${inv.id}" aria-label="Excluir ${inv.name}" title="Excluir">${icon('trash-2')}</button>
        </span>
      </footer>
    </article>`;
}

function projectionCard(pf, d, today) {
  const f = store.ui.filters.invest || {};
  const years = YEARS.includes(f.years) ? f.years : 10;
  const defMonthly = pf.investing.monthlyTargetCents || averageMonthlyContribution(d, 6, today);
  // Taxa padrão: 100% do CDI, já sem IR de longo prazo
  const defRate = annualRate({ rate: { kind: 'cdi', bp: 10000 } }, pf.investing) * (1 - irRate(721));
  const monthly = f.monthly != null && f.monthly !== '' ? Math.max(0, toCents(f.monthly) || 0) : defMonthly;
  const ratePct = f.rate != null && f.rate !== '' ? Number(String(f.rate).replace(',', '.')) : null;
  const nominal = Number.isFinite(ratePct) && ratePct != null ? ratePct / 100 : defRate;
  const ipca = pf.investing.ipcaBp / 10000;
  const rate = f.real ? (1 + nominal) / (1 + ipca) - 1 : nominal;
  const target = f.target ? Math.max(0, toCents(f.target) || 0) : 0;
  const r = project({ startCents: pf.totals.value, monthlyCents: monthly, annualRate: rate, months: years * 12, targetCents: target });
  const yearly = r.points.filter((p) => p.month % (years <= 1 ? 1 : 12) === 0);
  const label = (m) => (years <= 1 ? `${m}m` : `${m / 12}a`);
  const reach = r.monthsToTarget;

  return html`
    <article class="card tone-info projection">
      <header class="card__header">
        <h2 class="card__title">${icon('rocket')} Projeção</h2>
        <div class="segmented" role="group" aria-label="Prazo">
          ${YEARS.map((y) => html`<button type="button" class="segmented__btn" data-action="invest:years" data-years="${y}" aria-pressed="${years === y}">${y}a</button>`)}
        </div>
      </header>
      <div class="projection__controls">
        ${control('monthly', 'Aporte por mês', 'R$', f.monthly ?? '', (defMonthly / 100).toLocaleString('pt-BR'))}
        ${control('rate', 'Rendimento ao ano', '%', f.rate ?? '', (defRate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }))}
        ${control('target', 'Meta de patrimônio', 'R$', f.target ?? '', 'opcional')}
      </div>
      <label class="check check--sm projection__real"><input type="checkbox" data-filter="real" ${f.real ? 'checked' : ''}> Descontar a inflação (valores de hoje)</label>

      <dl class="kv">
        <div><span>Em ${years} ${years === 1 ? 'ano' : 'anos'}</span><strong class="money">${formatBRL(r.final)}</strong></div>
        <div><span>Você aporta</span><strong class="money">${formatBRL(r.contributed)}</strong></div>
        <div><span>Juros trabalham</span><strong class="money pos">+${formatBRL(r.interest)}</strong></div>
        <div><span>Renda/mês (regra 4%)</span><strong class="money">${formatBRL(passiveIncome(r.final))}</strong></div>
      </dl>
      ${target ? html`<p class="note">${icon('target')}<span>${reach == null ? 'Com esses números, a meta leva mais de 50 anos. Aumente o aporte ou o prazo.'
        : reach === 0 ? 'Você já tem esse patrimônio!'
        : html`Meta de <strong>${formatBRL(target)}</strong> em <strong>${reach >= 12 ? `${Math.floor(reach / 12)} ${Math.floor(reach / 12) === 1 ? 'ano' : 'anos'}${reach % 12 ? ` e ${reach % 12} ${reach % 12 === 1 ? 'mês' : 'meses'}` : ''}` : plural(reach, 'mês', 'meses')}</strong>.`}</span></p>` : ''}

      ${lineChart(yearly.map((p) => label(p.month)), [
        { name: 'Patrimônio', values: yearly.map((p) => p.value), className: 'is-balance' },
        { name: 'Aportado', values: yearly.map((p) => p.contributed), className: 'is-spent', dashed: true },
      ], { label: 'Projeção do patrimônio', width: chartWidth(0.5), height: 200 })}
      <p class="muted small">Simulação com taxa constante${f.real ? ', já sem a inflação' : ' (valores nominais)'}. Rentabilidade passada não garante a futura.</p>
    </article>`;
}

function control(name, label, unit, value, placeholder) {
  const id = `inv-proj-${name}`;
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${label}</label>
      <div class="field__control has-prefix">
        <span class="field__prefix" aria-hidden="true">${unit}</span>
        <input class="input" id="${id}" data-filter="${name}" value="${value}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}">
      </div>
    </div>`;
}

function insightsCard(d, pf, reserve, today) {
  const list = investInsights(d, pf, { reserveMonths: reserve.hasGoal && reserve.monthly ? reserve.months : null, today });
  const ICON = { good: 'trending-up', warn: 'triangle-alert', bad: 'triangle-alert', info: 'sparkles' };
  return html`
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('sparkles')} Dicas para a carteira</h2></header>
      ${list.length ? html`
        <ul class="insights">
          ${list.map((i) => html`
            <li class="insight insight--${i.tone}">
              ${icon(ICON[i.tone])}
              <div><strong>${i.title}</strong><p>${i.text}</p></div>
            </li>`)}
        </ul>` : html`<p class="muted small">Tudo em ordem por aqui. Continue aportando todo mês.</p>`}
    </article>`;
}

// ---------- Proventos ----------

function dividends() {
  const d = store.data;
  const today = todayISO();
  const cal = dividendsCalendar(d, 12, today);
  const pf = portfolio(d, today);
  const yieldPct = pf.totals.value > 0 ? (cal.last12 / pf.totals.value) * 100 : 0;
  return html`
    <section class="grid grid--kpis grid--kpis-3">
      ${kpi('hand-coins', 'Proventos em 12 meses', formatBRL(cal.last12), `${formatPercent(yieldPct, 1)} do patrimônio atual`, 'income')}
      ${kpi('calendar', 'Média por mês', formatBRL(cal.avgMonthly), 'renda passiva de hoje')}
      ${kpi('rocket', 'Pela regra dos 4%', formatBRL(passiveIncome(pf.totals.value)), 'quanto a carteira pagaria por mês para sempre')}
    </section>
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('chart-column')} Proventos mês a mês</h2></header>
      ${cal.last12 ? barChart(cal.months.map((m) => formatMonthShort(m.ym)), [{ name: 'Proventos', values: cal.months.map((m) => m.cents), className: 'is-income' }], { label: 'Proventos recebidos nos últimos 12 meses', width: chartWidth(1), height: 200 })
        : html`<p class="muted">Nenhum provento registrado. Use o botão ${icon('hand-coins', 'icon--xs')} no investimento para lançar dividendos, JCP, rendimentos de FII ou cupons.</p>`}
    </article>
    ${cal.byAsset.length ? html`
      <article class="card">
        <h2 class="card__title">${icon('list')} Por ativo (12 meses)</h2>
        <ul class="mini-list">${cal.byAsset.map((a) => html`<li><span>${a.name}</span><span class="money pos">+${formatBRL(a.cents)}</span></li>`)}</ul>
      </article>` : ''}`;
}

// ---------- Comparar com índices ----------

function compare() {
  const d = store.data;
  const today = todayISO();
  const b = benchmarks(d, 12, today);
  if (!b.months.length) return html`<div class="card empty">${icon('chart-line', 'icon--lg')}<p class="muted">Ainda não há histórico suficiente. Volte depois de um mês com investimentos cadastrados.</p></div>`;
  const pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
  const toBp = (arr) => arr.map((x) => Math.round(x * 10000));
  const series = [
    { name: 'Sua carteira', values: toBp(b.series.portfolio), className: 'is-balance' },
    { name: 'CDI', values: toBp(b.series.cdi), className: 'is-income', dashed: true },
    { name: 'IPCA', values: toBp(b.series.ipca), className: 'is-fixed', dashed: true },
    ...(b.series.ibov ? [{ name: 'Ibovespa', values: toBp(b.series.ibov), className: 'is-variable', dashed: true }] : []),
  ];
  const c = b.cumulative;
  const beat = c.portfolio != null && c.cdi != null ? c.portfolio - c.cdi : null;
  return html`
    <section class="grid grid--kpis">
      ${kpi('wallet', 'Sua carteira', pct(c.portfolio), '12 meses (descontando aportes)', c.portfolio < 0 ? 'bad' : 'good')}
      ${kpi('landmark', 'CDI', pct(c.cdi), b.estimated.cdi ? 'estimado pela taxa atual' : 'Banco Central')}
      ${kpi('flame', 'Inflação (IPCA)', pct(c.ipca), b.estimated.ipca ? 'estimado pela taxa atual' : 'Banco Central')}
      ${kpi('chart-candlestick', 'Ibovespa', pct(c.ibov), c.ibov == null ? 'toque em Atualizar taxas' : 'brapi')}
    </section>
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('chart-line')} Rentabilidade acumulada</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="invest:rates" ${busy ? 'disabled' : ''}>${icon('refresh-cw', 'icon--xs')} Atualizar índices</button>
      </header>
      ${lineChart(b.months.map((m) => formatMonthShort(m.ym)), series, { label: 'Rentabilidade da carteira comparada a CDI, IPCA e Ibovespa', width: chartWidth(1), format: (v) => `${(v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` })}
      ${beat != null ? html`<p class="note">${icon(beat >= 0 ? 'trending-up' : 'trending-down')}<span>${beat >= 0 ? `Sua carteira rendeu ${pct(beat)} acima do CDI.` : `Sua carteira rendeu ${pct(-beat).replace('+', '')} abaixo do CDI — um CDB de 100% do CDI teria rendido mais.`} Rentabilidade real (acima da inflação): <strong>${pct(c.ipca != null ? (1 + c.portfolio) / (1 + c.ipca) - 1 : null)}</strong>.</span></p>` : ''}
      <p class="muted small">Método de Dietz simples: o ganho do mês dividido pelo saldo inicial mais metade dos aportes. Aproximação suficiente para comparar.</p>
    </article>`;
}

// ---------- IR nas vendas ----------

function salesTax() {
  const d = store.data;
  const year = Number(store.ui.filters.invest?.taxYear) || Number(todayISO().slice(0, 4));
  const r = stockSalesTax(d, year);
  const years = [year - 1, year, year + 1].filter((y) => y <= Number(todayISO().slice(0, 4)));
  return html`
    <div class="page-head">
      <p class="muted">Ações: vendas de até R$ 20 mil no mês são isentas. FII: 20% sobre o lucro. ETF/BDR: 15%. Prejuízo abate lucros futuros. ${helpTip('darf')}</p>
      <div class="segmented" role="group" aria-label="Ano">
        ${years.map((y) => html`<button type="button" class="segmented__btn" data-action="invest:taxyear" data-year="${y}" aria-pressed="${y === year}">${y}</button>`)}
      </div>
    </div>
    ${r.months.length ? html`
      <section class="grid grid--kpis grid--kpis-3">
        ${kpi('receipt', `IR devido em ${year}`, formatBRL(r.total), `${plural(r.months.filter((m) => m.tax).length, 'DARF', 'DARFs')} a pagar`, r.total ? 'warn' : 'good')}
        ${kpi('trending-down', 'Prejuízo a compensar', formatBRL(-Math.min(0, r.carry.acoes + r.carry.fii + r.carry.etf)), 'abate lucros dos próximos meses')}
        ${kpi('badge-check', 'Meses isentos', String(r.months.filter((m) => m.exempt).length), 'vendas de ações até R$ 20 mil')}
      </section>
      <article class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Mês</th><th scope="col" class="num">Vendas</th><th scope="col" class="num">Lucro</th><th scope="col" class="num">IR</th><th scope="col">DARF 6015</th></tr></thead>
            <tbody>${r.months.map((m) => {
              const sold = m.sales.acoes + m.sales.fii + m.sales.etf;
              const gain = m.gains.acoes + m.gains.fii + m.gains.etf;
              return html`<tr>
                <td>${formatMonthShort(m.ym)} ${m.exempt ? html`<span class="badge badge--good">isento</span>` : ''}</td>
                <td class="num money">${formatBRL(sold)}</td>
                <td class="num money ${gain < 0 ? 'neg' : 'pos'}">${signed(gain)}</td>
                <td class="num money">${formatBRL(m.tax)}</td>
                <td>${m.tax ? `pagar até ${formatDateBR(m.darfDue)}` : '—'}</td>
              </tr>`;
            })}</tbody>
          </table>
        </div>
        <p class="muted small">O preço médio vem dos seus aportes. Emita o DARF no Sicalc (Receita Federal), código 6015. Day trade não é calculado.</p>
      </article>`
    : html`<div class="card empty">${icon('receipt', 'icon--lg')}<p><strong>Nenhuma venda em ${year}.</strong></p><p class="muted">Registre vendas pelo botão ${icon('arrow-down-right', 'icon--xs')} em ações, FIIs e ETFs com código cadastrado.</p></div>`}`;
}

// ---------- Independência financeira ----------

function independence() {
  const d = store.data;
  const today = todayISO();
  const pf = portfolio(d, today);
  const s = investingOf(d.settings).fi;
  if (!s) {
    return html`<div class="card empty">${icon('sunrise', 'icon--lg')}<p><strong>Quando você pode viver de renda?</strong></p><p class="muted">Informe sua idade, a idade em que quer parar e quanto precisa por mês. O app calcula o patrimônio necessário (regra dos 4%) e o aporte mensal.</p><button type="button" class="btn btn--primary" data-action="invest:fi">${icon('sliders-horizontal')} Fazer as contas</button></div>`;
  }
  const monthly = pf.investing.monthlyTargetCents || averageMonthlyContribution(d, 6, today);
  const rate = realRate(d);
  const p = fiPlan({ currentCents: pf.totals.value, monthlyCents: monthly, age: s.age, targetAge: s.targetAge, monthlyCostCents: s.monthlyCostCents, withdrawalBp: s.withdrawalBp, annualRealRate: rate });
  const yearly = p.projection.points.filter((x) => x.month % 12 === 0);
  return html`
    <section class="grid grid--kpis">
      ${kpi('flag', 'Patrimônio necessário', formatBRL(p.target), `${formatBRL(s.monthlyCostCents)}/mês com retirada de ${(s.withdrawalBp / 100).toLocaleString('pt-BR')}% ao ano`)}
      ${kpi('wallet', 'Você já tem', formatBRL(p.current), formatPercent(p.target ? (p.current / p.target) * 100 : 0, 1) + ' do caminho', 'income')}
      ${kpi('calendar-clock', 'Chega lá com', p.reachAge ? `${Math.ceil(p.reachAge)} anos` : '—', p.reachAge ? `aportando ${formatBRL(monthly)}/mês` : 'mais de 50 anos no ritmo atual', p.onTrack ? 'good' : 'warn')}
      ${kpi('piggy-bank', `Para chegar aos ${s.targetAge}`, `${formatBRL(p.needMonthly)}/mês`, `juros reais de ${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% a.a.`, p.onTrack ? 'good' : '')}
    </section>
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('sunrise')} Caminho até a independência</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="invest:fi">${icon('sliders-horizontal', 'icon--xs')} Ajustar</button>
      </header>
      ${lineChart(yearly.map((x) => `${s.age + x.month / 12}`), [
        { name: 'Patrimônio (valores de hoje)', values: yearly.map((x) => x.value), className: 'is-balance' },
        { name: 'Meta', values: yearly.map(() => p.target), className: 'is-ideal', dashed: true },
      ], { label: 'Patrimônio projetado por idade', width: chartWidth(1) })}
      <p class="muted small">Valores já descontada a inflação (juros reais). Na meta, a carteira pagaria ≈ ${formatBRL(p.passiveAtTarget)}/mês. Simulação, não recomendação.</p>
    </article>`;
}

function fiDialog() {
  const s = investingOf(store.data.settings).fi || { age: 30, targetAge: 60, monthlyCostCents: null, withdrawalBp: 400 };
  openDialog({
    title: 'Independência financeira',
    size: 'sm',
    submitLabel: 'Calcular',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Sua idade', name: 'age', type: 'number', value: s.age, required: true, extra: { min: 14, max: 100 } })}
        ${field({ label: 'Parar de trabalhar aos', name: 'targetAge', type: 'number', value: s.targetAge, required: true, extra: { min: 15, max: 110 } })}
        ${moneyField({ label: 'Quanto precisa por mês (valores de hoje)', name: 'cost', cents: s.monthlyCostCents, full: true })}
        ${field({ label: 'Taxa de retirada ao ano (%)', name: 'withdrawal', value: (s.withdrawalBp / 100).toLocaleString('pt-BR'), hint: '4% é a regra clássica; 3,5% é mais conservador.', extra: { inputmode: 'decimal' } })}
      </div>`,
    onSubmit: (form) => {
      A.saveFiSettings({ age: Number(form.age.value), targetAge: Number(form.targetAge.value), monthlyCostCents: toCents(form.cost.value), withdrawalBp: Math.round(Number(String(form.withdrawal.value).replace(',', '.')) * 100) });
    },
  });
}

// ---------- PGBL × VGBL ----------

function pension() {
  const f = store.ui.filters.invest || {};
  const annual = f.pAnnual ? toCents(f.pAnnual) || 0 : 1200000;
  const income = f.pIncome ? toCents(f.pIncome) || 0 : 12000000;
  const years = Number(f.pYears) || 20;
  const full = f.fullDecl ?? true;
  const r = pensionCompare({ annualContribution: annual, taxableIncome: income, years, annualRate: 0.08, marginalRate: 0.275, fullDeclaration: full });
  const row = (label, a, b) => html`<tr><th scope="row" class="text-left">${label}</th><td class="num money">${a}</td><td class="num money">${b}</td></tr>`;
  return html`
    <article class="card">
      <h2 class="card__title">${icon('umbrella')} PGBL ou VGBL?</h2>
      <div class="projection__controls">
        ${control('pAnnual', 'Aporte por ano', 'R$', f.pAnnual ?? '', '12.000')}
        ${control('pIncome', 'Renda tributável no ano', 'R$', f.pIncome ?? '', '120.000')}
        ${control('pYears', 'Por quantos anos', 'a', f.pYears ?? '', '20')}
      </div>
      <label class="check check--sm"><input type="checkbox" data-filter="fullDecl" ${full ? 'checked' : ''}> Faço a declaração COMPLETA do IR</label>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col"></th><th scope="col" class="num">PGBL</th><th scope="col" class="num">VGBL</th></tr></thead>
          <tbody>
            ${row('Acumulado (8% a.a.)', formatBRL(r.pgbl.final), formatBRL(r.vgbl.final))}
            ${row(`IR no resgate (${(r.regressive * 100).toLocaleString('pt-BR')}%)`, `−${formatBRL(r.pgbl.tax)}`, `−${formatBRL(r.vgbl.tax)}`)}
            ${row('Restituição reinvestida', `+${formatBRL(r.pgbl.refundFinal)}`, '—')}
            ${row('Fica com você', formatBRL(r.pgbl.net), formatBRL(r.vgbl.net))}
          </tbody>
        </table>
      </div>
      <div class="verdict verdict--good">${icon('circle-check')}<div><strong>${r.best === 'pgbl' ? 'PGBL' : 'VGBL'} rende mais nesse caso</strong><p>${r.note} Dedutível por ano: ${formatBRL(r.pgbl.deductible)} (até 12% da renda) · restituição ≈ ${formatBRL(r.pgbl.refundYearly)}/ano.</p></div></div>
      <p class="muted small">Tabela regressiva (10% após 10 anos), alíquota marginal de 27,5%. Simulação simplificada, sem taxas de administração.</p>
    </article>`;
}
