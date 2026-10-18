// =============================================================
// yearplan.js — Planejamento de 12 meses e "Posso comprar?"
// -------------------------------------------------------------
// • Ano: mês a mês, renda (com 13º, férias, PLR), contas fixas,
//   parcelas, faturas já lançadas, gastos do dia a dia estimados e as
//   despesas ANUAIS/semestrais (IPVA, IPTU, seguro, material escolar —
//   cadastre como recorrente "Anual"). Mostra os meses que apertam.
// • Posso comprar? Você informa o valor (à vista ou parcelado, no
//   cartão ou não) e o app mostra o saldo dos próximos meses com e sem
//   a compra, se algum mês fica no vermelho e o efeito na reserva.
// =============================================================

import { sumCents } from '../core/money.js';
import { addMonthsYM, todayISO, ymOf, dateInMonth, formatMonth } from '../core/dates.js';
import { computeMonth, FREQ_MONTHS } from './ledger.js';
import { projection } from './analysis.js';
import { emergencyCoverage } from './planning.js';
import { monthStatus, bigThreshold, alertsOf } from './monthStatus.js';
import { impactPreview } from './outlook.js';
import { memoByState } from '../core/memo.js';

/**
 * → { months: [{ ym, income, thirteenth, vacation, fixed, installments, invoices, variable, annual: [..], spent, balance,
 *                status: 'ok'|'tight'|'short'|'none', tight }],
 *     totals, tightMonths, shortMonths, events: [{ ym, label, cents, kind }] }
 * Renda e sobra vêm de projection() (inclui 13º, férias e benefícios);
 * a situação do mês vem de monthStatus() — a mesma regra do painel.
 */
function yearPlanRaw(state, startYM, months = 12, today = todayISO()) {
  const proj = projection(state, startYM, months, today);
  const out = proj.map((p) => {
    const m = computeMonth(state, p.ym, today);
    const annual = m.items.filter((i) => i.kind === 'recurring' && (FREQ_MONTHS[i.freq] || 1) >= 6).map((i) => ({ label: i.description, cents: i.cents }));
    const bigFrom = bigThreshold(p.baseIncome, state.settings);
    const big = m.items.filter((i) => i.kind === 'expense' && i.cents >= bigFrom).map((i) => ({ label: i.description, cents: i.cents }));
    const status = monthStatus(p.balance, p.income, state.settings, p.spent);
    return {
      ym: p.ym,
      income: p.income,
      thirteenth: p.thirteenth,
      vacation: m.income.vacationNet || 0,
      benefits: m.income.benefitsNet || 0,
      fixed: p.recurring,
      installments: p.installment,
      invoices: m.totals.invoice,
      variable: p.variable,
      launchedVariable: p.launchedVariable,
      oneOff: p.oneOff,
      baseIncome: p.baseIncome,
      variableEstimate: p.variableEstimate,
      annual,
      big,
      spent: p.spent,
      balance: p.balance,
      status,
      tight: status === 'tight' || status === 'short',
    };
  });
  const events = [];
  for (const m of out) {
    if (m.thirteenth) events.push({ ym: m.ym, label: '13º salário', cents: m.thirteenth, kind: 'in' });
    if (m.vacation) events.push({ ym: m.ym, label: 'Férias', cents: m.vacation, kind: 'in' });
    if (m.benefits) events.push({ ym: m.ym, label: 'PLR / benefícios', cents: m.benefits, kind: 'in' });
    for (const a of m.annual) events.push({ ym: m.ym, label: a.label, cents: a.cents, kind: 'out' });
    for (const b of m.big) events.push({ ym: m.ym, label: b.label, cents: b.cents, kind: 'out' });
  }
  return {
    months: out,
    totals: { income: sumCents(out.map((m) => m.income)), spent: sumCents(out.map((m) => m.spent)), balance: sumCents(out.map((m) => m.balance)) },
    tightMonths: out.filter((m) => m.tight).map((m) => m.ym),
    shortMonths: out.filter((m) => m.status === 'short').map((m) => m.ym),
    events,
  };
}
const yearPlanMemo = memoByState(yearPlanRaw);
/** O resultado é compartilhado (cache): não altere os objetos devolvidos. */
export const yearPlan = (state, startYM, months = 12, today = todayISO()) => yearPlanMemo(state, startYM, months, today);

/**
 * Posso comprar? purchase = { cents, count (1 = à vista), startYM? }
 * → { verdict: 'sim'|'apertado'|'nao', months: [{ ym, before, after }], worst, reserveAfter, reasons }
 */
export function canIBuy(state, { cents, count = 1, firstYM = null }, months = 12, today = todayISO()) {
  const from = ymOf(today);
  const start = firstYM || (count > 1 ? addMonthsYM(from, 1) : from);
  const n = Math.max(1, count);
  const parcel = Math.round(cents / n);
  // Mesma prévia do editor de contas: à vista = gasto avulso no mês;
  // parcelado = parcelamento a partir do mês seguinte (dia 10)
  const draft = n === 1
    ? { kind: 'expense', cents, dueDate: start === from ? today : dateInMonth(start, 10), extra: true }
    : { kind: 'installment', inst: { totalCents: cents, count: n, firstDueDate: dateInMonth(start, 10), dueDay: 10, paid: [] } };
  const preview = impactPreview(state, draft, today, { months });
  const rows = preview.months.slice(0, months).map((r) => ({ ym: r.ym, before: r.before, after: r.after, statusBefore: r.statusBefore, statusAfter: r.statusAfter }));
  const worst = rows.reduce((a, r) => (r.after < a.after ? r : a), rows[0]);
  const reserve = emergencyCoverage(state, from, today);
  const reserveAfter = n === 1 && rows[0].after < 0 ? { ...reserve, saved: reserve.saved + rows[0].after } : reserve;
  const negatives = rows.filter((r) => r.after < 0);
  const reasons = [];
  if (negatives.length) reasons.push(`${negatives.length === 1 ? 'Um mês fica' : `${negatives.length} meses ficam`} no vermelho (pior: ${formatMonth(worst.ym)}).`);
  const tight = rows.filter((r) => r.statusAfter === 'tight' && r.after < r.before);
  if (tight.length) reasons.push(`${tight.length === 1 ? 'Um mês fica' : `${tight.length} meses ficam`} apertado(s), com menos de ${alertsOf(state.settings).tightPct}% dos ganhos sobrando.`);
  if (reserve.months < 3) reasons.push('A reserva de emergência cobre menos de 3 meses: comprar agora deixa você mais exposto a imprevistos.');
  const verdict = negatives.length ? 'nao' : tight.length || reserve.months < 3 ? 'apertado' : 'sim';
  return { verdict, months: rows, worst, parcel, count: n, reserve, reserveAfter, reasons, headline: preview.headline, firstDue: dateInMonth(start, 10) };
}
