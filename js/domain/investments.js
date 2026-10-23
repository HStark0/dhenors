// =============================================================
// investments.js — Carteira de investimentos (cálculos puros)
// -------------------------------------------------------------
// Cada investimento guarda só os MOVIMENTOS (aportes, resgates,
// proventos e atualizações de saldo). Todo o resto é calculado:
//
//  • Renda fixa com taxa (% do CDI, prefixado, IPCA+, poupança):
//    o saldo cresce sozinho por estimativa, dia a dia, até o
//    vencimento. Uma "atualização de saldo" corrige a estimativa
//    com o valor real do extrato.
//  • Renda variável (ações, FII, cripto…): o valor muda quando você
//    atualiza o saldo OU, se o investimento tem código (ticker) e
//    quantidade, pela cotação baixada da brapi (core/market.js).
//  • "Venda" é um resgate de renda variável: entra no cálculo do IR
//    sobre vendas de ações (isenção de R$ 20 mil/mês, DARF).
//
// Taxas em centésimos de % ao ano (1490 = 14,90% a.a.).
// Valores em centavos.
// =============================================================

import { todayISO, diffDays, ymOf, addMonthsYM, monthRange, daysInMonth, parseYM, toISO } from '../core/dates.js';
import { sumCents } from '../core/money.js';

// ---------- Catálogo ----------

/** Classes de ativo (para a alocação da carteira). */
export const INVEST_CLASSES = {
  rf: { label: 'Renda fixa', color: '#2563EB' },
  fundos: { label: 'Fundos', color: '#8B5CF6' },
  rv: { label: 'Renda variável', color: '#16A34A' },
  cripto: { label: 'Cripto', color: '#F59E0B' },
  prev: { label: 'Previdência', color: '#06B6D4' },
  outros: { label: 'Outros', color: '#64748B' },
};
export const CLASS_KEYS = Object.keys(INVEST_CLASSES);

/**
 * Tipos de investimento. `rate` é a taxa sugerida ao criar;
 * `taxed` = sofre IR regressivo na renda fixa (LCI/LCA e poupança são isentas).
 */
export const INVEST_TYPES = {
  tesouro_selic: { label: 'Tesouro Selic', cls: 'rf', icon: 'landmark', rate: { kind: 'cdi', bp: 10000 }, taxed: true, liquidity: 'd1' },
  tesouro_pre: { label: 'Tesouro Prefixado', cls: 'rf', icon: 'landmark', rate: { kind: 'pre', bp: 1300 }, taxed: true, liquidity: 'maturity' },
  tesouro_ipca: { label: 'Tesouro IPCA+', cls: 'rf', icon: 'landmark', rate: { kind: 'ipca', bp: 700 }, taxed: true, liquidity: 'maturity' },
  cdb: { label: 'CDB', cls: 'rf', icon: 'building-2', rate: { kind: 'cdi', bp: 10000 }, taxed: true, liquidity: 'd0' },
  lci_lca: { label: 'LCI / LCA', cls: 'rf', icon: 'house', rate: { kind: 'cdi', bp: 9000 }, taxed: false, liquidity: 'maturity' },
  caixinha: { label: 'Caixinha / conta remunerada', cls: 'rf', icon: 'wallet', rate: { kind: 'cdi', bp: 10000 }, taxed: true, liquidity: 'd0' },
  poupanca: { label: 'Poupança', cls: 'rf', icon: 'piggy-bank', rate: { kind: 'poup', bp: 0 }, taxed: false, liquidity: 'd0' },
  cri_cra: { label: 'CRI / CRA / Debênture incentivada', cls: 'rf', icon: 'scroll-text', rate: { kind: 'ipca', bp: 650 }, taxed: false, liquidity: 'maturity' },
  fundo: { label: 'Fundo de investimento', cls: 'fundos', icon: 'layers', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'd30' },
  acoes: { label: 'Ações', cls: 'rv', icon: 'chart-candlestick', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'd2' },
  fii: { label: 'Fundos imobiliários (FII)', cls: 'rv', icon: 'building', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'd2' },
  etf: { label: 'ETF / BDR', cls: 'rv', icon: 'globe', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'd2' },
  cripto: { label: 'Criptomoedas', cls: 'cripto', icon: 'coins', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'd0' },
  previdencia: { label: 'Previdência privada (PGBL/VGBL)', cls: 'prev', icon: 'umbrella', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'd30' },
  outro: { label: 'Outro', cls: 'outros', icon: 'briefcase', rate: { kind: 'none', bp: 0 }, taxed: false, liquidity: 'none' },
};

/** Como a taxa é informada. */
export const RATE_KINDS = {
  cdi: { label: '% do CDI', unit: '% do CDI' },
  pre: { label: 'Prefixado (% ao ano)', unit: '% a.a.' },
  ipca: { label: 'IPCA + (% ao ano)', unit: '% a.a. + IPCA' },
  poup: { label: 'Regra da poupança', unit: '' },
  none: { label: 'Sem taxa fixa (atualizo o saldo)', unit: '' },
};

/** Quando o dinheiro fica disponível após pedir o resgate. */
export const LIQUIDITY = {
  d0: 'Diária (D+0)',
  d1: 'D+1',
  d2: 'D+2',
  d30: 'Até 30 dias',
  d90: 'Mais de 30 dias',
  maturity: 'Só no vencimento',
  none: 'Não definida',
};
/** Liquidez boa para reserva de emergência. */
export const isLiquid = (key) => key === 'd0' || key === 'd1' || key === 'd2';

export const MOVEMENT_KINDS = {
  aporte: { label: 'Aporte', sign: 1 },
  resgate: { label: 'Resgate', sign: -1 },
  provento: { label: 'Provento / rendimento recebido', sign: 1 },
  saldo: { label: 'Atualização de saldo', sign: 0 },
  venda: { label: 'Venda (ações, FII, ETF)', sign: -1 },
};

export const DEFAULT_INVESTING = { cdiBp: 1490, ipcaBp: 450, selicBp: 1500, monthlyTargetCents: 0, targets: {} };

export const typeOf = (inv) => INVEST_TYPES[inv.type] || INVEST_TYPES.outro;
export const classOf = (inv) => typeOf(inv).cls;
export const investingOf = (settings) => ({ ...DEFAULT_INVESTING, ...(settings?.investing || {}) });

// ---------- Taxas ----------

/**
 * Taxa efetiva anual estimada (decimal: 0.149 = 14,9% a.a.) ou null
 * quando o investimento não tem taxa (renda variável).
 */
export function annualRate(inv, investing) {
  const cfg = { ...DEFAULT_INVESTING, ...investing };
  const cdi = cfg.cdiBp / 10000;
  const r = inv.rate || { kind: 'none', bp: 0 };
  if (r.kind === 'cdi') {
    // "% do CDI" incide sobre a taxa DIÁRIA (252 dias úteis)
    const daily = ((1 + cdi) ** (1 / 252) - 1) * (r.bp / 10000);
    return (1 + daily) ** 252 - 1;
  }
  if (r.kind === 'pre') return r.bp / 10000;
  if (r.kind === 'ipca') return (1 + cfg.ipcaBp / 10000) * (1 + r.bp / 10000) - 1;
  if (r.kind === 'poup') {
    // Selic ≈ CDI + 0,10. Acima de 8,5%: 0,5% ao mês; abaixo: 70% da Selic (TR ignorada)
    const selic = cdi + 0.001;
    return selic > 0.085 ? 1.005 ** 12 - 1 : selic * 0.7;
  }
  return null;
}

/** Texto curto da taxa: "100% do CDI", "IPCA + 6,5%", "13% a.a.", "Poupança". */
export function rateLabel(inv) {
  const r = inv.rate || { kind: 'none' };
  const pct = (bp) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (r.kind === 'cdi') return `${pct(r.bp)} do CDI`;
  if (r.kind === 'pre') return `${pct(r.bp)} a.a.`;
  if (r.kind === 'ipca') return `IPCA + ${pct(r.bp)}`;
  if (r.kind === 'poup') return 'Regra da poupança';
  return 'Renda variável';
}

/** Alíquota do IR regressivo da renda fixa pelo prazo (dias). */
export function irRate(days) {
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

const grow = (value, rate, days) => (rate == null || days <= 0 || value <= 0 ? value : Math.round(value * (1 + rate) ** (days / 365)));

// ---------- Posição ----------

const byDate = (a, b) => a.date.localeCompare(b.date) || (a.kind === 'saldo') - (b.kind === 'saldo');

/**
 * Posição do investimento numa data.
 * → { value, principal, contributed, withdrawn, realized, income, gain,
 *     gainPct, ir, net, estimated, lastUpdate, avgDays, matured }
 *  • principal: quanto do SEU dinheiro ainda está aplicado (custo médio)
 *  • gain: rendimento ainda não resgatado (value − principal)
 *  • realized: lucro já resgatado · income: proventos recebidos
 */
export function positionAt(inv, investing, date = todayISO(), quotes = null) {
  const rate = annualRate(inv, investing);
  const end = inv.maturity && inv.maturity < date ? inv.maturity : date;
  let value = 0, principal = 0, contributed = 0, withdrawn = 0, realized = 0, income = 0, qty = 0;
  let last = null, lastUpdate = null;
  let weighted = 0; // Σ(aporte × data) para o prazo médio (IR)
  const advance = (to) => {
    if (last) value = grow(value, rate, diffDays(last, to < end ? to : end));
    last = to < end ? to : end;
  };

  for (const m of [...(inv.movements || [])].sort(byDate)) {
    if (m.date > date) break;
    advance(m.date);
    if (m.kind === 'aporte') {
      value += m.cents; principal += m.cents; contributed += m.cents;
      weighted += m.cents * diffDays(m.date, date);
      if (m.qty) qty += m.qty;
    } else if (m.kind === 'resgate' || m.kind === 'venda') {
      if (m.qty && qty > 0) {
        // Venda com quantidade: custo = preço médio × cotas vendidas; o valor
        // da posição cai na mesma proporção das cotas (o resto é lucro/prejuízo).
        const frac = Math.min(1, m.qty / qty);
        const cost = Math.round(principal * frac);
        const out = frac >= 1 ? value : Math.round(value * frac);
        realized += m.cents - cost;
        principal -= cost; value = Math.max(0, value - out); withdrawn += m.cents;
        qty = Math.max(0, qty - m.qty);
        continue;
      }
      if (m.qty) qty = Math.max(0, qty - m.qty);
      const out = Math.min(m.cents, value);
      const cost = value > 0 ? Math.round(principal * (out / value)) : 0;
      realized += out - cost;
      principal -= cost; value -= out; withdrawn += out;
    } else if (m.kind === 'provento') {
      income += m.cents;
    } else if (m.kind === 'saldo') {
      value = m.cents; lastUpdate = m.date;
    }
  }
  if (last) advance(date);

  // Cotação (renda variável com código e quantidade): vale mais que a última atualização manual
  const quote = inv.ticker && quotes ? quotes[inv.ticker] : null;
  let quoted = false;
  if (quote && qty > 0 && (!lastUpdate || String(quote.at).slice(0, 10) >= lastUpdate) && String(quote.at).slice(0, 10) <= date) {
    value = Math.round(qty * quote.price);
    lastUpdate = String(quote.at).slice(0, 10);
    quoted = true;
  }

  const gain = value - principal;
  const avgDays = contributed > 0 ? Math.round(weighted / contributed) : 0;
  const taxed = typeOf(inv).taxed;
  const ir = taxed && gain > 0 ? Math.round(gain * irRate(avgDays)) : 0;
  return {
    value, principal, contributed, withdrawn, realized, income, gain,
    gainPct: principal > 0 ? (gain / principal) * 100 : 0,
    ir, net: value - ir,
    estimated: rate != null && (!lastUpdate || lastUpdate < date),
    lastUpdate, avgDays, qty, quoted,
    avgPrice: qty > 0 ? Math.round(principal / qty) : 0,
    matured: Boolean(inv.maturity && inv.maturity <= date),
  };
}

// ---------- Carteira ----------

/**
 * Resumo da carteira.
 * → { positions: [{ inv, pos }], totals, byClass: [{ key, label, color, value, pct, target }],
 *     month: { aportes, resgates, net }, emergency }
 */
export function portfolio(state, today = todayISO()) {
  const investing = investingOf(state.settings);
  const quotes = state.settings?.quotes || null;
  const positions = (state.investments || []).map((inv) => ({ inv, pos: positionAt(inv, investing, today, quotes) }));
  const sum = (k) => sumCents(positions.map((p) => p.pos[k]));
  const totals = {
    value: sum('value'), principal: sum('principal'), contributed: sum('contributed'), withdrawn: sum('withdrawn'),
    realized: sum('realized'), income: sum('income'), gain: sum('gain'), ir: sum('ir'), net: sum('net'),
  };
  totals.profit = totals.gain + totals.realized + totals.income;
  totals.gainPct = totals.principal > 0 ? (totals.gain / totals.principal) * 100 : 0;

  const byClass = CLASS_KEYS.map((key) => {
    const value = sumCents(positions.filter((p) => classOf(p.inv) === key).map((p) => p.pos.value));
    return { key, ...INVEST_CLASSES[key], value, pct: totals.value > 0 ? (value / totals.value) * 100 : 0, target: investing.targets[key] || 0 };
  });

  const ym = ymOf(today);
  const inMonth = (kind) => sumCents((state.investments || []).flatMap((i) => i.movements || [])
    .filter((m) => m.kind === kind && ymOf(m.date) === ym).map((m) => m.cents));
  const month = { aportes: inMonth('aporte'), resgates: inMonth('resgate') + inMonth('venda') };
  month.net = month.aportes - month.resgates;

  const emergency = sumCents(positions.filter((p) => p.inv.emergency).map((p) => p.pos.value));
  return { positions, totals, byClass, month, emergency, investing };
}

/**
 * Evolução mês a mês (fim de cada mês; o mês atual vai até hoje).
 * → [{ ym, value, principal }]
 */
export function evolution(state, endYM, count = 12, today = todayISO()) {
  const investing = investingOf(state.settings);
  return monthRange(endYM, count).map((ym) => {
    const { y, m } = parseYM(ym);
    const last = toISO(y, m, daysInMonth(y, m));
    const date = last < today ? last : today;
    const list = (state.investments || []).map((inv) => positionAt(inv, investing, date, date === today ? state.settings?.quotes : null));
    return { ym, value: sumCents(list.map((p) => p.value)), principal: sumCents(list.map((p) => p.principal)) };
  });
}

/** Média de aportes líquidos (aportes − resgates e vendas) dos últimos `months` meses fechados. */
export function averageMonthlyContribution(state, months = 6, today = todayISO()) {
  const range = monthRange(addMonthsYM(ymOf(today), -1), months);
  const movs = (state.investments || []).flatMap((i) => i.movements || []);
  const total = sumCents(range.map((ym) => sumCents(movs.filter((m) => ymOf(m.date) === ym)
    // venda de ações/FII também tira dinheiro da carteira, como o resgate
    .map((m) => (m.kind === 'aporte' ? m.cents : m.kind === 'resgate' || m.kind === 'venda' ? -m.cents : 0)))));
  return Math.max(0, Math.round(total / months));
}

/**
 * Sugestão de onde colocar o próximo aporte para chegar perto da
 * carteira ideal (sem vender nada). targets: { classe: % }.
 * → [{ key, label, cents }] (só classes que recebem algo)
 */
export function rebalance(byClass, aporteCents) {
  const withTarget = byClass.filter((c) => c.target > 0);
  if (!withTarget.length || aporteCents <= 0) return [];
  const total = sumCents(byClass.map((c) => c.value)) + aporteCents;
  const gaps = withTarget.map((c) => ({ ...c, gap: Math.max(0, Math.round((total * c.target) / 100) - c.value) }));
  const gapSum = sumCents(gaps.map((g) => g.gap));
  if (!gapSum) return [];
  const out = gaps.filter((g) => g.gap > 0).map((g) => ({ key: g.key, label: g.label, color: g.color, cents: Math.floor((aporteCents * Math.min(g.gap, gapSum)) / gapSum) }));
  // centavos que sobram da divisão vão para a maior fatia
  const rest = aporteCents - sumCents(out.map((o) => o.cents));
  if (rest > 0 && out.length) out.sort((a, b) => b.cents - a.cents)[0].cents += rest;
  return out.filter((o) => o.cents > 0);
}

// ---------- Projeção (juros compostos) ----------

/**
 * Projeta o patrimônio com aportes mensais.
 * → { points: [{ month, value, contributed }], final, contributed, interest, monthsToTarget }
 */
export function project({ startCents = 0, monthlyCents = 0, annualRate: rate = 0, months = 120, targetCents = 0 }) {
  const monthly = (1 + rate) ** (1 / 12) - 1;
  let value = startCents, contributed = startCents, monthsToTarget = targetCents > 0 && startCents >= targetCents ? 0 : null;
  const points = [{ month: 0, value, contributed }];
  const limit = Math.max(months, targetCents > 0 ? 600 : 0); // procura a meta em até 50 anos
  for (let i = 1; i <= limit; i++) {
    value = Math.round(value * (1 + monthly)) + monthlyCents;
    contributed += monthlyCents;
    if (i <= months) points.push({ month: i, value, contributed });
    if (monthsToTarget == null && targetCents > 0 && value >= targetCents) monthsToTarget = i;
    if (i >= months && (monthsToTarget != null || !targetCents)) break;
  }
  const last = points[points.length - 1];
  return { points, final: last.value, contributed: last.contributed, interest: last.value - last.contributed, monthsToTarget };
}

/** Renda mensal que o patrimônio sustenta (regra dos 4% ao ano). */
export const passiveIncome = (valueCents) => Math.round((valueCents * 0.04) / 12);

// ---------- Avisos ----------

/** Vencimentos nos próximos `days` dias (inclui vencidos com saldo). */
export function upcomingMaturities(state, days = 30, today = todayISO()) {
  const investing = investingOf(state.settings);
  return (state.investments || [])
    .filter((inv) => inv.maturity && diffDays(today, inv.maturity) <= days)
    .map((inv) => ({ inv, days: diffDays(today, inv.maturity), pos: positionAt(inv, investing, today) }))
    .filter((x) => x.pos.value > 0)
    .sort((a, b) => a.inv.maturity.localeCompare(b.inv.maturity));
}

/**
 * Dicas sobre a carteira. → [{ tone: 'good'|'info'|'warn', title, text }]
 * `reserveMonths` = meses de gastos cobertos pela reserva (planning.js).
 */
export function investInsights(state, pf, { reserveMonths = null, today = todayISO() } = {}) {
  const out = [];
  if (!pf.positions.length) return out;
  const { totals, byClass, investing } = pf;

  for (const m of upcomingMaturities(state, 30, today)) {
    out.push(m.days < 0
      ? { tone: 'warn', title: `${m.inv.name} já venceu`, text: 'O dinheiro costuma cair na conta da corretora. Registre o resgate ou reaplique para não ficar parado.' }
      : { tone: 'info', title: `${m.inv.name} vence ${m.days === 0 ? 'hoje' : `em ${m.days} ${m.days === 1 ? 'dia' : 'dias'}`}`, text: 'Planeje onde reaplicar o valor.' });
  }

  if (!pf.emergency) {
    out.push({ tone: 'info', title: 'Marque a sua reserva de emergência', text: 'Edite o investimento de liquidez diária que é a sua reserva e marque "reserva de emergência". Ela entra na Saúde financeira.' });
  } else if (reserveMonths != null && reserveMonths < 6) {
    out.push({ tone: 'warn', title: `Reserva cobre ${reserveMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${reserveMonths >= 1 && reserveMonths < 2 ? 'mês' : 'meses'} de gastos`, text: 'O ideal é de 6 meses (ou 12, para autônomos) em algo com liquidez diária antes de arriscar em renda variável.' });
  }
  for (const { inv } of pf.positions) {
    if (inv.emergency && !isLiquid(inv.liquidity)) {
      out.push({ tone: 'warn', title: `${inv.name} não tem liquidez diária`, text: 'A reserva de emergência precisa poder ser sacada a qualquer momento, sem perder rendimento.' });
    }
  }

  const poup = pf.positions.filter((p) => p.inv.type === 'poupanca' && p.pos.value > 0);
  if (poup.length) {
    const cdb = annualRate({ rate: { kind: 'cdi', bp: 10000 } }, investing) * (1 - irRate(721));
    const pRate = annualRate({ rate: { kind: 'poup' } }, investing);
    if (cdb > pRate) {
      out.push({ tone: 'info', title: 'A poupança está rendendo menos', text: `Poupança ≈ ${(pRate * 100).toFixed(1).replace('.', ',')}% a.a.; um CDB ou Tesouro Selic a 100% do CDI daria ≈ ${(cdb * 100).toFixed(1).replace('.', ',')}% a.a. já sem IR (prazo longo), com a mesma liquidez.` });
    }
  }

  const stale = pf.positions.filter((p) => annualRate(p.inv, investing) == null && p.pos.value > 0
    && (!p.pos.lastUpdate || diffDays(p.pos.lastUpdate, today) > 45));
  if (stale.length) {
    out.push({ tone: 'info', title: `Atualize o saldo de ${stale.length === 1 ? stale[0].inv.name : `${stale.length} investimentos`}`, text: 'Renda variável não tem estimativa automática: confira o valor no app da corretora e use "Atualizar saldo".' });
  }

  const hasTargets = byClass.some((c) => c.target > 0);
  if (hasTargets) {
    const off = byClass.filter((c) => c.target > 0 || c.value > 0).map((c) => ({ ...c, diff: c.pct - c.target })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    if (off && Math.abs(off.diff) >= 5) {
      out.push({ tone: 'info', title: `${off.label} está ${off.diff > 0 ? 'acima' : 'abaixo'} da carteira ideal`, text: `${off.pct.toFixed(0)}% hoje × ${off.target}% planejado. Direcione os próximos aportes para equilibrar, sem precisar vender.` });
    }
  } else {
    const top = [...byClass].sort((a, b) => b.pct - a.pct)[0];
    if (top && top.pct >= 90 && pf.positions.length > 1 && top.key !== 'rf') {
      out.push({ tone: 'warn', title: `${top.pct.toFixed(0)}% da carteira em ${top.label}`, text: 'Concentrar tudo numa classe de risco aumenta as oscilações. Defina uma carteira ideal em "Configurar".' });
    }
  }

  if (investing.monthlyTargetCents > 0) {
    const left = investing.monthlyTargetCents - pf.month.net;
    out.push(left <= 0
      ? { tone: 'good', title: 'Meta de aporte do mês batida', text: 'Pagar-se primeiro é o hábito que mais faz o patrimônio crescer.' }
      : { tone: 'info', title: 'Meta de aporte do mês', text: `Faltam ${(left / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para a meta deste mês.` });
  }

  if (totals.ir > 0) {
    out.push({ tone: 'info', title: 'IR estimado ao resgatar', text: `${(totals.ir / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (tabela regressiva da renda fixa: de 22,5% até 15% após 2 anos). O valor líquido já aparece em cada investimento.` });
  }
  return out;
}
