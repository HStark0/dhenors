// @ts-check
// =============================================================
// outlook.js — Salário × ganhos × gastos, meses que não fecham e
//              prévia do impacto de um lançamento
// -------------------------------------------------------------
// Nada aqui calcula o mês de novo: tudo vem de computeMonth()
// (ledger.js) e de yearPlan()/projection() (a mesma previsão da aba
// 12 meses, do "Posso comprar?" e do simulador). Assim painel,
// agenda, planejamento e editor mostram os mesmos números.
//
// • monthMoney(state, ym)   os três saldos do mês: salário (folha),
//                           ganhos (folha + fora da folha + férias,
//                           benefícios, outros vínculos) e gastos.
// • monthWhy(state, ym)     por que um mês aperta: o que pesa nele.
// • impactPreview(state, draft)  como um lançamento AINDA NÃO SALVO
//                           muda os próximos meses (editor de contas).
// =============================================================

import { sumCents, percent, formatBRL, plural } from '../core/money.js';
import { addMonthsYM, monthsBetween, todayISO, ymOf, formatMonth } from '../core/dates.js';
import { memoByState } from '../core/memo.js';
import { computeMonth, installmentSchedule, planInstallment, recurringDates, FREQ_MONTHS } from './ledger.js';
import { purchaseSchedule, invoiceLines } from './cards.js';
import { yearPlan } from './yearplan.js';
import { spendingRoom } from './planning.js';
import { median } from './analysis.js';
import { monthStatus, bigThreshold, tightMargin } from './monthStatus.js';

// ---------- Os três saldos do mês ----------

/**
 * → {
 *   ym, status,
 *   salary:   { net, gross, base, additions: [{ label, cents }], additionsTotal, deductions: [{ label, cents }],
 *               deductionsTotal, estimatedNet, actual, competence, hasProfile, legacyNet },
 *   extras:   { total, list: [{ id, label, cents, date, recurring, shift }] },   // FORA da folha
 *   others:   { total, list: [{ label, cents }] },     // férias, PLR/benefícios, outros vínculos
 *   thirteenth: { net, label, part } | null,           // pago à parte (fora do saldo do mês)
 *   earnings,                                          // = income.total (o que entra no mês)
 *   spending: { total, paid, pending, overdue, open, count, openCount },
 *   balance, committedPct, freePct
 * }
 * earnings = salary.net + extras.total + others.total (sempre).
 */
function monthMoneyRaw(state, ym, today = todayISO()) {
  const m = computeMonth(state, ym, today);
  const inc = m.income;
  const p = inc.payroll;

  const payrollExtras = inc.extras.filter((x) => x.payroll);
  const additions = [
    ...(p.additions || []).map((a) => ({ label: a.description, cents: a.cents })),
    ...payrollExtras.map((x) => ({ label: x.description, cents: x.cents })),
  ].filter((a) => a.cents);
  const deductions = [
    { label: p.inssLabel || 'INSS', cents: p.inss || 0 },
    { label: 'Imposto de renda', cents: p.ir?.value || 0 },
    ...(p.deductions || []).map((d) => ({ label: d.description, cents: d.cents })),
  ].filter((d) => d.cents);
  const salaryNet = inc.salary + (inc.payrollExtrasNet || 0);

  const outside = inc.extras.filter((x) => !x.payroll).map((x) => ({
    id: x.id, label: x.description, cents: x.cents, date: x.date || null,
    recurring: Boolean(x.recurringIncomeId), recurringIncomeId: x.recurringIncomeId || null, shift: Boolean(x.auto && !x.recurringIncomeId),
  }));
  const others = [
    ...(inc.vacationNet ? [{ label: 'Férias', cents: inc.vacationNet }] : []),
    ...(inc.benefits?.cash || []).map((b) => ({ label: b.name, cents: b.net })),
    ...(inc.jobs?.list || []).map((j) => ({ label: j.job.name, cents: j.net })),
  ].filter((x) => x.cents);
  const earnings = inc.total;
  const t = m.totals;

  return {
    ym,
    status: monthStatus(m.balance, earnings, state.settings, t.all),
    salary: {
      net: salaryNet, gross: p.gross || 0, base: p.base || 0,
      additions, additionsTotal: sumCents(additions.map((a) => a.cents)),
      deductions, deductionsTotal: sumCents(deductions.map((d) => d.cents)),
      estimatedNet: p.net, actual: inc.actual, competence: inc.competence,
      hasProfile: Boolean(p.hasProfile), legacyNet: Boolean(p.legacyNet),
    },
    extras: { total: sumCents(outside.map((x) => x.cents)), list: outside },
    others: { total: earnings - salaryNet - sumCents(outside.map((x) => x.cents)), list: others },
    thirteenth: inc.thirteenth ? { net: inc.thirteenth.net, label: inc.thirteenth.label, part: inc.thirteenth.part } : null,
    earnings,
    spending: {
      total: t.all, paid: t.paid, pending: t.pending, overdue: t.overdue, open: t.pending - t.overdue,
      count: t.count, openCount: t.pendingCount,
    },
    balance: m.balance,
    committedPct: percent(t.all, earnings),
    freePct: earnings > 0 ? Math.max(0, percent(m.balance, earnings)) : 0,
  };
}
const monthMoneyMemo = memoByState(monthMoneyRaw);
/** O resultado é compartilhado (cache): não altere os objetos devolvidos. */
export const monthMoney = (state, ym, today = todayISO()) => monthMoneyMemo(state, ym, today);

// ---------- Situação dos próximos meses ----------

/** Linha da previsão para um mês (a mesma da aba 12 meses), ou null para meses passados. */
export function outlookRow(state, ym, today = todayISO()) {
  const from = ymOf(today);
  if (ym < from) return null;
  const n = monthsBetween(from, ym) + 1;
  return yearPlan(state, from, Math.max(12, n), today).months[n - 1];
}

/**
 * Por que o mês aperta: o que pesa nele e quanto falta.
 * → { ym, income, spent, balance, status, gap, toOk, causes: [{ kind, label, cents, note }], incomeNote, forecast }
 *   gap  = quanto falta para não ficar negativo
 *   toOk = quanto falta para sair do "apertado" (folga mínima de Ajustes)
 */
export function monthWhy(state, ym, today = todayISO()) {
  const m = computeMonth(state, ym, today);
  const row = outlookRow(state, ym, today);
  const income = row ? row.income : m.income.total;
  const spent = row ? row.spent : m.totals.all;
  const balance = income - spent;
  const big = bigThreshold(m.income.total, state.settings);
  const causes = [];
  const fixedMonthly = [];
  let smallExpenses = 0;
  let smallCount = 0;

  for (const i of m.items) {
    if (i.kind === 'installment') {
      causes.push({ kind: 'installment', label: i.description, cents: i.cents, note: `parcela ${i.parcel.n}/${i.parcel.count}${i.parcel.n === i.parcel.count ? ' · a última' : ''}` });
    } else if (i.kind === 'invoice') {
      const card = (state.cards || []).find((c) => c.id === i.refId);
      const lines = card ? invoiceLines(state, card, ym) : [];
      const parcelled = lines.filter((l) => l.count > 1).length;
      causes.push({ kind: 'invoice', label: i.description, cents: i.cents, note: parcelled ? `${plural(parcelled, 'compra parcelada', 'compras parceladas')}` : '' });
    } else if (i.kind === 'recurring' && (FREQ_MONTHS[i.freq] || 1) >= 2) {
      causes.push({ kind: 'seasonal', label: i.description, cents: i.cents, note: 'não vem todo mês' });
    } else if (i.kind === 'recurring') {
      fixedMonthly.push(i);
    } else if (i.kind === 'expense' && i.cents >= big) {
      causes.push({ kind: 'big', label: i.description, cents: i.cents, note: 'gasto grande' });
    } else if (i.kind === 'expense') {
      smallExpenses += i.cents;
      smallCount++;
    }
  }
  if (fixedMonthly.length) {
    const top = [...fixedMonthly].sort((a, b) => b.cents - a.cents).slice(0, 3).map((i) => i.description);
    causes.push({ kind: 'fixed', label: `Contas fixas (${fixedMonthly.length})`, cents: sumCents(fixedMonthly.map((i) => i.cents)), note: top.join(', ') });
  }
  if (smallExpenses) causes.push({ kind: 'expenses', label: `Outras avulsas (${smallCount})`, cents: smallExpenses, note: '' });
  const estimate = row ? row.variable - row.launchedVariable : 0;
  if (estimate > 0) causes.push({ kind: 'estimate', label: 'Dia a dia (estimado)', cents: estimate, note: 'mediana dos últimos 3 meses' });
  causes.sort((a, b) => b.cents - a.cents);

  let incomeNote = null;
  if (row) {
    const plan = yearPlan(state, ymOf(today), 12, today);
    const usual = median(plan.months.map((x) => x.income));
    if (usual > 0 && income < usual * 0.9) incomeNote = `Entra menos que o normal: ${formatBRL(income)}, contra ${formatBRL(usual)} na maioria dos meses.`;
  }
  const status = monthStatus(balance, income, state.settings, spent);
  return {
    ym, income, spent, balance, status, causes, incomeNote, forecast: Boolean(row),
    gap: Math.max(0, -balance),
    toOk: Math.max(0, tightMargin(income, state.settings) - balance),
  };
}

/**
 * Para os lembretes: quantos dos próximos 12 meses não fecham (0 se o
 * aviso estiver desligado em Ajustes → Alertas e dicas). Só a
 * quantidade e o primeiro mês — nunca valores.
 */
export function shortMonthsAhead(state, today = todayISO()) {
  const alerts = state.settings?.alerts;
  if (alerts && alerts.push === false) return { count: 0, first: null };
  const short = yearPlan(state, ymOf(today), 12, today).shortMonths;
  return { count: short.length, first: short[0] || null };
}

// ---------- Prévia do impacto de um lançamento ----------

/**
 * Linhas mensais de um lançamento: [{ ym, cents, bucket: 'fixed'|'variable', noBig? }]
 *  fixed    → entra como recorrente/parcela (soma direto na previsão)
 *  variable → entra no "dia a dia" (avulsas e faturas): segue a mesma
 *             regra de projection(): gasto grande soma por cima, gasto
 *             pequeno compete com a mediana.
 */
export function draftLines(state, draft, fromYM, toYM) {
  const out = [];
  const inRange = (ym) => ym >= fromYM && ym <= toYM;
  const sign = draft.remove ? -1 : 1;
  if (draft.kind === 'expense') {
    const ym = ymOf(draft.dueDate);
    if (inRange(ym) && draft.cents) out.push({ ym, cents: sign * draft.cents, bucket: 'variable' });
  } else if (draft.kind === 'installment') {
    const inst = draft.inst || (() => {
      const plan = planInstallment({ parcelCents: draft.parcelCents, count: draft.count, paidCount: draft.paidCount || 0, nextDueDate: draft.nextDueDate, dueDay: draft.dueDay });
      return { totalCents: plan.totalCents, count: draft.count, firstDueDate: plan.firstDueDate, dueDay: plan.dueDay, paid: [] };
    })();
    for (const p of installmentSchedule(inst)) if (inRange(p.ym)) out.push({ ym: p.ym, cents: sign * p.cents, bucket: 'fixed' });
  } else if (draft.kind === 'card') {
    const card = (state.cards || []).find((c) => c.id === draft.cardId);
    if (card && draft.cents) {
      for (const s of purchaseSchedule(card, { date: draft.date, cents: draft.cents, count: draft.count || 1 })) {
        if (inRange(s.ym)) out.push({ ym: s.ym, cents: sign * s.cents, bucket: 'variable' });
      }
    }
  } else if (draft.kind === 'recurring') {
    const rec = { startYM: draft.startYM, endYM: draft.endYM || null, freq: draft.freq || 'monthly', dueDay: draft.dueDay, anchorDate: draft.anchorDate || null };
    for (let ym = fromYM; ym <= toYM; ym = addMonthsYM(ym, 1)) {
      const n = recurringDates(rec, ym).length;
      if (n) out.push({ ym, cents: sign * draft.cents * n, bucket: draft.cardId ? 'variable' : 'fixed', noBig: true });
    }
  }
  return draft.remove ? out.map((l) => ({ ...l, removed: true })) : out;
}

/** O lançamento como está salvo hoje (para descontar ao editar). */
function storedDraft(state, ref) {
  if (!ref?.id) return null;
  if (ref.kind === 'expense') {
    const e = state.expenses.find((x) => x.id === ref.id);
    return e ? { kind: 'expense', cents: e.cents, dueDate: e.dueDate } : null;
  }
  if (ref.kind === 'installment') {
    const inst = state.installments.find((x) => x.id === ref.id);
    return inst ? { kind: 'installment', inst } : null;
  }
  if (ref.kind === 'card') {
    const p = (state.cardPurchases || []).find((x) => x.id === ref.id);
    return p ? { kind: 'card', cardId: p.cardId, date: p.date, cents: p.cents, count: p.count } : null;
  }
  if (ref.kind === 'recurring') {
    const r = state.recurring.find((x) => x.id === ref.id);
    return r ? { kind: 'recurring', cents: r.cents, freq: r.freq, dueDay: r.dueDay, startYM: r.startYM, endYM: r.endYM, anchorDate: r.anchorDate, cardId: r.cardId } : null;
  }
  return null;
}

const RANK = { none: 0, ok: 0, tight: 1, short: 2 };
const NOUN = { expense: 'esta conta', card: 'esta compra', installment: 'este parcelamento', recurring: 'esta recorrente' };

/**
 * Como um lançamento ainda NÃO salvo muda os próximos meses.
 * draft = { kind: 'expense'|'installment'|'card'|'recurring', …campos do editor, replace?: { kind, id } }
 *   extra: true = compra a mais do dia a dia ("Posso comprar?"): soma por cima da mediana
 *   expense:     { cents, dueDate }
 *   installment: { parcelCents, count, paidCount, nextDueDate, dueDay }
 *   card:        { cardId, date, cents, count }
 *   recurring:   { cents, freq, dueDay, startYM, endYM, anchorDate, cardId }
 * → { months: [{ ym, before, after, delta, income, statusBefore, statusAfter, weighs, worse }],
 *     affected, weighs, worst, headline: { tone, text }, beyond, untilPay }
 *   weighs = mês em que o lançamento existe E o mês fica apertado ou negativo
 * Usa a MESMA regra de projection(): depois de salvar, a aba 12 meses
 * mostra exatamente o "depois" desta prévia.
 */
export function impactPreview(state, draft, today = todayISO(), { months = 12 } = {}) {
  const from = ymOf(today);
  const maxTo = addMonthsYM(from, 35);
  const lines = [...draftLines(state, draft, from, maxTo)];
  const old = storedDraft(state, draft.replace);
  if (old) lines.push(...draftLines(state, { ...old, remove: true }, from, maxTo));
  const lastYM = lines.filter((l) => l.cents > 0).map((l) => l.ym).sort().pop() || from;
  const horizon = Math.min(36, Math.max(months, monthsBetween(from, lastYM) + 1));
  const plan = yearPlan(state, from, horizon, today);
  const byMonth = new Map();
  for (const l of lines) (byMonth.get(l.ym) || byMonth.set(l.ym, []).get(l.ym)).push(l);

  const rows = plan.months.map((row) => {
    const own = byMonth.get(row.ym) || [];
    const big = bigThreshold(row.baseIncome, state.settings);
    let dFixed = 0;
    let dLaunched = 0;
    let dOneOff = 0;
    for (const l of own) {
      if (l.bucket === 'fixed') dFixed += l.cents;
      else {
        dLaunched += l.cents;
        // gasto grande soma por cima; ao editar, o lançamento antigo grande sai de cima.
        // No "Posso comprar?" (draft.extra) a compra é A MAIS do dia a dia: soma
        // por cima mesmo pequena (senão "sumia" dentro da mediana do dia a dia)
        const onTop = draft.extra && !l.removed;
        if (!l.noBig && (onTop || (l.removed ? -l.cents : l.cents) >= big)) dOneOff += l.cents;
      }
    }
    const launched = row.launchedVariable + dLaunched;
    const oneOff = row.oneOff + dOneOff;
    const variable = Math.max(launched - oneOff, row.variableEstimate) + oneOff;
    const spent = row.fixed + row.installments + dFixed + variable;
    const after = row.income - spent;
    const statusAfter = monthStatus(after, row.income, state.settings, spent);
    const has = own.some((l) => l.cents > 0);
    return {
      ym: row.ym, income: row.income, before: row.balance, after, delta: after - row.balance,
      statusBefore: row.status, statusAfter, has,
      weighs: has && (statusAfter === 'tight' || statusAfter === 'short'),
      worse: RANK[statusAfter] > RANK[row.status],
    };
  });

  const affected = rows.filter((r) => r.has || r.delta !== 0);
  const weighs = rows.filter((r) => r.weighs);
  const worst = affected.length ? affected.reduce((a, r) => (r.after < a.after ? r : a), affected[0]) : null;
  const noun = NOUN[draft.kind] || 'este lançamento';
  const shortNow = affected.filter((r) => r.statusAfter === 'short');
  const newlyShort = shortNow.filter((r) => r.statusBefore !== 'short');
  const newlyTight = affected.filter((r) => r.statusAfter === 'tight' && r.statusBefore === 'ok');
  const more = (list) => (list.length > 1 ? ` (e mais ${plural(list.length - 1, 'mês', 'meses')})` : '');
  let headline;
  if (!affected.length) {
    headline = { tone: 'info', text: 'Não muda os próximos meses.' };
  } else if (newlyShort.length) {
    const w = newlyShort.reduce((a, r) => (r.after < a.after ? r : a), newlyShort[0]);
    headline = { tone: 'bad', text: `Com ${noun}, ${formatMonth(w.ym)} fica negativo em ${formatBRL(-w.after)}${more(newlyShort)}.` };
  } else if (shortNow.length && worst.delta < 0) {
    headline = { tone: 'bad', text: `${capital(formatMonth(worst.ym))} já não fechava; com ${noun}, o buraco vai para ${formatBRL(-worst.after)}.` };
  } else if (newlyTight.length) {
    const w = newlyTight.reduce((a, r) => (r.after < a.after ? r : a), newlyTight[0]);
    headline = { tone: 'warn', text: `Com ${noun}, ${formatMonth(w.ym)} fica apertado: sobra só ${formatBRL(w.after)}${more(newlyTight)}.` };
  } else if (weighs.length) {
    headline = { tone: 'warn', text: `${capital(formatMonth(weighs[0].ym))} já está apertado; com ${noun}, sobra ${formatBRL(weighs[0].after)}.` };
  } else {
    headline = { tone: 'good', text: `Cabe: o mês mais justo (${formatMonth(worst.ym)}) ainda sobra ${formatBRL(worst.after)}.` };
  }

  // Até o próximo salário (avulsas e compras que vencem antes dele)
  let untilPay = null;
  const firstDue = draft.kind === 'expense' ? draft.dueDate : null;
  if (firstDue && draft.cents > 0 && ymOf(firstDue) >= from) {
    const room = spendingRoom(state, today);
    if (firstDue < room.nextPay) {
      const oldCents = old?.kind === 'expense' && old.dueDate < room.nextPay && ymOf(old.dueDate) >= from ? old.cents : 0;
      untilPay = { nextPay: room.nextPay, free: room.free, after: room.free - draft.cents + oldCents };
    }
  }

  return {
    months: rows, affected, weighs, worst, headline, untilPay,
    beyond: lines.filter((l) => l.cents > 0 && l.ym > plan.months[plan.months.length - 1].ym).length,
  };
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
