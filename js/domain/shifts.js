// @ts-check
// =============================================================
// shifts.js — Escala de plantões
// -------------------------------------------------------------
// Você cadastra os TIPOS de plantão (12h, 24h, noturno, fim de
// semana…) com o valor de cada um e marca os plantões no
// calendário. O app gera sozinho as rendas extras do mês:
//  • tipo "na folha": valor BRUTO, soma ao salário e paga INSS/IR;
//  • tipo "fora da folha": valor já líquido (ex.: outro hospital).
// O plantão entra na competência do mês em que foi feito; se o
// salário cai no mês seguinte, ele é pago junto (ver ledger.incomeFor).
//
// Funções puras (testadas em tests/features2.test.mjs).
// =============================================================

import { sumCents } from '../core/money.js';
import { ymOf } from '../core/dates.js';
import { weekday, holidayName } from '../core/calendar.js';

export const shiftTypeOf = (state, id) => (state.settings.shiftTypes || []).find((t) => t.id === id) || null;

/** Valor do plantão (o próprio, se informado, ou o do tipo). */
export const shiftValue = (state, s) => s.cents ?? shiftTypeOf(state, s.typeId)?.cents ?? 0;

/** Plantões do mês, em ordem de data. */
export function shiftsIn(state, ym) {
  return (state.shifts || []).filter((s) => ymOf(s.date) === ym).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Rendas geradas pelos plantões do mês (uma linha por tipo).
 * → [{ id, ym, description, cents, date, payroll, kind: 'plantao', auto: true, count, hours }]
 */
export function shiftIncomes(state, ym) {
  const groups = new Map();
  for (const s of shiftsIn(state, ym)) {
    const type = shiftTypeOf(state, s.typeId);
    if (!type) continue;
    const g = groups.get(type.id) || { type, list: [] };
    g.list.push(s);
    groups.set(type.id, g);
  }
  return [...groups.values()].map(({ type, list }) => ({
    id: `shift:${ym}:${type.id}`,
    ym,
    description: `${type.name} (${list.length}×)`,
    cents: sumCents(list.map((s) => shiftValue(state, s))),
    date: list[list.length - 1].date,
    payroll: type.payroll !== false,
    kind: 'plantao',
    auto: true,
    count: list.length,
    hours: list.length * (type.hours || 0),
  })).filter((x) => x.cents > 0);
}

/** Resumo do mês: quantidade, horas, valor e quantos em fim de semana/feriado. */
export function shiftSummary(state, ym) {
  const list = shiftsIn(state, ym);
  const types = list.map((s) => shiftTypeOf(state, s.typeId)).filter(Boolean);
  return {
    count: list.length,
    hours: sumCents(types.map((t) => t.hours || 0)),
    cents: sumCents(list.map((s) => shiftValue(state, s))),
    weekendOrHoliday: list.filter((s) => [0, 6].includes(weekday(s.date)) || holidayName(s.date)).length,
    night: types.filter((t) => t.night).length,
  };
}
