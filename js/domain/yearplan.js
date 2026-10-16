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
import { addMonthsYM, todayISO, ymOf, dateInMonth } from '../core/dates.js';
import { computeMonth, FREQ_MONTHS } from './ledger.js';
import { projection } from './analysis.js';
import { simulate, emergencyCoverage } from './planning.js';

/**
 * → { months: [{ ym, income, thirteenth, vacation, fixed, installments, invoices, variable, annual: [..], spent, balance, tight }],
 *     totals, tightMonths, events: [{ ym, label, cents, kind }] }
 */
export function yearPlan(state, startYM, months = 12, today = todayISO()) {
  const proj = projection(state, startYM, months, today);
  const out = proj.map((p) => {
    const m = computeMonth(state, p.ym, today);
    const annual = m.items.filter((i) => i.kind === 'recurring' && (FREQ_MONTHS[i.freq] || 1) >= 6).map((i) => ({ label: i.description, cents: i.cents }));
    const big = m.items.filter((i) => i.kind === 'expense' && i.cents >= 50000).map((i) => ({ label: i.description, cents: i.cents }));
    const balance = m.income.total - (p.recurring + p.installment + p.variable);
    return {
      ym: p.ym,
      income: m.income.total,
      thirteenth: m.income.thirteenthNet || 0,
      vacation: m.income.vacationNet || 0,
      benefits: m.income.benefitsNet || 0,
      fixed: p.recurring,
      installments: p.installment,
      invoices: m.totals.invoice,
      variable: p.variable,
      annual,
      big,
      spent: p.recurring + p.installment + p.variable,
      balance,
    };
  });
  const avg = out.length ? sumCents(out.map((m) => m.balance)) / out.length : 0;
  for (const m of out) m.tight = m.balance < 0 || m.balance < avg * 0.4;
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
    events,
  };
}

/**
 * Posso comprar? purchase = { cents, count (1 = à vista), startYM? }
 * → { verdict: 'sim'|'apertado'|'nao', months: [{ ym, before, after }], worst, reserveAfter, reasons }
 */
export function canIBuy(state, { cents, count = 1, firstYM = null }, months = 12, today = todayISO()) {
  const from = ymOf(today);
  const start = firstYM || (count > 1 ? addMonthsYM(from, 1) : from);
  const n = Math.max(1, count);
  const parcel = Math.round(cents / n);
  const sim = simulate(state, { purchase: { parcelCents: parcel, count: n } }, from, months, today);
  // simulate() começa a compra no mês seguinte; à vista entra neste mês
  const rows = sim.base.map((b, i) => {
    let after = sim.scenario[i].balance;
    if (n === 1) after = b.balance - (b.ym === start ? cents : 0);
    return { ym: b.ym, before: b.balance, after };
  });
  const worst = rows.reduce((a, r) => (r.after < a.after ? r : a), rows[0]);
  const reserve = emergencyCoverage(state, from, today);
  const reserveAfter = n === 1 && rows[0].after < 0 ? { ...reserve, saved: reserve.saved + rows[0].after } : reserve;
  const negatives = rows.filter((r) => r.after < 0);
  const reasons = [];
  if (negatives.length) reasons.push(`${negatives.length === 1 ? 'Um mês fica' : `${negatives.length} meses ficam`} no vermelho (pior: ${worst.ym}).`);
  const tight = rows.filter((r) => r.after >= 0 && r.after < r.before * 0.3 && r.before > 0);
  if (tight.length) reasons.push(`${tight.length === 1 ? 'Um mês fica' : `${tight.length} meses ficam`} apertado(s), com menos de 30% da sobra de hoje.`);
  if (reserve.months < 3) reasons.push('A reserva de emergência cobre menos de 3 meses: comprar agora deixa você mais exposto a imprevistos.');
  const verdict = negatives.length ? 'nao' : tight.length || reserve.months < 3 ? 'apertado' : 'sim';
  return { verdict, months: rows, worst, parcel, count: n, reserve, reserveAfter, reasons, firstDue: dateInMonth(start, 10) };
}
