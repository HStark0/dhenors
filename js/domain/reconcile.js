// @ts-check
// =============================================================
// reconcile.js — Conciliação do extrato com as contas lançadas
// -------------------------------------------------------------
// Ao importar o extrato, cada saída é comparada com as contas ainda
// NÃO pagas (avulsas, recorrentes, parcelas e faturas): mesmo valor
// (com tolerância de 2%, mín. R$ 1) e data até 7 dias de diferença,
// com bônus se a descrição parece a mesma. Achou → em vez de criar
// um gasto novo, a conta já lançada é marcada como PAGA na data do
// extrato. Cada conta só casa com uma transação.
//
// Funções puras (testadas em tests/features2.test.mjs).
// =============================================================

import { diffDays, ymOf, addMonthsYM } from '../core/dates.js';
import { computeMonth, overdueBefore } from './ledger.js';
import { cleanDescription } from './importer.js';

const tolerance = (cents) => Math.max(100, Math.round(cents * 0.02));

function similarity(a, b) {
  const wa = new Set(cleanDescription(a).split(' ').filter((w) => w.length >= 3));
  const wb = new Set(cleanDescription(b).split(' ').filter((w) => w.length >= 3));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

/** Contas em aberto perto das datas das transações. */
function openItems(state, rows, today) {
  const months = new Set();
  for (const r of rows) { months.add(ymOf(r.date)); months.add(addMonthsYM(ymOf(r.date), -1)); months.add(addMonthsYM(ymOf(r.date), 1)); }
  const seen = new Set();
  const out = [];
  for (const ym of months) {
    for (const i of [...computeMonth(state, ym, today).items, ...overdueBefore(state, ym, today)]) {
      if (i.status === 'paid' || seen.has(i.key) || state.closedMonths[ymOf(i.dueDate)]) continue;
      seen.add(i.key);
      out.push(i);
    }
  }
  return out;
}

/**
 * → rows com `match` ({ key, kind, refId, description, dueDate, cents, item, score }) quando achou.
 * Só saídas (cents > 0) são conciliadas.
 */
export function reconcile(state, rows, today) {
  const candidates = openItems(state, rows, today);
  const pairs = [];
  rows.forEach((r, ri) => {
    if (!(r.cents > 0)) return;
    for (const item of candidates) {
      const diffValue = Math.abs(item.cents - r.cents);
      const days = Math.abs(diffDays(item.dueDate, r.date));
      if (diffValue > tolerance(item.cents) || days > 7) continue;
      const score = 1 - diffValue / (tolerance(item.cents) + 1) * 0.4 - days / 7 * 0.3 + similarity(item.description, r.description) * 0.6;
      pairs.push({ ri, item, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const usedRows = new Set();
  const usedItems = new Set();
  const out = rows.map((r) => ({ ...r, match: null }));
  for (const p of pairs) {
    if (usedRows.has(p.ri) || usedItems.has(p.item.key)) continue;
    usedRows.add(p.ri);
    usedItems.add(p.item.key);
    out[p.ri].match = { key: p.item.key, kind: p.item.kind, refId: p.item.refId, description: p.item.description, dueDate: p.item.dueDate, cents: p.item.cents, item: p.item, score: Math.round(p.score * 100) / 100 };
  }
  return out;
}
