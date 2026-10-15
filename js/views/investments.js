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
  INVEST_CLASSES, LIQUIDITY, typeOf, classOf, rateLabel, annualRate, irRate, isLiquid,
} from '../domain/investments.js';
import { emergencyCoverage } from '../domain/planning.js';
import * as A from '../domain/actions.js';

const YEARS = [1, 5, 10, 20, 30];

export default {
  id: 'investimentos',
  title: 'Investimentos',

  render() {
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
        <p class="muted">Estimativas com CDI de ${(pf.investing.cdiBp / 100).toLocaleString('pt-BR')}% e IPCA de ${(pf.investing.ipcaBp / 100).toLocaleString('pt-BR')}% ao ano</p>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost" data-action="invest:settings">${icon('settings')} Configurar</button>
          <button type="button" class="btn btn--secondary" data-action="invest:quick">${icon('coins')} Aportar</button>
          <button type="button" class="btn btn--primary" data-action="invest:new">${icon('plus')} Novo investimento</button>
        </div>
      </div>

      <section class="grid grid--kpis" aria-label="Resumo da carteira">
        ${kpi('landmark', 'Patrimônio investido', formatBRL(pf.totals.value),
          pf.totals.ir ? `líquido de IR ≈ ${formatBRL(pf.totals.net)}` : plural(pf.positions.length, 'investimento'), 'income', 'card--feature')}
        ${kpi(pf.totals.gain >= 0 ? 'trending-up' : 'trending-down', 'Rendimento', `${pf.totals.gain < 0 ? '−' : '+'}${formatBRL(Math.abs(pf.totals.gain))}`,
          `${formatPercent(pf.totals.gainPct, 1)} sobre ${formatBRL(pf.totals.principal)}${pf.totals.income ? ` · +${formatBRL(pf.totals.income)} em proventos` : ''}`, pf.totals.gain < 0 ? 'bad' : '')}
        ${monthKpi(pf)}
        ${kpi('shield-check', 'Reserva de emergência', !reserve.hasGoal ? '—' : !reserve.monthly ? formatBRL(reserve.saved) : `${reserve.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${reserve.months >= 1 && reserve.months < 2 ? 'mês' : 'meses'}`,
          !reserve.hasGoal ? 'marque um investimento como reserva' : !reserve.monthly ? 'cadastre seus gastos para ver quantos meses cobre' : `${formatBRL(reserve.saved)} · ideal: 6 meses de gastos`, reserve.hasGoal && reserve.monthly && reserve.months >= 6 ? 'good' : '')}
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
  },

  onFilter(name, value, el) {
    if (name === 'real') return setF({ real: el.checked });
    setF({ [name]: value });
  },
};

const find = (el) => (store.data.investments || []).find((x) => x.id === el.dataset.id);
const setF = (patch) => store.setUI({ filters: { ...store.ui.filters, invest: { ...(store.ui.filters.invest || {}), ...patch } } });
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
      <p class="muted">Cadastre onde seu dinheiro está aplicado e registre aportes e resgates. Tudo fica no seu aparelho.</p>
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
    <article class="card kpi ${target && net >= target ? 'kpi--good' : ''}">
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
    <article class="card entity invest ${pos.value <= 0 ? 'is-muted' : ''}" style="--cat:${cls.color}">
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
      </p>

      <footer class="entity__actions">
        <button type="button" class="btn btn--primary btn--sm" data-action="invest:move" data-kind="aporte" data-id="${inv.id}">${icon('plus', 'icon--xs')} Aportar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="invest:move" data-kind="resgate" data-id="${inv.id}" ${pos.value <= 0 ? 'disabled' : ''}>Resgatar</button>
        <span class="entity__icons">
          <button type="button" class="icon-btn" data-action="invest:move" data-kind="saldo" data-id="${inv.id}" aria-label="Atualizar saldo de ${inv.name}" title="Atualizar saldo">${icon('refresh-cw')}</button>
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
    <article class="card card--feature projection">
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
        : reach === 0 ? 'Você já tem esse patrimônio! 🎉'
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
        </ul>` : html`<p class="muted small">Tudo em ordem por aqui. Continue aportando todo mês. 💪</p>`}
    </article>`;
}
