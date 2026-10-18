// @ts-check
// =============================================================
// weights.js — Gastos que pesam no futuro e selos dos lançamentos
// -------------------------------------------------------------
// Camada de ANÁLISE em cima de ledger.js (sem DOM, testada em
// tests/outlook.test.mjs). Não recalcula o mês: lê monthItems() e
// os cronogramas que já existem (installmentSchedule,
// purchaseSchedule, recurringDates, simulatePayoff).
//
// • futureWeight(state, ym): o que foi lançado/pago no mês e continua
//   comprometendo os próximos meses — parcelas restantes, compras
//   parceladas no cartão, recorrentes que começaram no mês e dívidas
//   com pagamento mensal — com quanto pesa em CADA mês e até quando.
// • itemFlags(state, ym): selos por lançamento do mês
//     over    → gasto exagerado: bem acima do próprio histórico
//     unusual → fora do comum: avulsa grande ou sem nada parecido antes
//     future  → pesa no futuro: continua nos próximos meses
// Limites em Ajustes → Alertas e dicas (settings.alerts).
// =============================================================

import { sumCents, percent, formatBRL, formatPercent, plural } from '../core/money.js';
import { addMonthsYM, formatMonthShort, todayISO, ymOf } from '../core/dates.js';
import { memoByState } from '../core/memo.js';
import { monthItems, computeMonth, installmentSchedule, recurringDates, FREQ_DAYS } from './ledger.js';
import { purchaseSchedule, invoiceMonthFor } from './cards.js';
import { simulatePayoff } from './debts.js';
import { median } from './analysis.js';
import { alertsOf, bigThreshold } from './monthStatus.js';

/** Quantos meses olhar à frente para recorrentes sem fim (e para resumir). */
export const WEIGHT_HORIZON = 12;
/** Quantos meses de histórico comparar para dizer que um gasto é exagerado. */
const HISTORY = 6;

// ---------- Peso no futuro ----------

/**
 * → { list: [{ key, itemKey, kind, label, months: [{ ym, cents }], until, endless, perMonth, total }],
 *     count, until, endless, byMonth: { ym: cents }, total }
 *   until   = último mês em que ainda pesa (null se não tem fim)
 *   endless = recorrente sem data para acabar (mostra os próximos 12 meses)
 */
function futureWeightRaw(state, ym, today = todayISO()) {
  const list = [];

  // Parcelamentos com parcela no mês e parcelas em aberto depois dele
  for (const inst of state.installments || []) {
    const schedule = installmentSchedule(inst);
    const here = schedule.find((p) => p.ym === ym);
    if (!here) continue;
    const later = schedule.filter((p) => p.ym > ym && !p.paid);
    if (!later.length) continue;
    list.push(entry({
      key: `installment:${inst.id}`, itemKey: `installment:${inst.id}:${here.n}`, kind: 'installment',
      label: `${inst.description} (${here.n}/${inst.count})`, months: later.map((p) => ({ ym: p.ym, cents: p.cents })),
    }));
  }

  // Compras no cartão: parcela na fatura do mês (ou feitas no mês) que seguem nas próximas faturas
  for (const p of state.cardPurchases || []) {
    if (p.cents <= 0) continue;
    const card = (state.cards || []).find((c) => c.id === p.cardId);
    if (!card) continue;
    const schedule = purchaseSchedule(card, p);
    const here = schedule.find((s) => s.ym === ym);
    const boughtNow = ymOf(p.date) === ym;
    if (!here && !boughtNow) continue;
    const later = schedule.filter((s) => s.ym > ym);
    if (!later.length) continue;
    const n = here ? here.n : 0;
    list.push(entry({
      key: `purchase:${p.id}`, itemKey: here ? `invoice:${card.id}:${ym}` : null, kind: 'card', cardId: card.id,
      label: `${p.description}${p.count > 1 ? ` (${n ? `${n}/` : ''}${p.count}×)` : ''} · ${card.name}`,
      months: later.map((s) => ({ ym: s.ym, cents: s.cents })),
    }));
  }

  // Recorrentes que começaram no mês: viram um compromisso novo todo mês
  for (const r of state.recurring || []) {
    if (r.startYM !== ym) continue;
    const months = [];
    for (let i = 1; i <= WEIGHT_HORIZON; i++) {
      const next = addMonthsYM(ym, i);
      const n = recurringDates(r, next).length;
      if (n) months.push({ ym: next, cents: r.cents * n });
    }
    if (!months.length) continue;
    const first = recurringDates(r, ym)[0];
    // mesma chave de monthItems(); cobrada no cartão, o selo vai na fatura
    const card = r.cardId ? (state.cards || []).find((c) => c.id === r.cardId) : null;
    // no cartão, a cobrança entra na fatura que fecha depois dela (pode ser a do mês seguinte)
    const firstKey = !first ? null : card ? `invoice:${card.id}:${invoiceMonthFor(card, first)}` : `recurring:${r.id}:${FREQ_DAYS[r.freq] ? first : ym}`;
    list.push(entry({
      key: `recurring:${r.id}`, itemKey: firstKey, kind: 'recurring', label: r.description,
      months, endless: !r.endYM || r.endYM > months[months.length - 1].ym,
    }));
  }

  // Dívidas com pagamento mensal (as ligadas a um parcelamento já contam acima)
  for (const d of state.debts || []) {
    if (d.installmentId || !(d.paymentCents > 0) || !(d.balanceCents > 0)) continue;
    if (ym < ymOf(today)) continue; // dívida não tem histórico por mês: só do mês atual em diante
    const sim = simulatePayoff([d]);
    const total = sim.months ?? WEIGHT_HORIZON;
    const months = [];
    for (let i = 1; i < Math.min(total, WEIGHT_HORIZON + 1); i++) months.push({ ym: addMonthsYM(ym, i), cents: d.paymentCents });
    if (!months.length) continue;
    list.push(entry({
      key: `debt:${d.id}`, itemKey: null, kind: 'debt', label: d.name, months,
      endless: sim.months == null, untilOverride: sim.months != null ? addMonthsYM(ym, sim.months - 1) : null,
    }));
  }

  list.sort((a, b) => b.total - a.total);
  const byMonth = {};
  for (const w of list) for (const m of w.months) if (m.ym <= addMonthsYM(ym, WEIGHT_HORIZON)) byMonth[m.ym] = (byMonth[m.ym] || 0) + m.cents;
  const ends = list.filter((w) => !w.endless).map((w) => w.until);
  return {
    list,
    count: list.length,
    until: ends.length ? ends.sort().pop() : null,
    endless: list.filter((w) => w.endless).length,
    byMonth,
    total: sumCents(list.filter((w) => !w.endless).map((w) => w.total)),
  };
}

function entry({ months, endless = false, untilOverride = null, ...rest }) {
  const total = sumCents(months.map((m) => m.cents));
  return {
    ...rest,
    months,
    endless,
    until: endless ? null : untilOverride || months[months.length - 1].ym,
    perMonth: months.length ? Math.round(total / months.length) : 0,
    total,
  };
}

const futureWeightMemo = memoByState(futureWeightRaw);
/** O resultado é compartilhado (cache): não altere os objetos devolvidos. */
export const futureWeight = (state, ym, today = todayISO()) => futureWeightMemo(state, ym, today);

/** "3 gastos deste mês ainda vão pesar até mar/27" (ou null se nada pesa). */
export function futureWeightSummary(weight) {
  if (!weight.count) return null;
  const finite = weight.count - weight.endless;
  const parts = [];
  if (finite) parts.push(`${plural(finite, 'gasto deste mês ainda vai pesar', 'gastos deste mês ainda vão pesar')}${weight.until ? ` até ${formatMonthShort(weight.until)}` : ''}`);
  if (weight.endless) parts.push(`${plural(weight.endless, 'compromisso novo', 'compromissos novos')} sem data para acabar`);
  return parts.join(' e ');
}

// ---------- Selos dos lançamentos ----------

/** "40% acima" até o dobro; daí em diante "3× a média" (mais fácil de ler). */
export function overText(pct, cents, avg) {
  if (pct < 100) return `${formatPercent(pct)} acima`;
  const times = cents / avg;
  return `${times.toLocaleString('pt-BR', { maximumFractionDigits: times < 10 ? 1 : 0 })}× a média`;
}

/** Valores dos últimos meses para comparar com um item (mesma recorrente, mesma categoria, mesmo cartão). */
function historyFor(state, item, ym, today) {
  const values = [];
  for (let i = 1; i <= HISTORY; i++) {
    const prev = monthItems(state, addMonthsYM(ym, -i), today);
    if (item.kind === 'recurring') {
      const same = prev.filter((x) => x.kind === 'recurring' && x.refId === item.refId && !x.estimated);
      if (same.length) values.push(sumCents(same.map((x) => x.cents)) / same.length);
    } else if (item.kind === 'invoice') {
      const same = prev.find((x) => x.kind === 'invoice' && x.refId === item.refId);
      if (same && same.cents > 0) values.push(same.cents);
    } else if (item.kind === 'expense' && item.categoryId) {
      for (const x of prev) if (x.kind === 'expense' && x.categoryId === item.categoryId) values.push(x.cents);
    }
  }
  return values;
}

/**
 * Selos de cada lançamento do mês.
 * → Map(item.key → [{ type: 'over'|'unusual'|'future', label, text, pct?, avg?, until? }])
 */
function itemFlagsRaw(state, ym, today = todayISO()) {
  const out = new Map();
  const add = (key, flag) => { if (!key) return; const list = out.get(key) || []; if (!list.some((f) => f.type === flag.type)) list.push(flag); out.set(key, list); };
  const m = computeMonth(state, ym, today);
  const { overspendPct } = alertsOf(state.settings);
  const big = bigThreshold(m.income.total, state.settings);

  for (const item of m.items) {
    if (item.kind === 'installment' || item.cents <= 0) continue;
    const values = historyFor(state, item, ym, today);
    if (values.length >= 3) {
      const avg = median(values);
      const pct = percent(item.cents - avg, avg);
      const minDiff = item.kind === 'recurring' ? 1000 : 5000;
      if (avg > 0 && pct >= overspendPct && item.cents - avg >= minDiff) {
        const how = overText(pct, item.cents, avg);
        add(item.key, {
          type: 'over', label: how, pct, avg: Math.round(avg),
          text: `${pct < 100 ? `${how} do normal` : `${how} dos últimos meses`}: ${formatBRL(item.cents)} agora, a média é ${formatBRL(Math.round(avg))}.`,
        });
      }
    }
    if (item.kind === 'expense') {
      const share = percent(item.cents, m.income.total);
      if (item.cents >= big) {
        add(item.key, {
          type: 'unusual', label: 'fora do comum', pct: share,
          text: m.income.total > 0 ? `Gasto grande: ${formatPercent(share)} dos ganhos do mês.` : 'Gasto grande e pontual.',
        });
      } else if (values.length === 0 && item.cents >= Math.max(5000, Math.round(big / 2))) {
        const recent = [1, 2, 3].some((i) => monthItems(state, addMonthsYM(ym, -i), today).some((x) => x.kind === 'expense' && x.categoryId && x.categoryId === item.categoryId));
        if (!recent) add(item.key, { type: 'unusual', label: 'fora do comum', text: 'Nada parecido nos últimos 3 meses.' });
      }
    }
  }

  for (const w of futureWeight(state, ym, today).list) {
    if (!w.itemKey) continue;
    const prev = out.get(w.itemKey)?.find((f) => f.type === 'future');
    const until = w.until && prev?.until && prev.until > w.until ? prev.until : w.until;
    const label = w.endless ? 'pesa todo mês' : `pesa até ${formatMonthShort(until)}`;
    const text = w.kind === 'card'
      ? 'Tem compras parceladas que continuam nas próximas faturas.'
      : w.endless ? `Compromisso novo: ${formatBRL(w.perMonth)} por mês daqui para a frente.`
        : `Ainda ${plural(w.months.length, 'mês', 'meses')} de ${formatBRL(w.perMonth)}${w.months.length > 1 ? ' (em média)' : ''}, até ${formatMonthShort(w.until)}.`;
    if (prev) out.set(w.itemKey, out.get(w.itemKey).filter((f) => f !== prev));
    add(w.itemKey, { type: 'future', label, text, until: w.endless ? null : until });
  }
  return out;
}
const itemFlagsMemo = memoByState(itemFlagsRaw);
/** Selos do mês (cache por estado): Map(key → flags). */
export const itemFlags = (state, ym, today = todayISO()) => itemFlagsMemo(state, ym, today);

/** Selos de UM item (usa o mês do vencimento). */
export const flagsOf = (state, item, today = todayISO()) => itemFlags(state, ymOf(item.dueDate), today).get(item.key) || [];

/**
 * Selos de uma compra no cartão (detalhe da fatura, busca).
 * → [{ type, label, text }]
 */
export function purchaseFlags(state, purchase, today = todayISO()) {
  const card = (state.cards || []).find((c) => c.id === purchase.cardId);
  if (!card || purchase.cents <= 0) return [];
  const out = [];
  const schedule = purchaseSchedule(card, purchase);
  const ym = ymOf(today);
  const later = schedule.filter((s) => s.ym > ym);
  if (later.length && schedule.length > 1) {
    const until = later[later.length - 1].ym;
    out.push({ type: 'future', label: `pesa até ${formatMonthShort(until)}`, text: `Mais ${plural(later.length, 'parcela')} de ${formatBRL(later[0].cents)} até ${formatMonthShort(until)}.`, until });
  }
  const month = computeMonth(state, schedule[0].ym, today);
  if (schedule[0].cents >= bigThreshold(month.income.total, state.settings)) {
    out.push({ type: 'unusual', label: 'fora do comum', text: `Compra grande: ${formatPercent(percent(schedule[0].cents, month.income.total))} dos ganhos do mês da fatura.` });
  }
  return out;
}
