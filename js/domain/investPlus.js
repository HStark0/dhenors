// =============================================================
// investPlus.js — Proventos, comparação com índices, IR na venda de
// ações, independência financeira e PGBL × VGBL
// -------------------------------------------------------------
// Funções puras sobre domain/investments.js (testadas em
// tests/domain-more.test.mjs). Taxas em centésimos de %.
// =============================================================

import { sumCents } from '../core/money.js';
import { todayISO, ymOf, addMonthsYM, monthRange, dateInMonth, parseYM, daysInMonth, toISO } from '../core/dates.js';
import { nthBusinessDay } from '../core/calendar.js';
import { positionAt, investingOf, typeOf, evolution, project, annualRate } from './investments.js';

// ---------- Proventos (renda passiva) ----------

/**
 * Proventos recebidos por mês (últimos `months`) e a renda passiva
 * dos últimos 12 meses.
 * → { months: [{ ym, cents, items }], last12, avgMonthly, byAsset: [{ name, cents }] }
 */
export function dividendsCalendar(state, months = 12, today = todayISO()) {
  const range = monthRange(ymOf(today), months);
  const all = (state.investments || []).flatMap((inv) => (inv.movements || []).filter((m) => m.kind === 'provento').map((m) => ({ inv, m })));
  const byMonth = range.map((ym) => {
    const items = all.filter(({ m }) => ymOf(m.date) === ym);
    return { ym, cents: sumCents(items.map(({ m }) => m.cents)), items };
  });
  const since = endOfMonth(addMonthsYM(ymOf(today), -12));
  const last12 = sumCents(all.filter(({ m }) => m.date > since && m.date <= today).map(({ m }) => m.cents));
  const assets = new Map();
  for (const { inv, m } of all.filter(({ m }) => range.includes(ymOf(m.date)))) assets.set(inv.name, (assets.get(inv.name) || 0) + m.cents);
  return { months: byMonth, last12, avgMonthly: Math.round(last12 / 12), byAsset: [...assets.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents) };
}

// ---------- Comparação com CDI, IPCA e Ibovespa ----------

/**
 * Rentabilidade da carteira mês a mês (método de Dietz simples:
 * ganho ÷ (saldo inicial + metade dos aportes líquidos)) e os índices
 * no mesmo período, acumulados.
 * → { months: [{ ym, portfolio, cdi, ipca, ibov }], cumulative: {...} } (frações)
 */
export function benchmarks(state, months = 12, today = todayISO()) {
  const ev = evolution(state, ymOf(today), months + 1, today);
  const flows = (ym) => sumCents((state.investments || []).flatMap((i) => i.movements || []).filter((m) => ymOf(m.date) === ym)
    .map((m) => (m.kind === 'aporte' ? m.cents : m.kind === 'resgate' || m.kind === 'venda' ? -m.cents : 0)));
  const idx = state.settings.indices || {};
  const inv = investingOf(state.settings);
  const fallbackCdi = (1 + inv.cdiBp / 10000) ** (1 / 12) - 1;
  const out = [];
  for (let i = 1; i < ev.length; i++) {
    const start = ev[i - 1].value;
    const end = ev[i].value;
    const f = flows(ev[i].ym);
    const base = start + f / 2;
    out.push({
      ym: ev[i].ym,
      portfolio: base > 0 ? (end - start - f) / base : 0,
      cdi: idx.cdiMonthly?.[ev[i].ym] != null ? idx.cdiMonthly[ev[i].ym] / 10000 : fallbackCdi,
      ipca: idx.ipcaMonthly?.[ev[i].ym] != null ? idx.ipcaMonthly[ev[i].ym] / 10000 : (1 + (idx.ipca12Bp ?? inv.ipcaBp) / 10000) ** (1 / 12) - 1,
      ibov: idx.ibovMonthly?.[ev[i].ym] != null ? idx.ibovMonthly[ev[i].ym] / 10000 : null,
    });
  }
  const acc = (k) => {
    if (out.some((m) => m[k] == null)) return null;
    return out.reduce((a, m) => a * (1 + m[k]), 1) - 1;
  };
  const series = (k) => { let a = 1; return out.map((m) => { a *= 1 + (m[k] ?? 0); return a - 1; }); };
  return {
    months: out,
    cumulative: { portfolio: acc('portfolio'), cdi: acc('cdi'), ipca: acc('ipca'), ibov: acc('ibov') },
    series: { portfolio: series('portfolio'), cdi: series('cdi'), ipca: series('ipca'), ibov: out.some((m) => m.ibov == null) ? null : series('ibov') },
    estimated: { cdi: !Object.keys(idx.cdiMonthly || {}).length, ipca: !Object.keys(idx.ipcaMonthly || {}).length },
  };
}

// ---------- IR na venda de ações, FIIs e ETFs ----------

const EXEMPT_LIMIT = 2000000; // R$ 20 mil/mês em vendas de AÇÕES (operações comuns)

/** Último dia útil do mês (vencimento do DARF: mês seguinte à venda). */
function lastBusinessDay(ym) {
  for (let n = 23; n >= 1; n--) {
    const d = nthBusinessDay(ym, n, { saturdayCounts: false });
    if (ymOf(d) === ym) return d;
  }
  return dateInMonth(ym, 28);
}

/**
 * Vendas de renda variável no ano, mês a mês, com o imposto devido.
 *  • Ações: isentas se as VENDAS do mês somam até R$ 20 mil; acima, 15% sobre o lucro.
 *  • FII: 20% sobre o lucro, sem isenção. ETF/BDR: 15%, sem isenção.
 *  • Prejuízos abatem lucros futuros da mesma natureza.
 *  DARF código 6015, até o último dia útil do mês seguinte.
 * → { months: [{ ym, sales: {acoes, fii, etf}, gains: {...}, tax, exempt, darfDue }], total }
 */
export function stockSalesTax(state, year) {
  const investing = investingOf(state.settings);
  const kinds = { acoes: 'acoes', fii: 'fii', etf: 'etf' };
  const sales = [];
  for (const inv of state.investments || []) {
    const k = kinds[inv.type];
    if (!k) continue;
    const movs = [...(inv.movements || [])].sort((a, b) => a.date.localeCompare(b.date));
    for (const m of movs) {
      if (m.kind !== 'venda' && !(m.kind === 'resgate' && k)) continue;
      if (!m.date.startsWith(String(year))) continue;
      const before = positionAt({ ...inv, movements: movs.filter((x) => x.date < m.date || (x.date === m.date && x.id !== m.id && x.kind !== 'venda' && x.kind !== 'resgate')) }, investing, m.date);
      // Com quantidade: custo = preço médio × cotas vendidas (o valor da posição
      // sem atualização de saldo é o próprio custo, o que zerava o lucro).
      const cost = m.qty && before.qty > 0
        ? Math.round(before.principal * Math.min(1, m.qty / before.qty))
        : before.value > 0 ? Math.round(before.principal * Math.min(1, m.cents / before.value)) : 0;
      sales.push({ ym: ymOf(m.date), kind: k, value: m.cents, gain: m.cents - cost, inv: inv.name });
    }
  }
  const carry = { acoes: 0, fii: 0, etf: 0 }; // prejuízo a compensar (negativo)
  const months = [];
  let total = 0;
  for (let i = 1; i <= 12; i++) {
    const ym = `${year}-${String(i).padStart(2, '0')}`;
    const list = sales.filter((s) => s.ym === ym);
    if (!list.length) continue;
    const sum = (k, f) => sumCents(list.filter((s) => s.kind === k).map((s) => s[f]));
    const sold = { acoes: sum('acoes', 'value'), fii: sum('fii', 'value'), etf: sum('etf', 'value') };
    const gains = { acoes: sum('acoes', 'gain'), fii: sum('fii', 'gain'), etf: sum('etf', 'gain') };
    const exempt = sold.acoes > 0 && sold.acoes <= EXEMPT_LIMIT;
    let tax = 0;
    for (const [k, rate] of [['acoes', 0.15], ['fii', 0.2], ['etf', 0.15]]) {
      if (k === 'acoes' && exempt) continue; // lucro isento; prejuízo do mês isento não compensa
      const net = gains[k] + carry[k];
      if (net > 0) { tax += Math.round(net * rate); carry[k] = 0; } else carry[k] = net;
    }
    total += tax;
    months.push({ ym, sales: sold, gains, exempt, tax, darfDue: tax ? lastBusinessDay(addMonthsYM(ym, 1)) : null, darfCode: '6015', items: list });
  }
  return { months, total, carry };
}

// ---------- Independência financeira ----------

/**
 * Quanto juntar para viver de renda: custo mensal × 12 ÷ taxa de retirada
 * (regra dos 4%). Projeta o patrimônio com aportes e juros REAIS
 * (rentabilidade − inflação) até a idade-alvo.
 * → { target, current, years, needMonthly, projection, reachAge, onTrack }
 */
export function fiPlan({ currentCents, monthlyCents, age, targetAge, monthlyCostCents, withdrawalBp = 400, annualRealRate = 0.04 }) {
  const target = Math.round((monthlyCostCents * 12) / (withdrawalBp / 10000));
  const months = Math.max(1, (targetAge - age) * 12);
  const p = project({ startCents: currentCents, monthlyCents, annualRate: annualRealRate, months, targetCents: target });
  // Aporte mensal necessário para chegar à meta no prazo (anuidade)
  const r = (1 + annualRealRate) ** (1 / 12) - 1;
  const fvCurrent = currentCents * (1 + r) ** months;
  const needMonthly = Math.max(0, Math.ceil(((target - fvCurrent) * r) / ((1 + r) ** months - 1)));
  return {
    target, current: currentCents, years: targetAge - age, needMonthly, projection: p,
    reachAge: p.monthsToTarget != null ? age + p.monthsToTarget / 12 : null,
    onTrack: p.final >= target,
    passiveAtTarget: Math.round((p.final * withdrawalBp) / 10000 / 12),
  };
}

/** Rentabilidade real estimada da carteira (taxas médias − IPCA). */
export function realRate(state) {
  const inv = investingOf(state.settings);
  const cdi = annualRate({ rate: { kind: 'cdi', bp: 10000 } }, inv);
  return Math.max(0.01, (1 + cdi) / (1 + inv.ipcaBp / 10000) - 1);
}

// ---------- PGBL × VGBL ----------

/**
 * Compara aplicar o mesmo valor por ano em PGBL e VGBL.
 * PGBL: deduz até 12% da renda tributável na declaração COMPLETA; a
 *       restituição extra (aporte × alíquota marginal) é reinvestida.
 *       No resgate, IR (tabela regressiva, 10% após 10 anos) sobre TUDO.
 * VGBL: sem dedução; IR só sobre o RENDIMENTO.
 * → { pgbl: { final, tax, net, deductible, refundYearly }, vgbl: {...}, best, note }
 */
export function pensionCompare({ annualContribution, taxableIncome, years = 20, annualRate: rate = 0.08, marginalRate = 0.275, fullDeclaration = true }) {
  const deductible = fullDeclaration ? Math.min(annualContribution, Math.round(taxableIncome * 0.12)) : 0;
  const refundYearly = Math.round(deductible * marginalRate);
  const regressive = years > 10 ? 0.1 : years > 8 ? 0.15 : years > 6 ? 0.2 : years > 4 ? 0.25 : years > 2 ? 0.3 : 0.35;
  const fv = (yearly) => {
    let v = 0;
    for (let i = 0; i < years; i++) v = (v + yearly) * (1 + rate);
    return Math.round(v);
  };
  const pgblFinal = fv(annualContribution);
  const pgblTax = Math.round(pgblFinal * regressive);
  const refundFinal = fv(refundYearly); // restituição reinvestida (fora do plano, sem IR por simplicidade)
  const vgblFinal = fv(annualContribution);
  const invested = annualContribution * years;
  const vgblTax = Math.round(Math.max(0, vgblFinal - invested) * regressive);
  const pgbl = { final: pgblFinal, tax: pgblTax, net: pgblFinal - pgblTax + refundFinal, deductible, refundYearly, refundFinal };
  const vgbl = { final: vgblFinal, tax: vgblTax, net: vgblFinal - vgblTax };
  return {
    pgbl, vgbl, regressive, best: pgbl.net > vgbl.net ? 'pgbl' : 'vgbl',
    note: fullDeclaration ? 'O PGBL compensa para quem faz a declaração completa e reinveste a restituição.' : 'Na declaração simplificada, o PGBL não dá benefício: o VGBL é melhor.',
  };
}

/** Classe de IR na venda por tipo (para exibir). */
export const saleTaxLabel = (inv) => ({ acoes: 'Ações · isento até R$ 20 mil/mês em vendas', fii: 'FII · 20% sobre o lucro', etf: 'ETF/BDR · 15% sobre o lucro' }[inv.type] || typeOf(inv).label);

/** Último dia do mês (exportado para os testes). */
export const endOfMonth = (ym) => { const { y, m } = parseYM(ym); return toISO(y, m, daysInMonth(y, m)); };
