// @ts-check
// =============================================================
// calendar.js — Feriados nacionais e dias úteis
// -------------------------------------------------------------
// Usado para o pagamento no "5º dia útil".
//
// Regra da CLT (art. 459, §1º) e do Ministério do Trabalho
// (IN SIT 1/1989): para o pagamento de salário, SÁBADO CONTA como
// dia útil; domingos e feriados, não. Há uma opção para não contar
// o sábado (algumas convenções/empresas usam só dias de semana).
//
// Feriados considerados: nacionais fixos + Sexta-feira Santa.
// Feriados estaduais/municipais variam e não entram.
// =============================================================

import { toISO, parseISO, addDaysISO, daysInMonth, parseYM } from './dates.js';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(year, month, day);
}

const cache = new Map();

/** Feriados nacionais do ano: Map "AAAA-MM-DD" → nome. */
export function nationalHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const map = new Map([
    [toISO(year, 1, 1), 'Confraternização Universal'],
    [addDaysISO(easter(year), -2), 'Sexta-feira Santa'],
    [toISO(year, 4, 21), 'Tiradentes'],
    [toISO(year, 5, 1), 'Dia do Trabalho'],
    [toISO(year, 9, 7), 'Independência'],
    [toISO(year, 10, 12), 'Nossa Senhora Aparecida'],
    [toISO(year, 11, 2), 'Finados'],
    [toISO(year, 11, 15), 'Proclamação da República'],
    [toISO(year, 12, 25), 'Natal'],
  ]);
  if (year >= 2024) map.set(toISO(year, 11, 20), 'Dia Nacional de Zumbi e da Consciência Negra');
  cache.set(year, map);
  return map;
}

export const holidayName = (iso) => nationalHolidays(Number(iso.slice(0, 4))).get(iso) || null;

/** 0 = domingo … 6 = sábado */
export function weekday(iso) {
  const p = parseISO(iso);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

export function isBusinessDay(iso, { saturdayCounts = true } = {}) {
  const wd = weekday(iso);
  if (wd === 0) return false;
  if (wd === 6 && !saturdayCounts) return false;
  return !holidayName(iso);
}

/** N-ésimo dia útil do mês. nthBusinessDay("2026-11", 5) */
export function nthBusinessDay(ym, n, opts = {}) {
  const { y, m } = parseYM(ym);
  let count = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const iso = toISO(y, m, d);
    if (isBusinessDay(iso, opts) && ++count === n) return iso;
  }
  return toISO(y, m, daysInMonth(y, m));
}

/**
 * Dias para o DSR (descanso semanal remunerado) do mês:
 *   rest     = domingos + feriados nacionais (que não caem no domingo)
 *   business = os demais dias (segunda a sábado, úteis para o DSR)
 * Fórmula usual: DSR = (horas extras do mês ÷ business) × rest
 */
export function dsrDaysIn(ym) {
  const { y, m } = parseYM(ym);
  const total = daysInMonth(y, m);
  let rest = 0;
  for (let d = 1; d <= total; d++) {
    const iso = toISO(y, m, d);
    if (weekday(iso) === 0 || holidayName(iso)) rest++;
  }
  return { rest, business: total - rest };
}
