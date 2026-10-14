// =============================================================
// planning.js — Orçamentos, pontuação financeira, simulador e agenda
// -------------------------------------------------------------
// Funções puras (testadas em tests/features.test.mjs).
// =============================================================

import { sumCents, percent, plural } from '../core/money.js';
import { addMonthsYM, dateInMonth, ymOf, todayISO, parseYM, daysInMonth, toISO, addDaysISO } from '../core/dates.js';
import { computeMonth, overdueBefore, goalPlan, installmentSummary } from './ledger.js';
import { monthSeries, projection, median } from './analysis.js';
import { payrollProfileFor, thirteenthFor, vacationIn, paydayIn } from './payroll.js';
import { newId } from './schema.js';

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

/** Quanto a reserva de emergência cobre de meses de gastos. */
export function emergencyCoverage(state, ym, today = todayISO()) {
  const goals = state.goals.filter((g) => g.emergency || /reserva|emerg/i.test(g.description));
  const saved = sumCents(goals.map((g) => goalPlan(g, today).saved));
  const spent = monthSeries(state, addMonthsYM(ym, -1), 3, today).map((m) => m.spent).filter((v) => v > 0);
  const monthly = spent.length ? median(spent) : computeMonth(state, ym, today).totals.all;
  return { saved, monthly, months: monthly > 0 ? saved / monthly : 0, hasGoal: goals.length > 0 };
}

/**
 * Pontuação com 5 fatores. Cada fator traz uma dica prática.
 * → { score, grade, tone, factors: [{ key, label, value, points, max, tip }] }
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
      points: Math.max(0, 20 - overdue * 5),
      tip: overdue ? 'Pague ou renegocie as atrasadas: juros e multas corroem a renda.' : 'Perfeito, nenhuma conta atrasada.',
    },
    {
      key: 'reserve', label: 'Reserva de emergência', max: 20,
      value: reserve.monthly ? `${reserve.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${reserve.months >= 1 && reserve.months < 2 ? 'mês' : 'meses'} de gastos` : '—',
      points: 20 * clamp01(reserve.months / 6),
      tip: reserve.hasGoal ? (reserve.months >= 6 ? 'Reserva completa (6+ meses).' : 'Meta: 6 meses de gastos guardados.') : 'Crie uma meta marcada como "reserva de emergência".',
    },
    {
      key: 'month', label: 'Gastos do mês × renda', max: 15,
      value: month.income.total ? `${spendRatio.toFixed(0)}% da renda` : '—',
      points: month.income.total ? 15 * clamp01((110 - spendRatio) / 20) : 0,
      tip: spendRatio <= 90 ? 'Mês equilibrado.' : 'O mês está gastando quase tudo (ou mais) do que entra.',
    },
  ].map((f) => ({ ...f, points: Math.round(f.points) }));

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0));
  const grade = score >= 80 ? 'Excelente' : score >= 60 ? 'Boa' : score >= 40 ? 'Atenção' : 'Crítica';
  const tone = score >= 80 ? 'good' : score >= 60 ? 'info' : score >= 40 ? 'warn' : 'bad';
  return { score, grade, tone, factors };
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
    if (r) r.endYM = addMonthsYM(fromYM, -1) < r.startYM ? r.startYM : addMonthsYM(fromYM, -1);
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
  const t = thirteenthFor(state.settings, ym);
  if (t) add(dateInMonth(ym, t.part === 1 ? 30 : 20), { type: 'income', label: t.label, cents: t.net });
  const v = vacationIn(state.settings, ym);
  if (v) add(v.start, { type: 'vacation', label: `Início das férias (${v.days} dias)`, cents: m.income.vacation?.net || 0 });
  for (const g of state.goals) if (g.deadline && ymOf(g.deadline) === ym) add(g.deadline, { type: 'goal', label: `Prazo: ${g.description}`, cents: g.targetCents });
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

