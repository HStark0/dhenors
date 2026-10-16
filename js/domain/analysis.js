// @ts-check
// =============================================================
// analysis.js — Fechamento, histórico, projeção e insights
// -------------------------------------------------------------
// Também são funções puras, construídas em cima de ledger.js.
// =============================================================

import { sumCents, percent, formatBRL, formatPercent, plural } from '../core/money.js';
import { addMonthsYM, monthRange, todayISO, ymOf, formatMonth, formatMonthShort, monthsBetween } from '../core/dates.js';
import { computeMonth, installmentSummary, itemParts } from './ledger.js';

// ---------- Fechamento do mês ----------

/**
 * Fotografia do mês no momento do fechamento.
 * Nada é apagado ao fechar: o snapshot só congela os números
 * para o histórico e o mês passa a ficar bloqueado para edição.
 */
export function buildSnapshot(state, ym, today = todayISO()) {
  const m = computeMonth(state, ym, today);
  const catName = (id) => state.categories.find((c) => c.id === id)?.name || 'Sem categoria';
  return {
    ym,
    closedAt: new Date().toISOString(),
    closedOn: todayISO(), // data local do fechamento
    income: {
      salary: m.income.salary,
      extrasCents: m.income.extrasCents,
      extras: m.income.extras.map((x) => ({ description: x.description, cents: x.cents, payroll: Boolean(x.payroll) })),
      total: m.income.total,
      thirteenth: m.income.thirteenth ? { label: m.income.thirteenth.label, net: m.income.thirteenth.net } : null,
      vacation: m.income.vacation ? { days: m.income.vacation.days, net: m.income.vacation.net } : null,
      // resumo do contracheque no fechamento
      payroll: {
        gross: m.income.payroll.gross, inss: m.income.payroll.inss, ir: m.income.payroll.ir.value,
        deductions: m.income.payroll.deductionsTotal, net: m.income.payroll.net,
      },
    },
    totals: m.totals,
    balance: m.balance,
    cashBalance: m.cashBalance,
    categories: m.categories.map(({ name, icon, color, cents }) => ({ name, icon, color, cents })),
    items: m.items.map((i) => ({
      kind: i.kind, description: i.description, cents: i.cents, dueDate: i.dueDate,
      paid: i.status === 'paid', paidAt: i.paidAt || null, parcel: i.parcel || null,
      category: i.kind === 'invoice' ? 'Cartão de crédito' : catName(i.categoryId),
    })),
  };
}

/**
 * Resumo uniforme de um mês: usa o snapshot se o mês estiver
 * fechado, senão calcula ao vivo.
 */
export function monthSummary(state, ym, today = todayISO()) {
  const snap = state.closedMonths[ym];
  if (snap) {
    return {
      ym, closed: true,
      income: snap.income.total, salary: snap.income.salary, extras: snap.income.extrasCents,
      spent: snap.totals.all, paid: snap.totals.paid, pending: snap.totals.pending,
      fixed: snap.totals.recurring + snap.totals.installment, variable: snap.totals.expense + (snap.totals.invoice || 0),
      balance: snap.balance, categories: snap.categories, itemCount: snap.items.length,
    };
  }
  const m = computeMonth(state, ym, today);
  return {
    ym, closed: false,
    income: m.income.total, salary: m.income.salary, extras: m.income.extrasCents,
    spent: m.totals.all, paid: m.totals.paid, pending: m.totals.pending,
    fixed: m.totals.recurring + m.totals.installment, variable: m.totals.expense + m.totals.invoice,
    balance: m.balance, categories: m.categories, itemCount: m.items.length,
  };
}

/** Série de N meses terminando em endYM. */
export function monthSeries(state, endYM, count, today = todayISO()) {
  return monthRange(endYM, count).map((ym) => monthSummary(state, ym, today));
}

/** Mediana (usada para estimar gastos avulsos futuros). */
export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

// ---------- Análise de período ----------

export function periodAnalysis(state, endYM, months, today = todayISO()) {
  const series = monthSeries(state, endYM, months, today);
  const withData = series.filter((s) => s.income > 0 || s.spent > 0);
  const n = Math.max(1, withData.length);

  const income = sumCents(series.map((s) => s.income));
  const spent = sumCents(series.map((s) => s.spent));
  const extras = sumCents(series.map((s) => s.extras));
  const fixed = sumCents(series.map((s) => s.fixed));

  // Categorias somadas no período
  const catMap = new Map();
  for (const s of series) {
    for (const c of s.categories) {
      const prev = catMap.get(c.name) || { ...c, cents: 0 };
      prev.cents += c.cents;
      catMap.set(c.name, prev);
    }
  }
  const categories = [...catMap.values()].sort((a, b) => b.cents - a.cents);

  return {
    series,
    months: withData.length,
    income, spent, extras, fixed,
    avgIncome: Math.round(income / n),
    avgSpent: Math.round(spent / n),
    avgExtras: Math.round(extras / n),
    balance: income - spent,
    savingsRate: percent(income - spent, income),
    fixedRate: percent(fixed, income),
    extrasShare: percent(extras, income),
    categories,
  };
}

// ---------- Projeção ----------

/**
 * Projeção dos próximos `months` meses a partir de `fromYM`.
 * Considera: salário vigente, recorrentes, parcelas agendadas e
 * despesas avulsas já lançadas. Para o gasto avulso "do dia a dia"
 * usa a mediana dos últimos 3 meses, quando maior que o já lançado.
 */
export function projection(state, fromYM, months = 6, today = todayISO()) {
  const history = monthSeries(state, addMonthsYM(fromYM, -1), 3, today);
  const variableEstimate = median(history.map((h) => h.variable).filter((v) => v > 0));
  const avgExtras = Math.round(sumCents(history.map((h) => h.extras)) / 3);

  return Array.from({ length: months }, (_, i) => {
    const ym = addMonthsYM(fromYM, i);
    const m = computeMonth(state, ym, today);
    const variable = Math.max(m.totals.expense + m.totals.invoice, variableEstimate);
    const salary = m.income.salary; // líquido do salário (sem extras)
    const extras = m.income.extrasCents;
    const spent = m.totals.recurring + m.totals.installment + variable;
    return {
      ym, salary, extras, avgExtras,
      recurring: m.totals.recurring,
      installment: m.totals.installment,
      variable,
      spent,
      balance: salary + extras - spent,
      balanceWithoutExtras: salary - spent,
    };
  });
}

/** Parcelamentos que terminam a partir de `fromYM`, com o valor liberado. */
export function endingInstallments(state, fromYM) {
  return state.installments
    .map((inst) => ({ inst, sum: installmentSummary(inst) }))
    .filter(({ sum }) => !sum.finished && sum.lastYM >= fromYM)
    .map(({ inst, sum }) => ({
      id: inst.id,
      description: inst.description,
      lastYM: sum.lastYM,
      monthlyCents: sum.schedule[sum.schedule.length - 1].cents,
      remainingCents: sum.remainingCents,
    }))
    .sort((a, b) => a.lastYM.localeCompare(b.lastYM));
}

// ---------- Insights ----------

/**
 * Frases curtas e acionáveis sobre o mês.
 * → [{ tone: 'good' | 'warn' | 'bad' | 'info', title, text }]
 */
export function insightsFor(state, month, today = todayISO()) {
  const out = [];
  const { totals, income, categories, ym } = month;
  const limit = state.settings.spendingLimitCents;

  if (income.total === 0 && totals.all === 0) {
    return [{ tone: 'info', title: 'Comece por aqui', text: 'Cadastre seu salário e suas contas para ver a análise do mês.' }];
  }

  const overdue = month.items.filter((i) => i.status === 'overdue');
  if (overdue.length) {
    out.push({ tone: 'bad', title: `${plural(overdue.length, 'conta')} em atraso`, text: `Somam ${formatBRL(totals.overdue)}. Pague ou ajuste a data para não acumular juros.` });
  }

  if (month.balance < 0) {
    out.push({ tone: 'bad', title: 'Mês no vermelho', text: `Os compromissos passam a renda em ${formatBRL(-month.balance)}.` });
  } else if (income.total > 0) {
    const rate = percent(month.balance, income.total);
    if (rate >= 20) out.push({ tone: 'good', title: `Sobra prevista de ${formatPercent(rate)}`, text: `${formatBRL(month.balance)} livres. Que tal direcionar parte para uma meta?` });
  }

  if (income.extrasCents > 0 && month.balance >= 0 && month.balance - income.extrasCents < 0) {
    out.push({ tone: 'warn', title: 'Dependência da renda extra', text: `Sem os extras (${formatBRL(income.extrasCents)}), o mês fecharia em ${formatBRL(month.balance - income.extrasCents)}.` });
  }

  if (limit > 0) {
    const used = percent(totals.all, limit);
    if (used > 100) out.push({ tone: 'bad', title: 'Meta de gastos estourada', text: `${formatPercent(used)} do limite de ${formatBRL(limit)}.` });
    else if (used >= 80) out.push({ tone: 'warn', title: 'Perto do limite de gastos', text: `Já são ${formatPercent(used)} do limite de ${formatBRL(limit)}.` });
  }

  const fixed = totals.recurring + totals.installment;
  if (income.total > 0 && percent(fixed, income.total) > 50) {
    out.push({ tone: 'warn', title: 'Custos fixos altos', text: `Recorrentes e parcelas ocupam ${formatPercent(percent(fixed, income.total))} da renda.` });
  }

  if (categories.length >= 2 && totals.all > 0) {
    const top = categories[0];
    const share = percent(top.cents, totals.all);
    if (share >= 35) out.push({ tone: 'info', title: `${top.name} concentra ${formatPercent(share)}`, text: `${formatBRL(top.cents)} dos gastos do mês estão nessa categoria.` });
  }

  const prev = monthSummary(state, addMonthsYM(ym, -1), today);
  if (prev.spent > 0 && totals.all > 0) {
    const change = percent(totals.all - prev.spent, prev.spent);
    if (Math.abs(change) >= 10) {
      out.push({
        tone: change > 0 ? 'warn' : 'good',
        title: `Gastos ${change > 0 ? 'subiram' : 'caíram'} ${formatPercent(Math.abs(change))}`,
        text: `Comparado a ${formatMonth(prev.ym)} (${formatBRL(prev.spent)}).`,
      });
    }
  }

  if (income.thirteenth) {
    out.push({ tone: 'good', title: `${income.thirteenth.label}: ${formatBRL(income.thirteenth.net)}`, text: 'Chega à parte do salário e não entra no saldo previsto do mês. Bom momento para reforçar a reserva ou quitar dívidas.' });
  }

  const loansEnding = (income.payroll.deductions || []).filter((d) => d.loan && d.loan.endYM <= addMonthsYM(ym, 2));
  for (const d of loansEnding) {
    out.push({ tone: 'good', title: `${d.description} termina em ${formatMonthShort(d.loan.endYM)}`, text: `Parcela ${d.loan.n}/${d.loan.count}. Depois disso o salário líquido sobe cerca de ${formatBRL(d.cents)}.` });
  }

  const ending = endingInstallments(state, ym).filter((e) => e.lastYM <= addMonthsYM(ym, 2));
  if (ending.length) {
    const freed = sumCents(ending.map((e) => e.monthlyCents));
    out.push({ tone: 'good', title: `${plural(ending.length, 'parcelamento')} terminando`, text: `Até ${formatMonthShort(ending[ending.length - 1].lastYM)} isso libera ${formatBRL(freed)} por mês.` });
  }

  return out.slice(0, 6);
}

/** Lista de meses com qualquer dado (para o histórico). */
export function monthsWithData(state, today = todayISO()) {
  const set = new Set(Object.keys(state.closedMonths));
  for (const e of state.expenses) set.add(ymOf(e.dueDate));
  for (const p of state.cardPurchases || []) set.add(ymOf(p.date));
  for (const s of state.shifts || []) set.add(ymOf(s.date));
  for (const x of state.extraIncomes) set.add(x.ym);
  for (const inst of state.installments) for (const p of installmentSummary(inst).schedule) set.add(p.ym);
  for (const r of state.recurring) {
    let ym = r.startYM;
    const end = r.endYM || ymOf(today);
    for (let guard = 0; ym <= end && guard < 240; guard++) { set.add(ym); ym = addMonthsYM(ym, 1); }
  }
  if (state.settings.salaryHistory.length) set.add(ymOf(today));
  return [...set].filter((ym) => ym <= ymOf(today)).sort().reverse();
}

// ---------- Gastos por subcategoria (para relatórios e anomalias) ----------

/** Gastos do mês por categoria E subcategoria. → Map(chave → { level, name, parent, icon, cents }) */
export function spendingBreakdown(state, ym, today = todayISO()) {
  const snap = state.closedMonths[ym];
  const map = new Map();
  const add = (key, info, cents) => {
    const cur = map.get(key) || { ...info, cents: 0 };
    cur.cents += cents;
    map.set(key, cur);
  };
  if (snap) {
    for (const c of snap.categories) add(`c:${c.name}`, { level: 'cat', name: c.name, icon: c.icon }, c.cents);
    return map;
  }
  const m = computeMonth(state, ym, today);
  for (const item of m.items) {
    if (item.kind === 'invoice') continue; // compras do cartão entram abaixo, com subcategoria
    for (const p of itemParts(item)) {
      const cat = state.categories.find((c) => c.id === p.categoryId);
      const sub = cat?.subcategories.find((s) => s.id === p.subcategoryId);
      add(`c:${cat?.name || 'Sem categoria'}`, { level: 'cat', name: cat?.name || 'Sem categoria', icon: cat?.icon || '🏷️' }, p.cents);
      if (sub) add(`s:${cat.name}›${sub.name}`, { level: 'sub', name: sub.name, parent: cat.name, icon: cat.icon }, p.cents);
    }
  }
  for (const inv of m.items.filter((i) => i.kind === 'invoice')) {
    for (const p of inv.parts || []) {
      const cat = state.categories.find((c) => c.id === p.categoryId);
      add(`c:${cat?.name || 'Sem categoria'}`, { level: 'cat', name: cat?.name || 'Sem categoria', icon: cat?.icon || '🏷️' }, p.cents);
    }
  }
  return map;
}

// ---------- Relatório mensal automático ----------

/**
 * Relatório do mês, gerado ao fechar: compara cada categoria/subcategoria
 * com o mês anterior e com a média dos 3 anteriores.
 * → { spent, prevSpent, changePct, savedPct, highlights: [texto], rows: [...] }
 */
export function monthlyReport(state, ym, today = todayISO()) {
  const cur = spendingBreakdown(state, ym, today);
  const prevYM = addMonthsYM(ym, -1);
  const prev = spendingBreakdown(state, prevYM, today);
  const hist = [1, 2, 3].map((i) => spendingBreakdown(state, addMonthsYM(ym, -i), today));
  const s = monthSummary(state, ym, today);
  const p = monthSummary(state, prevYM, today);
  const rows = [];
  for (const [key, x] of cur) {
    const before = prev.get(key)?.cents || 0;
    const avg = Math.round(sumCents(hist.map((h) => h.get(key)?.cents || 0)) / 3);
    rows.push({ key, ...x, prevCents: before, avgCents: avg, changePct: before ? percent(x.cents - before, before) : null });
  }
  for (const [key, x] of prev) if (!cur.has(key)) rows.push({ key, ...x, cents: 0, prevCents: x.cents, avgCents: 0, changePct: -100 });
  const highlights = [];
  const changePct = p.spent ? percent(s.spent - p.spent, p.spent) : null;
  if (changePct != null && Math.abs(changePct) >= 3) highlights.push(`Você gastou ${formatPercent(Math.abs(changePct))} ${changePct < 0 ? 'menos' : 'mais'} que em ${formatMonth(prevYM)} (${formatBRL(s.spent)} × ${formatBRL(p.spent)}).`);
  const notable = rows.filter((r) => r.changePct != null && Math.abs(r.cents - r.prevCents) >= 5000 && Math.abs(r.changePct) >= 10)
    .sort((a, b) => Math.abs(b.cents - b.prevCents) - Math.abs(a.cents - a.prevCents));
  for (const r of notable.slice(0, 4)) {
    const where = r.level === 'sub' ? `com ${r.name.toLowerCase()}` : `em ${r.name}`;
    highlights.push(`Você gastou ${formatPercent(Math.abs(r.changePct))} ${r.changePct < 0 ? 'menos' : 'mais'} ${where} (${formatBRL(r.cents)}).`);
  }
  const savedPct = s.income > 0 ? percent(s.balance, s.income) : 0;
  if (s.income > 0) highlights.push(s.balance >= 0 ? `Sobrou ${formatBRL(s.balance)} (${formatPercent(savedPct)} da renda).` : `O mês fechou no vermelho em ${formatBRL(-s.balance)}.`);
  return { ym, spent: s.spent, prevSpent: p.spent, income: s.income, balance: s.balance, changePct, savedPct, highlights, rows: rows.sort((a, b) => b.cents - a.cents).slice(0, 30) };
}

// ---------- Gastos fora do padrão ----------

/**
 * Categorias/subcategorias deste mês acima da média dos últimos 6 meses.
 * → [{ name, level, cents, median, pct }] — ex.: mercado 40% acima.
 */
export function spendingAnomalies(state, ym, today = todayISO(), { threshold = 40, minCents = 5000 } = {}) {
  const cur = spendingBreakdown(state, ym, today);
  const hist = Array.from({ length: 6 }, (_, i) => spendingBreakdown(state, addMonthsYM(ym, -(i + 1)), today));
  const out = [];
  for (const [key, x] of cur) {
    const values = hist.map((h) => h.get(key)?.cents || 0).filter((v) => v > 0);
    if (values.length < 3) continue; // pouco histórico: não dá para dizer que é fora do padrão
    const med = median(values);
    if (med <= 0 || x.cents < minCents) continue;
    const pct = percent(x.cents - med, med);
    if (pct >= threshold) out.push({ key, name: x.name, parent: x.parent, level: x.level, cents: x.cents, median: med, pct });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// ---------- Comparação de períodos ----------

/**
 * Compara dois períodos à escolha (ex.: este trimestre × o mesmo do ano passado).
 * a/b = { from: 'AAAA-MM', to: 'AAAA-MM' }
 */
export function comparePeriods(state, a, b, today = todayISO()) {
  const sumPeriod = (p) => {
    const months = [];
    for (let ym = p.from; ym <= p.to && months.length < 60; ym = addMonthsYM(ym, 1)) months.push(monthSummary(state, ym, today));
    const cats = new Map();
    for (const m of months) for (const c of m.categories) cats.set(c.name, (cats.get(c.name) || 0) + c.cents);
    return {
      months: months.length,
      income: sumCents(months.map((m) => m.income)),
      spent: sumCents(months.map((m) => m.spent)),
      fixed: sumCents(months.map((m) => m.fixed)),
      variable: sumCents(months.map((m) => m.variable)),
      balance: sumCents(months.map((m) => m.balance)),
      categories: cats,
    };
  };
  const A = sumPeriod(a);
  const B = sumPeriod(b);
  const names = new Set([...A.categories.keys(), ...B.categories.keys()]);
  const rows = [...names].map((name) => {
    const va = A.categories.get(name) || 0;
    const vb = B.categories.get(name) || 0;
    const cat = state.categories.find((c) => c.name === name);
    return { name, icon: cat?.icon || '🏷️', color: cat?.color || '#64748B', a: va, b: vb, diff: va - vb, pct: vb ? percent(va - vb, vb) : null };
  }).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  const delta = (k) => ({ a: A[k], b: B[k], diff: A[k] - B[k], pct: B[k] ? percent(A[k] - B[k], B[k]) : null });
  return { a: { ...a, months: A.months }, b: { ...b, months: B.months }, income: delta('income'), spent: delta('spent'), fixed: delta('fixed'), variable: delta('variable'), balance: delta('balance'), rows };
}

// ---------- Regra 50/30/20 ----------

/** Gastos do mês por grupo (necessidades, desejos, poupança) × o planejado. */
export function ruleStatus(state, ym, today = todayISO()) {
  const rule = state.settings.rule503020 || { needs: 50, wants: 30, savings: 20 };
  const m = computeMonth(state, ym, today);
  const byGroup = { needs: 0, wants: 0, savings: 0 };
  for (const c of m.categories) byGroup[c.group || 'needs'] = (byGroup[c.group || 'needs'] || 0) + c.cents;
  // O que sobra no mês também conta como poupança
  const leftover = Math.max(0, m.balance);
  const income = m.income.total;
  const groups = ['needs', 'wants', 'savings'].map((k) => {
    const cents = k === 'savings' ? byGroup.savings + leftover : byGroup[k];
    const pct = percent(cents, income);
    const target = rule[k];
    const ok = k === 'savings' ? pct >= target : pct <= target;
    return { key: k, cents, pct, target, targetCents: Math.round((income * target) / 100), ok };
  });
  return { income, groups, rule };
}

// ---------- Envelopes ----------

/**
 * Envelopes do mês: quanto foi separado (+ o que sobrou do mês anterior,
 * se acumula), quanto já saiu (gastos das categorias do envelope) e quanto resta.
 */
export function envelopeStatus(state, ym, today = todayISO()) {
  const list = state.settings.envelopes || [];
  if (!list.length) return [];
  const spentIn = (m, env) => sumCents(m.categories.filter((c) => env.categoryIds.includes(c.id)).map((c) => c.cents));
  return list.map((env) => {
    let carry = 0;
    if (env.rollover) {
      for (let i = 6; i >= 1; i--) {
        const prev = computeMonth(state, addMonthsYM(ym, -i), today);
        if (!prev.items.length && !prev.income.total) { carry = 0; continue; }
        carry = Math.max(0, carry + env.monthlyCents - spentIn(prev, env));
      }
    }
    const m = computeMonth(state, ym, today);
    const spent = spentIn(m, env);
    const available = env.monthlyCents + carry;
    return { env, carry, available, spent, left: available - spent, pct: percent(spent, available) };
  });
}

// ---------- "O que fazer agora" (insights compactos com ação) ----------

/**
 * Até 4 ações práticas para agora, SEM repetir os alertas do sino
 * (as contas atrasadas/vencendo viram UM item que abre o sino).
 * → [{ tone, title, text, action: { label, route | act } }]
 */
export function nextActions(state, month, today = todayISO(), { alertsCount = 0 } = {}) {
  const out = [];
  if (alertsCount) out.push({ tone: 'bad', title: `${plural(alertsCount, 'conta precisa', 'contas precisam')} de atenção`, text: 'Atrasadas ou vencendo até amanhã.', action: { label: 'Ver alertas', act: 'alerts:open' } });
  for (const a of spendingAnomalies(state, month.ym, today).slice(0, 1)) {
    out.push({ tone: 'warn', title: `${a.name} ${formatPercent(a.pct)} acima da média`, text: `${formatBRL(a.cents)} neste mês; a média é ${formatBRL(a.median)}.`, action: { label: 'Ver contas', route: '#/contas' } });
  }
  for (const i of insightsFor(state, month, today)) {
    if (out.length >= 4) break;
    if (/em atraso/.test(i.title)) continue; // já está no sino
    const action = /vermelho|limite|estourada/i.test(i.title) ? { label: 'Simular cortes', route: '#/planejamento' }
      : /Sobra/.test(i.title) ? { label: 'Guardar numa meta', route: '#/metas' }
      : /parcelamento|termina/i.test(i.title) ? { label: 'Ver parcelamentos', route: '#/contas?aba=parcelas' }
      : /fixos/i.test(i.title) ? { label: 'Ver recorrentes', route: '#/contas?aba=recorrentes' }
      : /concentra|subiram/i.test(i.title) ? { label: 'Ver análise', route: '#/analise' }
      : null;
    out.push({ ...i, action });
  }
  return out.slice(0, 4);
}

// ---------- Retrospectiva do ano ("Wrapped") ----------

export function yearWrapped(state, year, today = todayISO()) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter((ym) => ym <= ymOf(today));
  const sums = months.map((ym) => monthSummary(state, ym, today));
  const income = sumCents(sums.map((s) => s.income));
  const spent = sumCents(sums.map((s) => s.spent));
  const cats = new Map();
  for (const s of sums) for (const c of s.categories) cats.set(c.name, { ...c, cents: (cats.get(c.name)?.cents || 0) + c.cents });
  const items = [];
  for (const ym of months) {
    const snap = state.closedMonths[ym];
    const list = snap ? snap.items : computeMonth(state, ym, today).items.map((i) => ({ description: i.description, cents: i.cents, dueDate: i.dueDate, kind: i.kind }));
    for (const i of list) if (i.kind !== 'invoice') items.push(i);
  }
  for (const p of state.cardPurchases || []) if (p.date.startsWith(String(year)) && p.cents > 0) items.push({ description: p.description, cents: p.cents, dueDate: p.date, kind: 'purchase' });
  const best = sums.filter((s) => s.income > 0).sort((a, b) => b.balance - a.balance)[0] || null;
  const goalsReached = state.goals.filter((g) => {
    let acc = 0;
    for (const c of [...g.contributions].sort((a, b) => a.date.localeCompare(b.date))) {
      acc += c.cents;
      if (acc >= g.targetCents) return c.date.startsWith(String(year));
    }
    return false;
  });
  const shifts = (state.shifts || []).filter((s) => s.date.startsWith(String(year))).length;
  const invested = sumCents((state.investments || []).flatMap((i) => i.movements).filter((m) => m.date.startsWith(String(year)))
    .map((m) => (m.kind === 'aporte' ? m.cents : m.kind === 'resgate' || m.kind === 'venda' ? -m.cents : 0)));
  return {
    year, months: months.length, income, spent, saved: income - spent, savedPct: percent(income - spent, income),
    topCategories: [...cats.values()].sort((a, b) => b.cents - a.cents).slice(0, 5),
    biggest: items.sort((a, b) => b.cents - a.cents).slice(0, 5),
    bestMonth: best, goalsReached, shifts, invested,
  };
}

/** Meses entre duas datas "AAAA-MM" (inclusive). */
export const monthsInRange = (from, to) => Math.max(0, monthsBetween(from, to) + 1);
