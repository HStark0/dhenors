// @ts-check
// =============================================================
// monthStatus.js — A regra ÚNICA de "folgado / apertado / não fecha"
// -------------------------------------------------------------
// Painel (saldo do mês e faixa dos 12 meses), 12 meses, agenda,
// "Posso comprar?", prévia do editor de contas e lembretes usam esta
// mesma função, com os limites de Ajustes → Alertas e dicas.
//   não fecha (short) → sobra negativa: os gastos passam os ganhos
//   apertado  (tight) → sobra menor que `tightPct`% dos ganhos
//   folgado   (ok)    → sobra igual ou maior que isso
//   sem dados (none)  → nem ganhos nem gastos no mês
// =============================================================

import { DEFAULT_ALERTS } from './stateShape.js';

/** Limites dos alertas, com o padrão para o que faltar. */
export const alertsOf = (settings) => ({ ...DEFAULT_ALERTS, ...(settings?.alerts || {}) });

export const STATUS_LABELS = { ok: 'Folgado', tight: 'Apertado', short: 'Não fecha', none: 'Sem dados' };
/** Tom visual de cada situação (classes tone-*). */
export const STATUS_TONES = { ok: 'good', tight: 'warn', short: 'bad', none: 'info' };
/** Ícone de cada situação (a cor nunca é a única pista). */
export const STATUS_ICONS = { ok: 'circle-check', tight: 'triangle-alert', short: 'circle-alert', none: 'circle-help' };

/**
 * Situação de um mês a partir dos ganhos e da sobra.
 * @param {number} balance  ganhos − gastos (centavos)
 * @param {number} income   ganhos do mês (centavos)
 * @param {object} settings state.settings (para os limites)
 * @param {number} [spent]  gastos do mês (para reconhecer "sem dados")
 * @returns {'ok'|'tight'|'short'|'none'}
 */
export function monthStatus(balance, income, settings, spent = 1) {
  if (income <= 0 && spent <= 0) return 'none';
  if (balance < 0) return 'short';
  const { tightPct } = alertsOf(settings);
  if (balance < Math.round((Math.max(0, income) * tightPct) / 100)) return 'tight';
  return 'ok';
}

/**
 * A partir de quanto um gasto avulso é "grande": `bigPct`% dos ganhos
 * do mês (no mínimo R$ 100). Sem ganhos cadastrados: R$ 500.
 */
export function bigThreshold(income, settings) {
  if (income <= 0) return 50000;
  return Math.max(10000, Math.round((income * alertsOf(settings).bigPct) / 100));
}

/** Folga mínima em centavos (o quanto precisa sobrar para não ficar "apertado"). */
export const tightMargin = (income, settings) => Math.round((Math.max(0, income) * alertsOf(settings).tightPct) / 100);
