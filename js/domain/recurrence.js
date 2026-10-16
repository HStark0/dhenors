// =============================================================
// recurrence.js — Quando uma recorrente vence (ritmo e datas)
// -------------------------------------------------------------
// Separado de ledger.js para que cards.js (faturas) também use as
// mesmas regras sem import circular. ledger.js re-exporta tudo.
// =============================================================

import { dateInMonth, diffDays, monthsBetween, ymOf, addDaysISO } from '../core/dates.js';

/** Chave do pagamento: por mês ("id|AAAA-MM") ou, nas semanais/quinzenais, por dia ("id|AAAA-MM-DD"). */
export const entryKey = (recurringId, ymOrDate) => `${recurringId}|${ymOrDate}`;

/** Intervalo em meses de cada ritmo (semanal e quinzenal são por dias). */
export const FREQ_MONTHS = { monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12 };
export const FREQ_DAYS = { weekly: 7, biweekly: 14 };
export const FREQ_LABELS = {
  monthly: 'Mensal', weekly: 'Semanal', biweekly: 'Quinzenal', bimonthly: 'Bimestral',
  quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
};

/** A recorrente vale no mês? (entre o início e o fim, se houver). */
export function recurringActiveIn(rec, ym) {
  return rec.startYM <= ym && (!rec.endYM || ym <= rec.endYM);
}

/**
 * Datas em que a recorrente vence no mês (vazio se não vence).
 * Mensal: 1 data. Bimestral/trimestral/…: só nos meses do ciclo,
 * contados a partir do início. Semanal/quinzenal: todas as datas do mês.
 */
export function recurringDates(rec, ym) {
  if (!recurringActiveIn(rec, ym)) return [];
  const freq = rec.freq || 'monthly';
  if (FREQ_DAYS[freq]) {
    const step = FREQ_DAYS[freq];
    const anchor = rec.anchorDate || dateInMonth(rec.startYM, rec.dueDay);
    const first = `${ym}-01`;
    let k = Math.max(0, Math.ceil(diffDays(anchor, first) / step));
    const out = [];
    for (let d = addDaysISO(anchor, k * step); ymOf(d) === ym || d < first; d = addDaysISO(anchor, ++k * step)) {
      if (ymOf(d) === ym && d >= anchor) out.push(d);
      if (k > 400) break;
    }
    return out;
  }
  const step = FREQ_MONTHS[freq] || 1;
  return monthsBetween(rec.startYM, ym) % step === 0 ? [dateInMonth(ym, rec.dueDay)] : [];
}
