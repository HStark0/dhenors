// @ts-check
// =============================================================
// cards.js — Cartão de crédito de verdade: faturas
// -------------------------------------------------------------
// Cada cartão tem DIA DE FECHAMENTO e DIA DE VENCIMENTO.
//  • Uma compra entra na fatura que fecha DEPOIS dela. Compra feita
//    no próprio dia do fechamento já vai para a fatura seguinte
//    (é o "melhor dia de compra").
//  • Compra parcelada: cada parcela cai numa fatura seguida.
//  • Estorno: compra com valor negativo (abate da fatura).
//  • A fatura de um mês vira UMA conta a pagar (kind 'invoice') com
//    vencimento no dia de vencimento do cartão. Pagar a fatura marca
//    tudo de dentro dela como pago.
// O mês de uma fatura ("AAAA-MM") é o mês do VENCIMENTO.
//
// Funções puras (testadas em tests/cards.test.mjs).
// =============================================================

import { splitCents, sumCents } from '../core/money.js';
import { addMonthsYM, dateInMonth, ymOf, todayISO, diffDays } from '../core/dates.js';
import { recurringDates, entryKey, FREQ_DAYS } from './recurrence.js';

export const invoiceKey = (cardId, ym) => `${cardId}|${ym}`;

/** Mês (do vencimento) da fatura em que entra uma compra feita em `date`. */
export function invoiceMonthFor(card, date) {
  const closingThisMonth = dateInMonth(ymOf(date), card.closingDay);
  const closeYM = date < closingThisMonth ? ymOf(date) : addMonthsYM(ymOf(date), 1);
  // Vencimento depois do fechamento no mesmo mês, ou no mês seguinte
  return card.dueDay > card.closingDay ? closeYM : addMonthsYM(closeYM, 1);
}

/** Data de fechamento e de vencimento da fatura do mês `ym`. */
export function invoiceDates(card, ym) {
  const due = dateInMonth(ym, card.dueDay);
  const closeYM = card.dueDay > card.closingDay ? ym : addMonthsYM(ym, -1);
  return { closing: dateInMonth(closeYM, card.closingDay), due };
}

/** Parcelas de uma compra: [{ n, count, ym, cents }] */
export function purchaseSchedule(card, purchase) {
  const first = invoiceMonthFor(card, purchase.date);
  const count = Math.max(1, purchase.count || 1);
  const sign = purchase.cents < 0 ? -1 : 1;
  return splitCents(Math.abs(purchase.cents), count).map((cents, i) => ({ n: i + 1, count, ym: addMonthsYM(first, i), cents: cents * sign }));
}

/** Itens da fatura do mês: [{ purchase, n, count, cents }] */
export function invoiceLines(state, card, ym) {
  const lines = [];
  for (const p of state.cardPurchases || []) {
    if (p.cardId !== card.id) continue;
    for (const parcel of purchaseSchedule(card, p)) {
      if (parcel.ym === ym) lines.push({ purchase: p, n: parcel.n, count: parcel.count, cents: parcel.cents });
    }
  }
  // Recorrentes cobradas no cartão (assinaturas): entram na fatura do mês em
  // que VENCEM, respeitando o ritmo (anual, trimestral, semanal…)
  for (const r of state.recurring || []) {
    if (r.cardId !== card.id) continue;
    for (const date of recurringDates(r, ym)) {
      const entry = state.recurringEntries?.[entryKey(r.id, FREQ_DAYS[r.freq] ? date : ym)] || {};
      if (entry.skipped) continue;
      lines.push({ purchase: { id: FREQ_DAYS[r.freq] ? `rec-${r.id}-${date}` : `rec-${r.id}`, description: r.description, categoryId: r.categoryId, subcategoryId: r.subcategoryId, date, recurringId: r.id }, n: 1, count: 1, cents: entry.cents ?? r.cents });
    }
  }
  return lines.sort((a, b) => a.purchase.date.localeCompare(b.purchase.date));
}

/**
 * Fatura do mês.
 * → { card, ym, key, lines, total, closing, due, paidAt, paidCents, status: 'open'|'closed'|'paid', parts }
 *   parts = valor por categoria (para os gráficos e orçamentos)
 */
export function invoice(state, card, ym, today = todayISO()) {
  const lines = invoiceLines(state, card, ym);
  const total = sumCents(lines.map((l) => l.cents));
  const { closing, due } = invoiceDates(card, ym);
  const pay = state.cardInvoices?.[invoiceKey(card.id, ym)] || {};
  const status = pay.paidAt ? 'paid' : today >= closing ? 'closed' : 'open';
  const byCat = new Map();
  for (const l of lines) {
    const splits = l.purchase.splits?.length ? l.purchase.splits : null;
    if (splits) {
      const ratio = l.cents / sumCents(splits.map((s) => s.cents));
      for (const s of splits) byCat.set(s.categoryId || '_none', (byCat.get(s.categoryId || '_none') || 0) + Math.round(s.cents * ratio));
    } else byCat.set(l.purchase.categoryId || '_none', (byCat.get(l.purchase.categoryId || '_none') || 0) + l.cents);
  }
  return {
    card, ym, key: invoiceKey(card.id, ym), lines, total, closing, due,
    paidAt: pay.paidAt || null, paidCents: pay.cents ?? null, status,
    parts: [...byCat.entries()].map(([categoryId, cents]) => ({ categoryId: categoryId === '_none' ? null : categoryId, cents })),
  };
}

/** Faturas (com valor) de todos os cartões no mês. */
export function invoicesIn(state, ym, today = todayISO()) {
  return (state.cards || [])
    .map((c) => invoice(state, c, ym, today))
    .filter((inv) => inv.total !== 0 || inv.paidAt);
}

/**
 * Limite do cartão: usado = tudo que ainda não foi pago (faturas em
 * aberto e parcelas futuras).
 */
export function cardUsage(state, card, today = todayISO()) {
  let used = 0;
  const months = new Set();
  for (const p of state.cardPurchases || []) {
    if (p.cardId !== card.id) continue;
    for (const parcel of purchaseSchedule(card, p)) months.add(parcel.ym);
  }
  for (const ym of months) {
    const inv = invoice(state, card, ym, today);
    if (!inv.paidAt) used += inv.total;
  }
  const limit = card.limitCents || 0;
  return { used, limit, available: limit ? limit - used : null, pct: limit ? (used / limit) * 100 : 0 };
}

/** Próxima fatura a fechar e o "melhor dia de compra". */
export function nextInvoice(state, card, today = todayISO()) {
  const ym = invoiceMonthFor(card, today);
  const inv = invoice(state, card, ym, today);
  return { ...inv, daysToClose: diffDays(today, inv.closing), bestDay: card.closingDay };
}
