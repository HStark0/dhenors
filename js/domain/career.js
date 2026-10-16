// =============================================================
// career.js — Linha do tempo da carreira
// -------------------------------------------------------------
// Cada mudança no salário (perfil salarial com data "a partir de")
// vira um ponto: bruto, líquido fixo, variação contra o anterior e
// o ganho REAL, descontando a inflação (IPCA do período, baixado do
// Banco Central em Investimentos → Atualizar taxas). Sem o IPCA mês
// a mês, usa o IPCA de 12 meses como aproximação.
// =============================================================

import { computePayroll, employmentOf } from './payroll.js';
import { monthsBetween, addMonthsYM } from '../core/dates.js';

/** Inflação acumulada (fração) entre dois meses (exclusive o primeiro). */
export function inflationBetween(indices, fromYM, toYM) {
  const monthly = indices?.ipcaMonthly || {};
  let acc = 1;
  let missing = 0;
  const n = monthsBetween(fromYM, toYM);
  for (let i = 1; i <= n; i++) {
    const v = monthly[addMonthsYM(fromYM, i)];
    if (v == null) missing++;
    else acc *= 1 + v / 10000;
  }
  if (missing) acc *= (1 + (indices?.ipca12Bp ?? 450) / 10000) ** (missing / 12);
  return { rate: acc - 1, estimated: missing > 0 };
}

/**
 * → [{ from, gross, net, note, change, realChange, inflation, estimated }]
 */
export function careerTimeline(settings) {
  const emp = employmentOf(settings);
  const list = [...settings.salaryHistory].sort((a, b) => a.from.localeCompare(b.from));
  return list.map((h, i) => {
    const p = computePayroll(h, h.from, { employment: emp });
    const prev = i ? list[i - 1] : null;
    const prevGross = prev ? computePayroll(prev, prev.from, { employment: emp }).gross : null;
    const change = prevGross ? (p.gross - prevGross) / prevGross : null;
    const infl = prev ? inflationBetween(settings.indices, prev.from, h.from) : null;
    return {
      from: h.from, gross: h.legacyNet ? h.grossCents : p.gross, net: h.legacyNet ? h.grossCents : p.net, legacy: Boolean(h.legacyNet), note: h.note || '',
      change, inflation: infl?.rate ?? null, estimated: infl?.estimated ?? false,
      realChange: change != null && infl ? (1 + change) / (1 + infl.rate) - 1 : null,
    };
  });
}

/** Do primeiro registro até hoje: ganho nominal e real. */
export function careerSummary(settings, todayYM) {
  const t = careerTimeline(settings);
  if (t.length < 1) return null;
  const first = t[0];
  const last = t[t.length - 1];
  const infl = inflationBetween(settings.indices, first.from, todayYM);
  const nominal = first.gross ? (last.gross - first.gross) / first.gross : 0;
  return { first, last, nominal, inflation: infl.rate, real: (1 + nominal) / (1 + infl.rate) - 1, estimated: infl.estimated, months: monthsBetween(first.from, todayYM) };
}
