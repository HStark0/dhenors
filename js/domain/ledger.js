// =============================================================
// ledger.js — O CÁLCULO DO MÊS (fonte única da verdade)
// -------------------------------------------------------------
// Todas as telas (painel, contas, análise, histórico, fechamento)
// usam computeMonth(). Assim um mesmo número nunca aparece com
// valores diferentes em lugares diferentes.
//
// São funções puras: recebem o estado e devolvem resultados,
// sem tocar na tela nem no armazenamento. Por isso são testadas
// em tests/ledger.test.mjs. Os resultados ficam em cache enquanto
// o estado for o mesmo objeto (core/memo.js).
// =============================================================

import { splitCents, sumCents } from '../core/money.js';
import { addMonthsYM, dateInMonth, diffDays, monthsBetween, todayISO, ymOf, parseISO } from '../core/dates.js';
import { memoByState } from '../core/memo.js';
import { payrollFor, thirteenthFor, vacationFor, paydayOf } from './payroll.js';
import { registerCustomTables } from './taxTables.js';
import { shiftIncomes } from './shifts.js';
import { benefitsIn, jobsIn } from './benefits.js';
import { invoicesIn } from './cards.js';

// ---------- Parcelamentos ----------

/**
 * Cronograma completo de um parcelamento.
 * Cada parcela vence no `dueDay` do mês (limitado ao fim do mês).
 * → [{ n, ym, dueDate, cents, paid, paidAt }]
 * paidAt = data REAL do pagamento (quando registrada). Parcelas
 * marcadas como já pagas no cadastro não têm data: usam o vencimento.
 */
export function installmentSchedule(inst) {
  const firstYM = ymOf(inst.firstDueDate);
  const values = splitCents(inst.totalCents, inst.count);
  const paid = new Set(inst.paid || []);
  return values.map((cents, i) => {
    const ym = addMonthsYM(firstYM, i);
    // A 1ª parcela usa a data informada; as demais, o dia de vencimento.
    const dueDate = i === 0 ? inst.firstDueDate : dateInMonth(ym, inst.dueDay);
    const n = i + 1;
    return { n, ym, dueDate, cents, paid: paid.has(n), paidAt: paid.has(n) ? (inst.paidOn?.[n] || dueDate) : null, paidAtKnown: Boolean(inst.paidOn?.[n]) };
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

export { entryKey, FREQ_MONTHS, FREQ_DAYS, FREQ_LABELS, recurringActiveIn, recurringDates } from './recurrence.js';
import { entryKey, FREQ_DAYS, recurringActiveIn, recurringDates } from './recurrence.js';

/** Valor estimado de uma conta variável (luz, água): média dos últimos valores confirmados. */
export function variableEstimate(state, rec, ym, n = 3) {
  const known = Object.entries(state.recurringEntries || {})
    .filter(([k, e]) => k.startsWith(`${rec.id}|`) && e.cents != null && k.split('|')[1] < ym)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, n)
    .map(([, e]) => e.cents);
  return known.length ? Math.round(sumCents(known) / known.length) : rec.cents;
}

// ---------- Renda ----------

/** Rendas extras do mês: lançadas + geradas pela escala de plantões. */
export function extrasOf(state, ym) {
  return [...state.extraIncomes.filter((x) => x.ym === ym), ...shiftIncomes(state, ym)];
}

/** Plantões/extras pagos NA FOLHA no mês (bruto) — entram na média do 13º. */
const payrollExtrasFor = (state) => (ym) => sumCents(extrasOf(state, ym).filter((x) => x.payroll).map((x) => x.cents));

/** 13º do mês com a média das variáveis (inclui plantões na folha). */
export function thirteenthOf(state, ym) {
  registerCustomTables(state.settings.taxTables);
  return thirteenthFor(state.settings, ym, payrollExtrasFor(state));
}

/**
 * Renda LÍQUIDA do mês (competência).
 *   salary      = líquido do salário (sem os extras)
 *   extrasCents = quanto os extras somam ao líquido. Extras "na folha" são
 *                 brutos: entram no contracheque e pagam INSS/IR junto com o
 *                 salário, então somam (líquido com extras − líquido sem extras).
 *   thirteenth  = 13º salário do mês (nov/dez), se houver. NÃO entra em
 *                 `total` (nem no saldo previsto): é pago à parte do salário;
 *                 fica em thirteenthNet para quem quiser somar (ex.: plano do ano).
 *   actual      = líquido da folha que você CONFERIU no holerite (substitui a estimativa)
 *   benefits    = PLR, abono e outros benefícios em dinheiro (VA/VR à parte)
 *   jobs        = líquido dos outros vínculos (segundo emprego, PJ…)
 *   payroll     = contracheque completo do mês (ver payroll.js)
 */
function payslipIncomeRaw(state, ym) {
  registerCustomTables(state.settings.taxTables);
  const extras = extrasOf(state, ym);
  const inPayroll = sumCents(extras.filter((x) => x.payroll).map((x) => x.cents));
  const outside = sumCents(extras.filter((x) => !x.payroll).map((x) => x.cents));

  const withoutExtras = payrollFor(state.settings, ym, 0);
  const payroll = inPayroll ? payrollFor(state.settings, ym, inPayroll) : withoutExtras;
  const thirteenth = thirteenthOf(state, ym);
  const thirteenthNet = thirteenth ? thirteenth.net : 0;
  const vacation = vacationFor(state.settings, ym);
  const vacationNet = vacation ? vacation.net : 0;
  const benefits = benefitsIn(state.settings, ym);
  const jobs = jobsIn(state.settings, ym, payroll.gross);

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
    benefits,
    benefitsNet: benefits.cashNet,
    jobs,
    jobsNet: jobs.net,
    actual,
    estimatedNet: payroll.net,
    total: salary + extrasCents + vacationNet + benefits.cashNet + jobs.net,
    payroll,
  };
}
export const payslipIncome = memoByState(payslipIncomeRaw);

/**
 * Renda que ENTRA no mês `ym` (caixa).
 * Com "salário cai no mês seguinte", o salário e os plantões na folha
 * vêm da competência anterior (ex.: holerite de setembro pago em outubro).
 * 13º, férias, benefícios, outros vínculos e rendas fora da folha
 * continuam no mês em que caem.
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
    total: comp.salary + extrasCents + own.vacationNet + own.benefitsNet + own.jobsNet,
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
 * Item: { key, kind: 'expense'|'recurring'|'installment'|'invoice', refId, description, cents,
 *         dueDate, paidAt, status, categoryId, subcategoryId, creditorId, tags,
 *         parcel?: { n, count }, splits?, parts?, estimated?, entryKey? }
 */
function monthItemsRaw(state, ym, today = todayISO()) {
  const items = [];

  for (const e of state.expenses) {
    if (ymOf(e.dueDate) !== ym) continue;
    items.push({
      key: `expense:${e.id}`, kind: 'expense', refId: e.id,
      description: e.description, cents: e.cents, dueDate: e.dueDate, paidAt: e.paidAt,
      categoryId: e.categoryId, subcategoryId: e.subcategoryId, creditorId: e.creditorId,
      tags: e.tags || [], splits: e.splits?.length ? e.splits : null, accountId: e.accountId || null,
      attachments: e.attachments?.length || 0,
    });
  }

  for (const r of state.recurring) {
    if (r.cardId) continue; // cobrada no cartão: entra na fatura
    const dates = recurringDates(r, ym);
    for (const dueDate of dates) {
      const k = FREQ_DAYS[r.freq] ? entryKey(r.id, dueDate) : entryKey(r.id, ym);
      const entry = state.recurringEntries[k] || {};
      if (entry.skipped) continue;
      const estimated = r.variable && entry.cents == null && !entry.paidAt;
      const cents = entry.cents ?? (r.variable ? variableEstimate(state, r, ym) : r.cents);
      items.push({
        key: `recurring:${r.id}:${FREQ_DAYS[r.freq] ? dueDate : ym}`, kind: 'recurring', refId: r.id, entryKey: k,
        description: r.description, cents,
        dueDate, paidAt: entry.paidAt || null,
        adjusted: entry.cents != null && entry.cents !== r.cents,
        estimated, subscription: Boolean(r.subscription), freq: r.freq || 'monthly',
        categoryId: r.categoryId, subcategoryId: r.subcategoryId, creditorId: r.creditorId, tags: r.tags || [],
        accountId: r.accountId || null,
      });
    }
  }

  for (const inst of state.installments) {
    const parcel = installmentInMonth(inst, ym);
    if (!parcel) continue;
    items.push({
      key: `installment:${inst.id}:${parcel.n}`, kind: 'installment', refId: inst.id,
      description: inst.description, cents: parcel.cents, dueDate: parcel.dueDate,
      paidAt: parcel.paidAt, paidAtKnown: parcel.paidAtKnown,
      parcel: { n: parcel.n, count: inst.count },
      categoryId: inst.categoryId, subcategoryId: inst.subcategoryId, creditorId: inst.creditorId, tags: inst.tags || [],
    });
  }

  for (const inv of invoicesIn(state, ym, today)) {
    if (inv.total <= 0 && !inv.paidAt) continue;
    items.push({
      key: `invoice:${inv.card.id}:${ym}`, kind: 'invoice', refId: inv.card.id,
      description: `Fatura ${inv.card.name}`, cents: inv.paidCents ?? Math.max(0, inv.total), dueDate: inv.due, paidAt: inv.paidAt,
      categoryId: null, subcategoryId: null, creditorId: null, tags: [],
      parts: inv.parts, invoice: { closing: inv.closing, status: inv.status, lines: inv.lines.length, total: inv.total },
      accountId: inv.card.accountId || null,
    });
  }

  for (const item of items) item.status = itemStatus(item.dueDate, item.paidAt, today);
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description));
  return items;
}
const monthItemsMemo = memoByState(monthItemsRaw);
export const monthItems = (state, ym, today = todayISO()) => monthItemsMemo(state, ym, today);

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
    invoice: by((i) => i.kind === 'invoice'),
    count: items.length,
    pendingCount: items.filter((i) => i.status !== 'paid').length,
  };
}

/**
 * Partes de um item por categoria: um gasto dividido (splits) ou uma
 * fatura de cartão (parts) contam em várias categorias.
 */
export function itemParts(item) {
  if (item.splits?.length) {
    const total = sumCents(item.splits.map((s) => s.cents));
    if (total === item.cents) return item.splits;
    const ratio = item.cents / (total || 1);
    return item.splits.map((s) => ({ ...s, cents: Math.round(s.cents * ratio) }));
  }
  if (item.parts?.length) return item.parts;
  return [{ categoryId: item.categoryId, subcategoryId: item.subcategoryId, cents: item.cents }];
}

/** Gastos por categoria, do maior para o menor. */
export function byCategory(items, categories) {
  const map = new Map();
  for (const item of items) {
    for (const p of itemParts(item)) {
      const id = p.categoryId || '_none';
      map.set(id, (map.get(id) || 0) + p.cents);
    }
  }
  return [...map.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([id, cents]) => {
      const cat = categories.find((c) => c.id === id);
      return {
        id, cents,
        name: cat?.name || 'Sem categoria',
        icon: cat?.icon || '🏷️',
        color: cat?.color || '#64748B',
        group: cat?.group || 'needs',
      };
    })
    .sort((a, b) => b.cents - a.cents);
}

/**
 * Resumo completo do mês.
 *   balance      = renda − tudo que vence no mês   (saldo previsto)
 *   cashBalance  = renda − o que já foi pago        (saldo atual)
 */
function computeMonthRaw(state, ym, today = todayISO()) {
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
const computeMonthMemo = memoByState(computeMonthRaw);
export const computeMonth = (state, ym, today = todayISO()) => computeMonthMemo(state, ym, today);

/**
 * Contas atrasadas de meses ANTERIORES a `ym` (não pagas).
 * Olha até 24 meses para trás (com cache: não recalcula a cada desenho).
 */
function overdueBeforeRaw(state, ym, today = todayISO()) {
  const result = [];
  for (let i = 1; i <= 24; i++) {
    const prev = addMonthsYM(ym, -i);
    for (const item of monthItems(state, prev, today)) {
      if (item.status === 'overdue') result.push(item);
    }
  }
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
const overdueBeforeMemo = memoByState(overdueBeforeRaw);
export const overdueBefore = (state, ym, today = todayISO()) => overdueBeforeMemo(state, ym, today);

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
  const receivable = sumCents((state.receivables || []).filter((r) => r.creditorId === creditorId && !r.receivedAt)
    .map((r) => r.cents - sumCents((r.partials || []).map((p) => p.cents))));
  return { outstanding: cents, monthlyRecurring, receivable };
}

/**
 * Quanto falta guardar por mês para bater a meta no prazo.
 * `linkedCents` = valor atual dos investimentos ligados à meta (a meta
 * "Viagem" usa o CDB X): conta como guardado, sem duplicar.
 */
export function goalPlan(goal, today = todayISO(), linkedCents = 0) {
  const contributed = sumCents(goal.contributions.map((c) => c.cents));
  const saved = contributed + linkedCents;
  const remaining = Math.max(0, goal.targetCents - saved);
  let monthsLeft = null;
  let perMonth = null;
  if (goal.deadline && parseISO(goal.deadline)) {
    monthsLeft = Math.max(0, monthsBetween(ymOf(today), ymOf(goal.deadline))) + 1;
    perMonth = remaining > 0 ? Math.ceil(remaining / monthsLeft) : 0;
  }
  return {
    saved, contributed, linked: linkedCents, remaining, monthsLeft, perMonth,
    progress: goal.targetCents > 0 ? Math.min(100, (saved / goal.targetCents) * 100) : 0,
    done: remaining === 0,
    late: Boolean(goal.deadline && goal.deadline < today && remaining > 0),
  };
}
