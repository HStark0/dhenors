// =============================================================
// analysis.js — Fechamento, histórico, projeção e insights
// -------------------------------------------------------------
// Também são funções puras, construídas em cima de ledger.js.
// =============================================================

import { sumCents, percent, formatBRL, formatPercent, plural } from '../core/money.js';
import { addMonthsYM, monthRange, todayISO, ymOf, formatMonth, formatMonthShort } from '../core/dates.js';
import { computeMonth, installmentSummary } from './ledger.js';

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
      paid: i.status === 'paid', parcel: i.parcel || null, category: catName(i.categoryId),
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
      fixed: snap.totals.recurring + snap.totals.installment, variable: snap.totals.expense,
      balance: snap.balance, categories: snap.categories, itemCount: snap.items.length,
    };
  }
  const m = computeMonth(state, ym, today);
  return {
    ym, closed: false,
    income: m.income.total, salary: m.income.salary, extras: m.income.extrasCents,
    spent: m.totals.all, paid: m.totals.paid, pending: m.totals.pending,
    fixed: m.totals.recurring + m.totals.installment, variable: m.totals.expense,
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
    const variable = Math.max(m.totals.expense, variableEstimate);
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
    if (share >= 35) out.push({ tone: 'info', title: `${top.icon} ${top.name} concentra ${formatPercent(share)}`, text: `${formatBRL(top.cents)} dos gastos do mês estão nessa categoria.` });
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
    out.push({ tone: 'good', title: `${income.thirteenth.label}: ${formatBRL(income.thirteenth.net)}`, text: 'Já está somado na renda do mês. Bom momento para reforçar a reserva ou quitar dívidas.' });
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
