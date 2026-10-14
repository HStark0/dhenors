// =============================================================
// ledger.js — O CÁLCULO DO MÊS (fonte única da verdade)
// -------------------------------------------------------------
// Todas as telas (painel, contas, análise, histórico, fechamento)
// usam computeMonth(). Assim um mesmo número nunca aparece com
// valores diferentes em lugares diferentes.
//
// São funções puras: recebem o estado e devolvem resultados,
// sem tocar na tela nem no armazenamento. Por isso são testadas
// em tests/ledger.test.mjs.
// =============================================================

import { splitCents, sumCents } from '../core/money.js';
import { addMonthsYM, dateInMonth, diffDays, monthsBetween, todayISO, ymOf, parseISO } from '../core/dates.js';
import { payrollFor, thirteenthFor, vacationFor, paydayOf } from './payroll.js';

// ---------- Parcelamentos ----------

/**
 * Cronograma completo de um parcelamento.
 * Cada parcela vence no `dueDay` do mês (limitado ao fim do mês).
 * → [{ n, ym, dueDate, cents, paid }]
 */
export function installmentSchedule(inst) {
  const firstYM = ymOf(inst.firstDueDate);
  const values = splitCents(inst.totalCents, inst.count);
  const paid = new Set(inst.paid || []);
  return values.map((cents, i) => {
    const ym = addMonthsYM(firstYM, i);
    // A 1ª parcela usa a data informada; as demais, o dia de vencimento.
    const dueDate = i === 0 ? inst.firstDueDate : dateInMonth(ym, inst.dueDay);
    return { n: i + 1, ym, dueDate, cents, paid: paid.has(i + 1) };
  });
}

/** Parcela que vence no mês `ym` (ou null). */
export function installmentInMonth(inst, ym) {
  const index = monthsBetween(ymOf(inst.firstDueDate), ym);
  if (index < 0 || index >= inst.count) return null;
  return installmentSchedule(inst)[index];
}

/** Resumo de um parcelamento: pagas, restante, última data. */
export function installmentSummary(inst) {
  const schedule = installmentSchedule(inst);
  const paidList = schedule.filter((p) => p.paid);
  const open = schedule.filter((p) => !p.paid);
  return {
    schedule,
    paidCount: paidList.length,
    paidCents: sumCents(paidList.map((p) => p.cents)),
    remainingCents: sumCents(open.map((p) => p.cents)),
    nextOpen: open[0] || null,
    lastDueDate: schedule[schedule.length - 1].dueDate,
    lastYM: schedule[schedule.length - 1].ym,
    finished: open.length === 0,
  };
}

/**
 * Monta um parcelamento a partir do que o usuário sabe de cabeça:
 * valor da parcela, nº de parcelas, quantas já pagou, dia e data da próxima.
 * O app deduz o total, quando começou e quando termina.
 *
 *   planInstallment({ parcelCents: 25000, count: 10, paidCount: 3, nextDueDate: '2026-11-10' })
 *   → total R$ 2.500, 1ª parcela 10/08/2026, última 10/05/2027
 */
export function planInstallment({ parcelCents, count, paidCount, nextDueDate, dueDay: day }) {
  // Dia de vencimento: o informado (ex.: 31) ou o dia da próxima data
  const dueDay = Number.isInteger(day) && day >= 1 && day <= 31 ? day : Number(nextDueDate.slice(8, 10));
  const firstYM = addMonthsYM(ymOf(nextDueDate), -paidCount);
  const lastYM = addMonthsYM(firstYM, count - 1);
  return {
    totalCents: parcelCents * count,
    dueDay,
    firstDueDate: dateInMonth(firstYM, dueDay),
    lastDueDate: dateInMonth(lastYM, dueDay),
    firstYM,
    lastYM,
    finished: paidCount >= count,
  };
}

// ---------- Recorrentes ----------

export const entryKey = (recurringId, ym) => `${recurringId}|${ym}`;

/** A recorrente vale no mês? (entre o início e o fim, se houver). */
export function recurringActiveIn(rec, ym) {
  return rec.startYM <= ym && (!rec.endYM || ym <= rec.endYM);
}

// ---------- Renda ----------

/**
 * Renda LÍQUIDA do mês.
 *   salary      = líquido do salário (sem os extras)
 *   extrasCents = quanto os extras somam ao líquido. Extras "na folha" são
 *                 brutos: entram no contracheque e pagam INSS/IR junto com o
 *                 salário, então somam (líquido com extras − líquido sem extras).
 *   thirteenth  = 13º salário do mês (nov/dez), se houver
 *   actual      = líquido da folha que você CONFERIU no holerite (substitui a estimativa)
 *   payroll     = contracheque completo do mês (ver payroll.js)
 */
export function payslipIncome(state, ym) {
  const extras = state.extraIncomes.filter((x) => x.ym === ym);
  const inPayroll = sumCents(extras.filter((x) => x.payroll).map((x) => x.cents));
  const outside = sumCents(extras.filter((x) => !x.payroll).map((x) => x.cents));

  const withoutExtras = payrollFor(state.settings, ym, 0);
  const payroll = inPayroll ? payrollFor(state.settings, ym, inPayroll) : withoutExtras;
  const thirteenth = thirteenthFor(state.settings, ym);
  const thirteenthNet = thirteenth ? thirteenth.net : 0;
  const vacation = vacationFor(state.settings, ym);
  const vacationNet = vacation ? vacation.net : 0;

  let salary = withoutExtras.net;
  let extrasNet = payroll.net - withoutExtras.net;

  // Valor real conferido no holerite: vale mais que a estimativa
  const actual = state.settings.actualNet?.[ym] ?? null;
  if (actual != null) {
    extrasNet = Math.min(extrasNet, actual);
    salary = actual - extrasNet;
  }

  const extrasCents = extrasNet + outside;
  return {
    competence: ym,
    salary,
    extras,
    extrasCents,
    payrollExtrasNet: extrasNet,
    outside,
    thirteenthNet,
    vacationNet,
    extrasGross: inPayroll + outside,
    gross: payroll.gross + outside,
    thirteenth,
    vacation,
    actual,
    estimatedNet: payroll.net,
    total: salary + extrasCents + thirteenthNet + vacationNet,
    payroll,
  };
}

/**
 * Renda que ENTRA no mês `ym` (caixa).
 * Com "salário cai no mês seguinte", o salário e os plantões na folha
 * vêm da competência anterior (ex.: holerite de setembro pago em outubro).
 * 13º, férias e rendas fora da folha continuam no mês em que caem.
 * Para o contracheque de uma competência, use payslipIncome().
 */
export function incomeFor(state, ym) {
  if (!paydayOf(state.settings).nextMonth) return payslipIncome(state, ym);
  const own = payslipIncome(state, ym);
  const comp = payslipIncome(state, addMonthsYM(ym, -1));
  const extrasCents = comp.payrollExtrasNet + own.outside;
  return {
    ...own,
    competence: comp.competence,
    salary: comp.salary,
    extras: [...comp.extras.filter((x) => x.payroll), ...own.extras.filter((x) => !x.payroll)],
    extrasCents,
    payrollExtrasNet: comp.payrollExtrasNet,
    extrasGross: comp.extrasGross - comp.outside + own.outside,
    gross: comp.payroll.gross + own.outside,
    actual: comp.actual,
    estimatedNet: comp.estimatedNet,
    total: comp.salary + extrasCents + own.thirteenthNet + own.vacationNet,
    payroll: comp.payroll,
  };
}

// ---------- Status de um item ----------

/**
 * paid     → pago
 * overdue  → venceu e não foi pago
 * today    → vence hoje
 * soon     → vence nos próximos 7 dias
 * upcoming → vence depois
 */
export function itemStatus(dueDate, paidAt, today = todayISO()) {
  if (paidAt) return 'paid';
  const diff = diffDays(today, dueDate);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'soon';
  return 'upcoming';
}

// ---------- O mês ----------

/**
 * Todos os compromissos de um mês, já com status.
 * Item: { key, kind, refId, description, cents, dueDate, paidAt, status,
 *         categoryId, subcategoryId, creditorId, parcel?: { n, count } }
 */
export function monthItems(state, ym, today = todayISO()) {
  const items = [];

  for (const e of state.expenses) {
    if (ymOf(e.dueDate) !== ym) continue;
    items.push({
      key: `expense:${e.id}`, kind: 'expense', refId: e.id,
      description: e.description, cents: e.cents, dueDate: e.dueDate, paidAt: e.paidAt,
      categoryId: e.categoryId, subcategoryId: e.subcategoryId, creditorId: e.creditorId,
    });
  }

  for (const r of state.recurring) {
    if (!recurringActiveIn(r, ym)) continue;
    const entry = state.recurringEntries[entryKey(r.id, ym)] || {};
    if (entry.skipped) continue;
    items.push({
      key: `recurring:${r.id}:${ym}`, kind: 'recurring', refId: r.id,
      description: r.description, cents: entry.cents ?? r.cents,
      dueDate: dateInMonth(ym, r.dueDay), paidAt: entry.paidAt || null,
      adjusted: entry.cents != null && entry.cents !== r.cents,
      categoryId: r.categoryId, subcategoryId: r.subcategoryId, creditorId: r.creditorId,
    });
  }

  for (const inst of state.installments) {
    const parcel = installmentInMonth(inst, ym);
    if (!parcel) continue;
    items.push({
      key: `installment:${inst.id}:${parcel.n}`, kind: 'installment', refId: inst.id,
      description: inst.description, cents: parcel.cents, dueDate: parcel.dueDate,
      paidAt: parcel.paid ? parcel.dueDate : null,
      parcel: { n: parcel.n, count: inst.count },
      categoryId: inst.categoryId, subcategoryId: inst.subcategoryId, creditorId: inst.creditorId,
    });
  }

  for (const item of items) item.status = itemStatus(item.dueDate, item.paidAt, today);
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description));
  return items;
}

/** Totais de uma lista de itens. */
export function totalsOf(items) {
  const by = (fn) => sumCents(items.filter(fn).map((i) => i.cents));
  return {
    all: by(() => true),
    paid: by((i) => i.status === 'paid'),
    pending: by((i) => i.status !== 'paid'),
    overdue: by((i) => i.status === 'overdue'),
    expense: by((i) => i.kind === 'expense'),
    recurring: by((i) => i.kind === 'recurring'),
    installment: by((i) => i.kind === 'installment'),
    count: items.length,
    pendingCount: items.filter((i) => i.status !== 'paid').length,
  };
}

/** Gastos por categoria, do maior para o menor. */
export function byCategory(items, categories) {
  const map = new Map();
  for (const item of items) {
    const id = item.categoryId || '_none';
    map.set(id, (map.get(id) || 0) + item.cents);
  }
  return [...map.entries()]
    .map(([id, cents]) => {
      const cat = categories.find((c) => c.id === id);
      return {
        id, cents,
        name: cat?.name || 'Sem categoria',
        icon: cat?.icon || '🏷️',
        color: cat?.color || '#64748B',
      };
    })
    .sort((a, b) => b.cents - a.cents);
}

/**
 * Resumo completo do mês.
 *   balance      = renda − tudo que vence no mês   (saldo previsto)
 *   cashBalance  = renda − o que já foi pago        (saldo atual)
 */
export function computeMonth(state, ym, today = todayISO()) {
  const items = monthItems(state, ym, today);
  const income = incomeFor(state, ym);
  const totals = totalsOf(items);
  return {
    ym,
    items,
    income,
    totals,
    categories: byCategory(items, state.categories),
    balance: income.total - totals.all,
    cashBalance: income.total - totals.paid,
    closed: Boolean(state.closedMonths[ym]),
  };
}

/**
 * Contas atrasadas de meses ANTERIORES a `ym` (não pagas).
 * Olha até 24 meses para trás.
 */
export function overdueBefore(state, ym, today = todayISO()) {
  const result = [];
  for (let i = 1; i <= 24; i++) {
    const prev = addMonthsYM(ym, -i);
    for (const item of monthItems(state, prev, today)) {
      if (item.status === 'overdue') result.push(item);
    }
  }
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Valor que ainda será pago a um credor (todas as pendências futuras + atrasadas). */
export function creditorOutstanding(state, creditorId, today = todayISO()) {
  let cents = 0;
  for (const e of state.expenses) if (e.creditorId === creditorId && !e.paidAt) cents += e.cents;
  for (const inst of state.installments) {
    if (inst.creditorId === creditorId) cents += installmentSummary(inst).remainingCents;
  }
  const monthlyRecurring = sumCents(state.recurring
    .filter((r) => r.creditorId === creditorId && recurringActiveIn(r, ymOf(today)))
    .map((r) => r.cents));
  return { outstanding: cents, monthlyRecurring };
}

/** Quanto falta guardar por mês para bater a meta no prazo. */
export function goalPlan(goal, today = todayISO()) {
  const saved = sumCents(goal.contributions.map((c) => c.cents));
  const remaining = Math.max(0, goal.targetCents - saved);
  let monthsLeft = null;
  let perMonth = null;
  if (goal.deadline && parseISO(goal.deadline)) {
    monthsLeft = Math.max(0, monthsBetween(ymOf(today), ymOf(goal.deadline))) + 1;
    perMonth = remaining > 0 ? Math.ceil(remaining / monthsLeft) : 0;
  }
  return {
    saved, remaining, monthsLeft, perMonth,
    progress: goal.targetCents > 0 ? Math.min(100, (saved / goal.targetCents) * 100) : 0,
    done: remaining === 0,
    late: Boolean(goal.deadline && goal.deadline < today && remaining > 0),
  };
}
