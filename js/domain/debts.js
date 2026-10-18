// @ts-check
// =============================================================
// debts.js — Dívidas, assinaturas e quitação antecipada
// -------------------------------------------------------------
// • Simulação de quitação com um valor extra por mês:
//     bola de neve  → paga primeiro a MENOR dívida (motivação)
//     avalanche     → paga primeiro a de MAIOR juro (economiza mais)
//   Cada mês: juros sobre o saldo, pagamento mínimo de todas e o
//   extra (mais o mínimo das que já quitaram) vai para a da vez.
// • Quitação antecipada de um parcelamento: desconto dos juros
//   futuros (valor presente das parcelas restantes).
// • Assinaturas: custo mensal/anual, aumentos de preço e renovações.
// =============================================================

import { sumCents } from '../core/money.js';
import { todayISO, diffDays, ymOf } from '../core/dates.js';
import { FREQ_MONTHS, FREQ_DAYS, recurringActiveIn } from './ledger.js';

/**
 * debts: [{ id, name, balanceCents, rateMonthlyBp, paymentCents }]
 * → { months, interest, paid, order: [{ id, name, month }], timeline: [{ month, balance }], stuck }
 */
export function simulatePayoff(debts, { extraCents = 0, method = 'avalanche', maxMonths = 600 } = {}) {
  const list = debts.filter((d) => d.balanceCents > 0).map((d) => ({ ...d, bal: d.balanceCents, rate: (d.rateMonthlyBp || 0) / 10000 }));
  const order = [];
  const timeline = [{ month: 0, balance: sumCents(list.map((d) => d.bal)) }];
  let interest = 0;
  let paid = 0;
  let month = 0;
  const budget = sumCents(list.map((d) => d.paymentCents || 0)) + extraCents;
  if (!list.length) return { months: 0, interest: 0, paid: 0, order, timeline, stuck: false };
  while (list.some((d) => d.bal > 0) && month < maxMonths) {
    month++;
    for (const d of list) if (d.bal > 0) { const j = Math.round(d.bal * d.rate); d.bal += j; interest += j; }
    let money = budget;
    // mínimos
    for (const d of list) {
      if (d.bal <= 0) continue;
      const p = Math.min(d.bal, d.paymentCents || 0, money);
      d.bal -= p; money -= p; paid += p;
    }
    // extra na dívida da vez
    const open = list.filter((d) => d.bal > 0).sort((a, b) => (method === 'snowball' ? a.bal - b.bal : b.rate - a.rate || a.bal - b.bal));
    for (const d of open) {
      if (money <= 0) break;
      const p = Math.min(d.bal, money);
      d.bal -= p; money -= p; paid += p;
    }
    for (const d of list) if (d.bal <= 0 && !order.some((o) => o.id === d.id)) order.push({ id: d.id, name: d.name, month });
    timeline.push({ month, balance: sumCents(list.map((d) => Math.max(0, d.bal))) });
    if (month > 2 && timeline[month].balance >= timeline[month - 1].balance) {
      return { months: null, interest, paid, order, timeline, stuck: true }; // pagamento não cobre os juros
    }
  }
  return { months: list.some((d) => d.bal > 0) ? null : month, interest, paid, order, timeline, stuck: list.some((d) => d.bal > 0) };
}

/** Compara bola de neve × avalanche × só os mínimos. */
export function comparePayoff(debts, extraCents) {
  return {
    minimum: simulatePayoff(debts, { extraCents: 0, method: 'avalanche' }),
    snowball: simulatePayoff(debts, { extraCents, method: 'snowball' }),
    avalanche: simulatePayoff(debts, { extraCents, method: 'avalanche' }),
  };
}

/**
 * Quitação antecipada: valor presente das parcelas restantes a uma taxa
 * mensal (os juros embutidos que você deixa de pagar).
 * → { nominal, presentValue, discount, discountPct }
 */
export function earlyPayoff(parcels, rateMonthlyBp) {
  const r = rateMonthlyBp / 10000;
  const nominal = sumCents(parcels);
  const pv = Math.round(parcels.reduce((a, c, i) => a + c / (1 + r) ** (i + 1), 0));
  return { nominal, presentValue: pv, discount: nominal - pv, discountPct: nominal ? ((nominal - pv) / nominal) * 100 : 0 };
}

/** Custo mensal equivalente de uma recorrente conforme o ritmo. */
export function monthlyEquivalent(rec) {
  if (FREQ_DAYS[rec.freq]) return Math.round((rec.cents * 365) / FREQ_DAYS[rec.freq] / 12);
  return Math.round(rec.cents / (FREQ_MONTHS[rec.freq] || 1));
}

/**
 * Assinaturas ativas: custo mensal e anual, aumento de preço e renovação.
 * → { list: [{ rec, monthly, annual, increase: { from, to, pct } | null, renewalDays }], monthly, annual }
 */
export function subscriptionsSummary(state, today = todayISO()) {
  const ym = ymOf(today);
  const list = (state.recurring || []).filter((r) => r.subscription && (recurringActiveIn(r, ym) || r.startYM > ym)).map((rec) => {
    const h = rec.priceHistory || [];
    const last = h[h.length - 1];
    const prev = h.length >= 2 ? h[h.length - 2] : null;
    const recent = last && diffDays(last.date, today) <= 60;
    const increase = prev && last && last.cents > prev.cents && recent ? { from: prev.cents, to: last.cents, pct: ((last.cents - prev.cents) / prev.cents) * 100, date: last.date } : null;
    const renewalDays = rec.renewal ? diffDays(today, rec.renewal) : null;
    const monthly = monthlyEquivalent(rec);
    return { rec, monthly, annual: monthly * 12, increase, renewalDays };
  }).sort((a, b) => b.monthly - a.monthly);
  return { list, monthly: sumCents(list.map((x) => x.monthly)), annual: sumCents(list.map((x) => x.annual)) };
}

/** Avisos de assinatura: aumento recente e renovação anual nos próximos 30 dias. */
export function subscriptionAlerts(state, today = todayISO()) {
  const out = [];
  for (const s of subscriptionsSummary(state, today).list) {
    if (s.increase) out.push({ tone: 'warn', title: `${s.rec.description} aumentou ${s.increase.pct.toFixed(0)}%`, text: `De ${(s.increase.from / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para ${(s.increase.to / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Ainda vale a pena?` });
    if (s.renewalDays != null && s.renewalDays >= 0 && s.renewalDays <= 30) out.push({ tone: 'info', title: `${s.rec.description} renova em ${s.renewalDays} dia${s.renewalDays === 1 ? '' : 's'}`, text: 'Cancele antes se não usa mais.' });
  }
  return out;
}
