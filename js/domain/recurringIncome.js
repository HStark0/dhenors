// @ts-check
// =============================================================
// recurringIncome.js — Ganhos extras recorrentes (fora da folha)
// -------------------------------------------------------------
// Aluguel recebido, pensão, freela fixo, mesada… Não vêm do
// empregador: o valor já é LÍQUIDO e não passa por INSS/IR.
// Como a escala de plantões (shifts.js), cada recorrente gera
// sozinha uma renda extra por mês (auto: true), que entra em
// ledger.extrasOf() e daí em TODOS os cálculos (painel, agenda,
// fluxo diário, 12 meses, "Posso comprar?", contas bancárias…).
// Um mês pode ser pulado (skipped) sem encerrar a recorrente.
// =============================================================

import { dateInMonth, monthsBetween, addMonthsYM } from '../core/dates.js';

/** A recorrente vale no mês (entre início e fim, e não foi pulada)? */
export function recurringIncomeActiveIn(rec, ym) {
  return rec.startYM <= ym && (!rec.endYM || ym <= rec.endYM) && !(rec.skipped || []).includes(ym);
}

/** Entrada gerada por uma recorrente no mês. */
function entryOf(rec, ym) {
  return {
    id: `rinc:${rec.id}:${ym}`,
    ym,
    description: rec.description,
    cents: rec.cents,
    date: dateInMonth(ym, rec.day || 1),
    payroll: false,
    kind: rec.kind || 'extra',
    accountId: rec.accountId || null,
    auto: true,
    recurringIncomeId: rec.id,
  };
}

/** Rendas do mês geradas pelas recorrentes. */
export function recurringIncomeEntries(state, ym) {
  return (state.recurringIncomes || []).filter((r) => recurringIncomeActiveIn(r, ym)).map((r) => entryOf(r, ym));
}

/** Todas as entradas de uma recorrente entre dois meses (inclusive). */
export function recurringIncomeBetween(rec, fromYM, toYM) {
  const out = [];
  const start = rec.startYM > fromYM ? rec.startYM : fromYM;
  const n = monthsBetween(start, toYM);
  for (let i = 0; i <= n && i < 600; i++) {
    const ym = addMonthsYM(start, i);
    if (recurringIncomeActiveIn(rec, ym)) out.push(entryOf(rec, ym));
  }
  return out;
}
