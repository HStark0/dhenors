// @ts-check
// =============================================================
// planning.js — Orçamentos, pontuação financeira, simulador e agenda
// -------------------------------------------------------------
// Funções puras (testadas em tests/features.test.mjs).
// =============================================================

import { sumCents, percent, plural } from '../core/money.js';
import { addMonthsYM, dateInMonth, ymOf, todayISO, parseYM, daysInMonth, toISO, addDaysISO, diffDays } from '../core/dates.js';
import { computeMonth, overdueBefore, goalPlan, installmentSummary, incomeFor, thirteenthOf } from './ledger.js';
import { monthSeries, projection, median } from './analysis.js';
import { payrollProfileFor, vacationIn, paydayIn } from './payroll.js';
import { newId } from './schema.js';
import { positionAt, investingOf } from './investments.js';
import { accountsSummary } from './accounts.js';
import { shiftsIn, shiftTypeOf } from './shifts.js';
import { invoice } from './cards.js';

// ---------- Orçamento por categoria ----------

/**
 * Situação dos orçamentos no mês.
 * → [{ id, name, icon, color, budget, spent, pct, left, tone }]   tone: good | warn | bad
 */
export function budgetStatus(state, ym, today = todayISO()) {
  const budgets = state.settings.budgets || {};
  const spentBy = new Map(computeMonth(state, ym, today).categories.map((c) => [c.id, c.cents]));
  return Object.entries(budgets)
    .filter(([, cents]) => cents > 0)
    .map(([id, budget]) => {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return null;
      const spent = spentBy.get(id) || 0;
      const pct = percent(spent, budget);
      return {
        id, name: cat.name, icon: cat.icon, color: cat.color,
        budget, spent, pct, left: budget - spent,
        tone: pct > 100 ? 'bad' : pct >= 80 ? 'warn' : 'good',
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);
}

// ---------- Pontuação de saúde financeira (0–100) ----------

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Valor atual dos investimentos ligados a uma meta. */
export function linkedValue(state, goal, today = todayISO()) {
  if (!goal.investmentIds?.length) return 0;
  const investing = investingOf(state.settings);
  return sumCents((state.investments || []).filter((i) => goal.investmentIds.includes(i.id))
    .map((i) => positionAt(i, investing, today, state.settings.quotes).value));
}

/** Progresso da meta contando os investimentos ligados a ela. */
export const goalProgress = (state, goal, today = todayISO()) => goalPlan(goal, today, linkedValue(state, goal, today));

/**
 * Quanto a reserva de emergência cobre de meses de gastos.
 * Conta SÓ o que foi marcado como reserva (metas com "É a reserva de
 * emergência" e investimentos marcados), nunca pelo nome.
 * Sem contar em dobro:
 *  • investimento ligado a uma meta de reserva conta uma vez (dentro da meta);
 *  • meta de reserva SEM investimento ligado + investimento de reserva solto
 *    provavelmente são o mesmo dinheiro: vale o maior e o app sugere ligar
 *    a meta ao investimento (overlap = true).
 */
export function emergencyCoverage(state, ym, today = todayISO()) {
  const goals = state.goals.filter((g) => g.emergency);
  const investing = investingOf(state.settings);
  const linkedIds = new Set(goals.flatMap((g) => g.investmentIds || []));
  const goalSaved = sumCents(goals.map((g) => goalProgress(state, g, today).saved));
  const invs = (state.investments || []).filter((i) => i.emergency && !linkedIds.has(i.id));
  const invSaved = sumCents(invs.map((i) => positionAt(i, investing, today, state.settings.quotes).value));
  const looseGoals = goals.filter((g) => !(g.investmentIds || []).length && sumCents(g.contributions.map((c) => c.cents)) > 0);
  const overlap = looseGoals.length > 0 && invSaved > 0;
  const saved = overlap ? Math.max(goalSaved, invSaved) : goalSaved + invSaved;
  const spent = monthSeries(state, addMonthsYM(ym, -1), 3, today).map((m) => m.spent).filter((v) => v > 0);
  const monthly = spent.length ? median(spent) : computeMonth(state, ym, today).totals.all;
  return { saved, goalSaved, invSaved, overlap, monthly, months: monthly > 0 ? saved / monthly : 0, hasGoal: goals.length + invs.length > 0 };
}

/**
 * Pontuação com 5 fatores. Cada fator traz uma dica prática.
 * Calibrada: contas atrasadas pesam mais (1 atrasada já tira
 * 1/3 do fator; 3 zeram) e há TETOS que impedem nota boa com problema
 * grave: 3+ atrasadas → no máximo 49 ("Atenção"); meta de gastos
 * estourada → no máximo 69; mês no vermelho → no máximo 59;
 * qualquer atraso → no máximo 79.
 * → { score, raw, grade, tone, factors: [{ key, label, value, points, max, tip }], caps: [{ max, reason }] }
 */
export function financialScore(state, ym, today = todayISO()) {
  const series = monthSeries(state, ym, 3, today).filter((m) => m.income > 0 || m.spent > 0);
  const income = sumCents(series.map((m) => m.income));
  const spent = sumCents(series.map((m) => m.spent));
  const fixed = sumCents(series.map((m) => m.fixed));
  const month = computeMonth(state, ym, today);
  const overdue = [...overdueBefore(state, ym, today), ...month.items.filter((i) => i.status === 'overdue')].length;
  const reserve = emergencyCoverage(state, ym, today);
  const savingsRate = percent(income - spent, income);
  const fixedRate = percent(fixed, income);
  const spendRatio = percent(month.totals.all, month.income.total || 1);
  const limit = state.settings.spendingLimitCents || 0;
  const limitUsed = limit > 0 ? percent(month.totals.all, limit) : 0;

  const factors = [
    {
      key: 'savings', label: 'Quanto sobra da renda', max: 25,
      value: income ? `${savingsRate.toFixed(0)}% (3 meses)` : 'sem renda cadastrada',
      points: 25 * clamp01(savingsRate / 20),
      tip: savingsRate >= 20 ? 'Ótimo! Guardar 20% ou mais é o ideal.' : 'Tente separar pelo menos 10–20% da renda assim que o salário cair.',
    },
    {
      key: 'fixed', label: 'Custos fixos (recorrentes + parcelas)', max: 20,
      value: income ? `${fixedRate.toFixed(0)}% da renda` : '—',
      points: income ? 20 * clamp01((70 - fixedRate) / 40) : 0,
      tip: fixedRate <= 30 ? 'Custos fixos sob controle.' : 'Acima de 50% deixa pouca margem. Reveja assinaturas e evite novos parcelamentos.',
    },
    {
      key: 'overdue', label: 'Contas em dia', max: 20,
      value: overdue ? `${overdue} em atraso` : 'nenhuma atrasada',
      points: 20 * Math.max(0, 1 - overdue / 3),
      tip: overdue ? 'Pague ou renegocie as atrasadas: juros e multas corroem a renda.' : 'Perfeito, nenhuma conta atrasada.',
    },
    {
      key: 'reserve', label: 'Reserva de emergência', max: 20,
      value: reserve.monthly ? `${reserve.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${reserve.months >= 1 && reserve.months < 2 ? 'mês' : 'meses'} de gastos` : '—',
      points: 20 * clamp01(reserve.months / 6),
      tip: reserve.hasGoal ? (reserve.months >= 6 ? 'Reserva completa (6+ meses).' : 'Meta: 6 meses de gastos guardados.') : 'Crie uma meta de "reserva de emergência" ou marque um investimento como reserva.',
    },
    {
      key: 'month', label: limit ? 'Gastos do mês × renda e meta' : 'Gastos do mês × renda', max: 15,
      value: month.income.total ? `${spendRatio.toFixed(0)}% da renda${limit ? ` · ${limitUsed.toFixed(0)}% da meta` : ''}` : '—',
      points: month.income.total ? 15 * clamp01((110 - spendRatio) / 20) * (limitUsed > 100 ? 0 : limitUsed >= 90 ? 0.5 : 1) : 0,
      tip: limitUsed > 100 ? 'A meta de gastos do mês estourou: segure os gastos variáveis até o próximo salário.'
        : spendRatio <= 90 ? 'Mês equilibrado.' : 'O mês está gastando quase tudo (ou mais) do que entra.',
    },
  ].map((f) => ({ ...f, points: Math.round(f.points) }));

  const caps = [];
  if (overdue >= 3) caps.push({ max: 49, reason: `${overdue} contas atrasadas` });
  else if (overdue >= 1) caps.push({ max: 79, reason: overdue === 1 ? '1 conta atrasada' : `${overdue} contas atrasadas` });
  if (limitUsed > 100) caps.push({ max: 69, reason: `meta de gastos estourada (${limitUsed.toFixed(0)}%)` });
  if (month.balance < 0) caps.push({ max: 59, reason: 'mês no vermelho' });
  const raw = Math.round(factors.reduce((s, f) => s + f.points, 0));
  const cap = caps.length ? Math.min(...caps.map((c) => c.max)) : 100;
  const score = Math.min(raw, cap);
  const grade = score >= 80 ? 'Excelente' : score >= 60 ? 'Boa' : score >= 40 ? 'Atenção' : 'Crítica';
  const tone = score >= 80 ? 'good' : score >= 60 ? 'info' : score >= 40 ? 'warn' : 'bad';
  return { score, raw, grade, tone, factors, caps: raw > cap ? caps.filter((c) => c.max < raw) : [] };
}

/** Nota de cada um dos últimos `months` meses (fechados usam a nota guardada no fechamento). */
export function scoreHistory(state, endYM, months = 12, today = todayISO()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonthsYM(endYM, -i);
    if (state.scoreHistory?.[ym] != null) { out.push({ ym, score: state.scoreHistory[ym], saved: true }); continue; }
    const { y, m } = parseYM(ym);
    const end = toISO(y, m, daysInMonth(y, m));
    const day = end < today ? end : today;
    const hasData = monthSeries(state, ym, 3, day).some((x) => x.income > 0 || x.spent > 0);
    out.push({ ym, score: hasData ? financialScore(state, ym, day).score : null, saved: false });
  }
  return out;
}

// ---------- Quanto dá para gastar por dia ----------

/**
 * "Dá para gastar R$ X/dia até o próximo salário", separando o que vence
 * ANTES do próximo salário (sai do dinheiro de agora) do que vence DEPOIS
 * (será pago com o salário seguinte).
 *
 *  dinheiro agora = saldo das contas (se você cadastrou contas com saldo)
 *                   ou, sem contas: sobra do mês passado (se o salário deste
 *                   mês ainda não caiu) + o que já entrou no mês − o que já foi pago
 *  livre          = dinheiro agora − contas não pagas até a véspera do salário
 *                   (inclui atrasadas)
 *  por dia        = livre ÷ dias até o salário
 *
 * → { perDay, free, cash, dueBefore, dueAfter, nextPay, days, source, before: [itens], after: [itens] }
 */
export function spendingRoom(state, today = todayISO()) {
  const s = state.settings;
  const ym = ymOf(today);
  let nextPay = paydayIn(s, ym);
  if (nextPay <= today) nextPay = paydayIn(s, addMonthsYM(ym, 1));
  const days = Math.max(1, diffDays(today, nextPay));
  const m = computeMonth(state, ym, today);

  const salaryFn = employerIncomeFn(state);
  const anchored = (state.accounts || []).filter((a) => !a.archived && a.anchor?.date);
  let cash;
  let source;
  if (anchored.length) {
    // O que foi pago sem conta (parcelas, contas sem conta escolhida, fatura de
    // cartão sem conta de débito) sai de "a pagar" mas não mexe no saldo das
    // contas: sem descontar aqui, pagar uma conta AUMENTAVA o livre.
    cash = accountsSummary({ ...state, accounts: anchored }, today, { salaryFn }).total
      - unlinkedPaidSince(state, anchored, today);
    source = 'accounts';
  } else {
    const received = sumCents(incomeEvents(state, ym).filter((e) => e.date <= today).map((e) => e.cents));
    const salaryArrived = paydayIn(s, ym) <= today;
    const prev = computeMonth(state, addMonthsYM(ym, -1), today);
    const carry = salaryArrived ? 0 : Math.max(0, prev.income.total + (prev.income.thirteenthNet || 0) - prev.totals.paid);
    cash = carry + received - m.totals.paid;
    source = 'estimate';
  }

  const nextMonthItems = ymOf(nextPay) !== ym ? computeMonth(state, ymOf(nextPay), today).items : [];
  const open = [...overdueBefore(state, ym, today), ...m.items, ...nextMonthItems].filter((i) => i.status !== 'paid');
  const before = open.filter((i) => i.dueDate < nextPay);
  const after = m.items.filter((i) => i.status !== 'paid' && i.dueDate >= nextPay);
  const dueBefore = sumCents(before.map((i) => i.cents));
  const dueAfter = sumCents(after.map((i) => i.cents));
  const free = cash - dueBefore;
  return { perDay: Math.max(0, Math.floor(free / days)), free, cash, dueBefore, dueAfter, nextPay, days, source, before, after };
}

/**
 * Total pago (até hoje) em itens NÃO ligados a nenhuma das contas com saldo
 * de partida, depois do saldo de partida mais recente. Usa a data mais
 * recente para não descontar duas vezes um pagamento que já está no saldo
 * informado de alguma conta. Parcelas marcadas como pagas no cadastro (sem
 * data real) ficam de fora: foram pagas antes de usar o app.
 */
function unlinkedPaidSince(state, anchored, today) {
  const ids = new Set(anchored.map((a) => a.id));
  const from = anchored.map((a) => a.anchor.date).sort().at(-1);
  const cardLinked = new Set((state.cards || []).filter((c) => ids.has(c.accountId)).map((c) => c.id));
  let total = 0;
  // meses de vencimento: até 12 antes do saldo (atrasadas pagas depois) e 2 à frente (pagas adiantado)
  for (let ym = addMonthsYM(ymOf(from), -12); ym <= addMonthsYM(ymOf(today), 2); ym = addMonthsYM(ym, 1)) {
    for (const i of computeMonth(state, ym, today).items) {
      if (!i.paidAt || i.paidAt <= from || i.paidAt > today) continue;
      if (i.kind === 'installment' && !i.paidAtKnown) continue;
      const linked = i.kind === 'invoice' ? cardLinked.has(i.refId) : ids.has(i.accountId);
      if (!linked) total += i.cents;
    }
  }
  return total;
}

/**
 * O que cai na conta-salário no mês: salário, 13º, férias, PLR/benefícios
 * e outros vínculos (as rendas fora da folha entram pela conta escolhida
 * em cada uma). Usado no saldo calculado das contas bancárias.
 */
export const employerIncomeFn = (state) => (ym) => incomeEvents(state, ym).filter((e) => e.kind !== 'extra');

/** Entradas de dinheiro previstas no mês, com data. → [{ date, cents, label, kind }] */
export function incomeEvents(state, ym) {
  const s = state.settings;
  const inc = incomeFor(state, ym);
  const out = [];
  const salaryCash = inc.salary + (inc.payrollExtrasNet || 0);
  if (salaryCash) out.push({ date: paydayIn(s, ym), cents: salaryCash, label: 'Salário', kind: 'salary' });
  for (const x of inc.extras) if (!x.payroll) out.push({ date: x.date || `${ym}-01`, cents: x.cents, label: x.description, kind: 'extra' });
  if (inc.thirteenth) out.push({ date: dateInMonth(ym, inc.thirteenth.part === 1 ? 30 : 20), cents: inc.thirteenth.net, label: inc.thirteenth.label, kind: 'thirteenth' });
  if (inc.vacation) {
    const d = addDaysISO(inc.vacation.start, -2);
    out.push({ date: d < `${ym}-01` ? `${ym}-01` : d, cents: inc.vacation.net, label: 'Férias', kind: 'vacation' });
  }
  for (const b of inc.benefits?.cash || []) out.push({ date: paydayIn(s, ym), cents: b.net, label: b.name, kind: 'benefit' });
  for (const j of inc.jobs?.list || []) out.push({ date: dateInMonth(ym, j.job.day || 5), cents: j.net, label: j.job.name, kind: 'job' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fluxo de caixa DIA A DIA de hoje até o fim do próximo ciclo de salário
 * (ou `untilDays` dias), mostrando onde o dinheiro aperta.
 * → { points: [{ date, balance, in, out, events }], min: { date, balance }, start, nextPay }
 */
export function dailyCashflow(state, today = todayISO(), untilDays = null) {
  const room = spendingRoom(state, today);
  const end = untilDays ? addDaysISO(today, untilDays) : addDaysISO(paydayIn(state.settings, addMonthsYM(ymOf(room.nextPay), 1)), -1);
  const months = new Set();
  for (let ym = ymOf(today); ym <= ymOf(end); ym = addMonthsYM(ym, 1)) months.add(ym);
  const bills = [];
  const incomes = [];
  for (const ym of months) {
    for (const i of computeMonth(state, ym, today).items) if (i.status !== 'paid' && i.dueDate > today && i.dueDate <= end) bills.push(i);
    for (const e of incomeEvents(state, ym)) if (e.date > today && e.date <= end) incomes.push(e);
  }
  const overdue = room.before.filter((i) => i.dueDate <= today);
  let balance = room.cash - sumCents(overdue.map((i) => i.cents));
  const points = [{ date: today, balance, in: 0, out: sumCents(overdue.map((i) => i.cents)), events: overdue.map((i) => i.description) }];
  for (let d = addDaysISO(today, 1); d <= end; d = addDaysISO(d, 1)) {
    const outs = bills.filter((i) => i.dueDate === d);
    const ins = incomes.filter((e) => e.date === d);
    const o = sumCents(outs.map((i) => i.cents));
    const n = sumCents(ins.map((e) => e.cents));
    balance += n - o;
    points.push({ date: d, balance, in: n, out: o, events: [...ins.map((e) => `+ ${e.label}`), ...outs.map((i) => i.description)] });
  }
  const min = points.reduce((a, p) => (p.balance < a.balance ? p : a), points[0]);
  return { points, min, start: room.cash, nextPay: room.nextPay };
}

// ---------- Simulador "e se" ----------

/**
 * Aplica um cenário numa CÓPIA do estado e compara as projeções.
 * scenario = {
 *   salaryPct,              // ex.: 10 → +10% no salário base a partir do mês
 *   extraMonthlyCents,      // renda extra mensal (fora da folha)
 *   purchase: { parcelCents, count },   // nova compra parcelada (começa no mês seguinte)
 *   cutRecurring: [ids],    // cancelar recorrentes a partir do mês
 *   payoff: [ids],          // quitar parcelamentos agora (paga o restante no mês)
 *   payoffDiscountPct,      // desconto por antecipação (ex.: 10)
 *   cutVariablePct,         // reduzir gastos avulsos em X%
 * }
 */
export function simulate(state, scenario, fromYM, months = 12, today = todayISO()) {
  const sim = structuredClone(state);
  const sc = scenario || {};

  if (sc.salaryPct) {
    const p = payrollProfileFor(sim.settings, fromYM);
    if (p && !p.legacyNet) {
      const next = { ...structuredClone(p), from: fromYM, grossCents: Math.round(p.grossCents * (1 + sc.salaryPct / 100)) };
      sim.settings.salaryHistory = [...sim.settings.salaryHistory.filter((h) => h.from !== fromYM), next].sort((a, b) => a.from.localeCompare(b.from));
    }
  }

  if (sc.extraMonthlyCents > 0) {
    for (let i = 0; i < months; i++) {
      const ym = addMonthsYM(fromYM, i);
      sim.extraIncomes.push({ id: newId(), ym, description: 'Simulação: renda extra', cents: sc.extraMonthlyCents, date: dateInMonth(ym, 1), payroll: false });
    }
  }

  if (sc.purchase?.parcelCents > 0 && sc.purchase?.count > 0) {
    const first = dateInMonth(addMonthsYM(fromYM, 1), 10);
    sim.installments.push({ id: newId(), description: 'Simulação: compra', totalCents: sc.purchase.parcelCents * sc.purchase.count, count: sc.purchase.count, firstDueDate: first, dueDay: 10, paid: [], categoryId: null, subcategoryId: null, creditorId: null, notes: '' });
  }

  for (const id of sc.cutRecurring || []) {
    const r = sim.recurring.find((x) => x.id === id);
    if (!r) continue;
    // Começa no mês da simulação (ou depois): cancelar = não existir
    if (r.startYM >= fromYM) sim.recurring = sim.recurring.filter((x) => x.id !== id);
    else r.endYM = addMonthsYM(fromYM, -1);
  }

  for (const id of sc.payoff || []) {
    const inst = sim.installments.find((x) => x.id === id);
    if (!inst) continue;
    const sum = installmentSummary(inst);
    const future = sum.schedule.filter((p) => !p.paid && p.ym >= fromYM);
    if (!future.length) continue;
    const remaining = sumCents(future.map((p) => p.cents));
    const discounted = Math.round(remaining * (1 - (sc.payoffDiscountPct || 0) / 100));
    inst.paid = [...new Set([...inst.paid, ...future.map((p) => p.n)])];
    // as parcelas futuras somem; o pagamento à vista entra no mês atual
    inst.totalCents -= remaining;
    inst.count -= future.length;
    if (inst.count <= 0) sim.installments = sim.installments.filter((x) => x.id !== id);
    sim.expenses.push({ id: newId(), description: `Simulação: quitação de ${inst.description}`, cents: discounted, dueDate: dateInMonth(fromYM, 28), paidAt: null, categoryId: inst.categoryId, subcategoryId: null, creditorId: null, notes: '' });
  }

  const base = projection(state, fromYM, months, today);
  let proj = projection(sim, fromYM, months, today);
  if (sc.cutVariablePct > 0) {
    proj = proj.map((p) => {
      const variable = Math.round(p.variable * (1 - sc.cutVariablePct / 100));
      const spent = p.spent - p.variable + variable;
      return { ...p, variable, spent, balance: p.balance + (p.variable - variable) };
    });
  }

  const diff = proj.map((p, i) => p.balance - base[i].balance);
  return {
    base, scenario: proj, diff,
    cumulativeBase: sumCents(base.map((p) => p.balance)),
    cumulativeScenario: sumCents(proj.map((p) => p.balance)),
    cumulativeDiff: sumCents(diff),
  };
}

// ---------- Agenda (calendário de vencimentos) ----------

/**
 * Eventos do mês por dia: contas, salário, 13º, férias, prazos de metas.
 * → { 'AAAA-MM-DD': [{ type, label, cents, status, item? }] }
 */
export function calendarEvents(state, ym, today = todayISO()) {
  const out = {};
  const add = (date, ev) => { (out[date] ||= []).push(ev); };
  const m = computeMonth(state, ym, today);
  for (const i of m.items) add(i.dueDate, { type: 'bill', label: i.description, cents: i.cents, status: i.status, item: i });
  const salaryCash = m.income.salary + (m.income.payrollExtrasNet || 0); // plantões na folha caem junto
  if (salaryCash) add(paydayIn(state.settings, ym), { type: 'income', label: m.income.competence && m.income.competence !== ym ? 'Salário (competência anterior)' : 'Salário', cents: salaryCash });
  for (const x of m.income.extras) if (x.date && !x.payroll) add(x.date, { type: 'income', label: x.description, cents: x.cents });
  const t = thirteenthOf(state, ym);
  if (t) add(dateInMonth(ym, t.part === 1 ? 30 : 20), { type: 'income', label: t.label, cents: t.net });
  const v = vacationIn(state.settings, ym);
  if (v) add(v.start, { type: 'vacation', label: `Início das férias (${v.days} dias)`, cents: m.income.vacation?.net || 0 });
  for (const g of state.goals) if (g.deadline && ymOf(g.deadline) === ym) add(g.deadline, { type: 'goal', label: `Prazo: ${g.description}`, cents: g.targetCents });
  const investing = investingOf(state.settings);
  for (const inv of state.investments || []) {
    if (inv.maturity && ymOf(inv.maturity) === ym) add(inv.maturity, { type: 'invest', label: `Vencimento: ${inv.name}`, cents: positionAt(inv, investing, inv.maturity).value });
  }
  for (const s of shiftsIn(state, ym)) {
    const t = shiftTypeOf(state, s.typeId);
    add(s.date, { type: 'shift', label: t ? t.name : 'Plantão', cents: s.cents ?? t?.cents ?? 0 });
  }
  // Fechamento de cada cartão no mês, com o valor da fatura que fecha nele.
  // Vence depois de fechar (fecha 3, vence 10): a fatura que fecha neste mês
  // vence neste mês; vence antes (fecha 28, vence 5): vence no mês seguinte.
  for (const card of state.cards || []) {
    if (card.archived) continue;
    const inv = invoice(state, card, card.dueDay > card.closingDay ? ym : addMonthsYM(ym, 1), today);
    if (ymOf(inv.closing) === ym) add(inv.closing, { type: 'card', label: `Fechamento: ${card.name}`, cents: inv.total });
  }
  for (const r of state.receivables || []) {
    if (!r.receivedAt && r.dueDate && ymOf(r.dueDate) === ym) add(r.dueDate, { type: 'receivable', label: `A receber: ${r.person || r.description}`, cents: r.cents });
  }
  for (const r of state.recurring || []) {
    if (r.subscription && r.renewal && ymOf(r.renewal) === ym) add(r.renewal, { type: 'renewal', label: `Renovação: ${r.description}`, cents: r.cents });
  }
  return out;
}

/** Grade do mês (semanas começando no domingo): [[{ date, inMonth }...7]...] */
export function monthGrid(ym) {
  const { y, m } = parseYM(ym);
  const first = new Date(y, m - 1, 1).getDay();
  const days = daysInMonth(y, m);
  const start = addDaysISO(toISO(y, m, 1), -first);
  const weeks = Math.ceil((first + days) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDaysISO(start, w * 7 + d);
      return { date, inMonth: ymOf(date) === ym };
    }));
}

// ---------- Exportar para o calendário do celular (.ics) ----------

const icsDate = (iso) => iso.replace(/-/g, '');
const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

/**
 * Arquivo .ics com as contas NÃO pagas dos próximos `months` meses,
 * com alarme `daysBefore` dias antes. Importe no Google Agenda / iPhone.
 */
export function buildICS(state, fromYM, months = 12, daysBefore = 1, today = todayISO()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dhenors//Contas//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Dhenors · Contas'];
  const stamp = `${icsDate(today)}T000000Z`;
  for (let i = 0; i < months; i++) {
    const ym = addMonthsYM(fromYM, i);
    for (const it of computeMonth(state, ym, today).items) {
      if (it.status === 'paid') continue;
      const value = (it.cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const uid = `${it.key.replace(/[^\w-]/g, '_')}@dhenors`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(it.dueDate)}`,
        `DTEND;VALUE=DATE:${icsDate(addDaysISO(it.dueDate, 1))}`,
        `SUMMARY:${icsText(`💸 ${it.description} — ${value}`)}`,
        `DESCRIPTION:${icsText(`Vencimento no Dhenors${it.parcel ? ` · parcela ${it.parcel.n}/${it.parcel.count}` : ''}`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Vence ${daysBefore ? `em ${plural(daysBefore, 'dia')}` : 'hoje'}: ${it.description}`)}`,
        daysBefore ? `TRIGGER:-P${daysBefore - 1}DT15H` : 'TRIGGER:PT9H', 'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Contas para lembrar hoje: vencendo em até `daysBefore` dias ou atrasadas. */
export function dueReminders(state, daysBefore = 1, today = todayISO()) {
  const ym = ymOf(today);
  const limit = addDaysISO(today, daysBefore);
  const list = [
    ...overdueBefore(state, ym, today),
    ...computeMonth(state, ym, today).items.filter((i) => i.status !== 'paid' && i.dueDate <= limit),
  ];
  if (ymOf(limit) !== ym) {
    list.push(...computeMonth(state, ymOf(limit), today).items.filter((i) => i.status !== 'paid' && i.dueDate <= limit));
  }
  return list;
}

