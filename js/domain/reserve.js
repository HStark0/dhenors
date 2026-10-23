// @ts-check
// =============================================================
// reserve.js — Quanto guardar por mês na reserva de emergência
//              (10/20/30% dos ganhos FIXOS) × quanto foi guardado
// -------------------------------------------------------------
// "Guardado no mês" conta SÓ o que está marcado como reserva (como
// emergencyCoverage em planning.js): aportes − resgates no mês dos
// investimentos de reserva (ou ligados a uma meta de reserva) e
// depósitos no mês nas metas de reserva.
//   status: 'within' (atingiu o percentual) · 'average' (de 80% a
//           100% do valor) · 'below' (menos de 80%) · 'none' (sem
//           ganhos fixos para comparar).
// =============================================================

import { sumCents, percent, formatBRL } from '../core/money.js';
import { todayISO, ymOf } from '../core/dates.js';
import { computeMonth } from './ledger.js';
import { emergencyCoverage } from './planning.js';
import { fixedIncome } from './parcelLimit.js';

export const RESERVE_OPTIONS = [10, 20, 30];
export const DEFAULT_RESERVE = 10;
/** A partir de quanto do valor o status vira "na média". */
export const RESERVE_AVERAGE_FROM = 0.8;
/** Meses de gastos que a reserva deveria cobrir. */
const IDEAL_MONTHS = 6;

/** Percentual válido salvo nos ajustes (10, 20 ou 30; padrão 10). */
export const reservePct = (settings) => (RESERVE_OPTIONS.includes(settings?.reservePct) ? settings.reservePct : DEFAULT_RESERVE);

const OUT = new Set(['resgate', 'venda']);

/** Quanto entrou (líquido) na reserva de emergência no mês `ym`. */
export function reserveSavedIn(state, ym) {
  const goals = (state.goals || []).filter((g) => g.emergency);
  const linkedIds = new Set(goals.flatMap((g) => g.investmentIds || []));
  const invs = (state.investments || []).filter((i) => i.emergency || linkedIds.has(i.id));
  const invNet = sumCents(invs.flatMap((i) => i.movements || [])
    .filter((m) => ymOf(m.date) === ym && (m.kind === 'aporte' || OUT.has(m.kind)))
    .map((m) => (m.kind === 'aporte' ? m.cents : -m.cents)));
  const goalNet = sumCents(goals.flatMap((g) => g.contributions || []).filter((c) => ymOf(c.date) === ym).map((c) => c.cents));
  // Meta de reserva sem investimento ligado + investimento de reserva solto:
  // provavelmente o mesmo dinheiro (vale o maior, como em emergencyCoverage)
  const looseGoal = goals.some((g) => !(g.investmentIds || []).length && (g.contributions || []).length);
  const looseInv = (state.investments || []).some((i) => i.emergency && !linkedIds.has(i.id));
  return looseGoal && looseInv ? Math.max(invNet, goalNet) : invNet + goalNet;
}

/**
 * → { pct, fixedIncome, targetCents, saved, missing, usage, status, hasReserve,
 *     total, months, monthly, tips: [{ id, tone, text, route? }] }
 *   saved   = guardado na reserva no mês
 *   missing = quanto falta para o percentual (0 quando atingiu)
 *   total   = reserva acumulada · months = quantos meses de gastos ela cobre
 */
export function reserveStatus(state, ym, pct = reservePct(state.settings), today = todayISO()) {
  const base = fixedIncome(state, ym, today).fixed.total;
  const targetCents = Math.round((base * pct) / 100);
  const saved = reserveSavedIn(state, ym);
  const cov = emergencyCoverage(state, ym, today);
  const usage = targetCents > 0 ? saved / targetCents : 0;
  const status = base <= 0 ? 'none' : usage >= 1 ? 'within' : usage >= RESERVE_AVERAGE_FROM ? 'average' : 'below';
  const out = {
    pct, fixedIncome: base, targetCents, saved, missing: Math.max(0, targetCents - saved),
    savedPct: percent(Math.max(0, saved), base), usage, status, hasReserve: cov.hasGoal,
    total: cov.saved, months: cov.months, monthly: cov.monthly, tips: [],
  };
  out.tips = reserveTips(state, ym, out, today);
  return out;
}

function reserveTips(state, ym, r, today) {
  const tips = [];
  if (r.status === 'none') {
    tips.push({ id: 'no-fixed', tone: 'info', text: 'Cadastre seu salário (ou um ganho "todo mês") para calcular quanto guardar.' });
    return tips;
  }
  if (r.total <= 0 && r.saved <= 0) {
    tips.push({ id: 'start', tone: 'info', text: 'Sua Reserva de emergência está zerada. Toque em "Guardar" nela sempre que separar dinheiro (ou ligue o investimento onde ele está).', route: '#/reservas' });
  }
  if (r.missing > 0) {
    const balance = computeMonth(state, ym, today).balance;
    tips.push({ id: 'missing', tone: r.status === 'average' ? 'warn' : 'bad', text: balance >= r.missing
      ? `Guarde mais ${formatBRL(r.missing)} neste mês para chegar aos ${r.pct}%: o saldo do mês (${formatBRL(balance)}) cobre.`
      : `Faltam ${formatBRL(r.missing)} para os ${r.pct}%.${balance > 0 ? ` O saldo do mês (${formatBRL(balance)}) não cobre tudo: comece com ele.` : ''}` });
  } else if (r.saved > r.targetCents && r.pct < 30) {
    tips.push({ id: 'more', tone: 'good', text: `Você guardou ${formatBRL(r.saved)}, acima dos ${r.pct}%. Dá para subir a meta.` });
  }
  if (r.monthly > 0 && r.months < IDEAL_MONTHS && r.targetCents > 0) {
    const gap = Math.round(r.monthly * IDEAL_MONTHS) - r.total;
    const n = Math.ceil(gap / r.targetCents);
    tips.push({ id: 'ideal', tone: 'info', text: `A reserva cobre ${r.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${r.months >= 1 && r.months < 2 ? 'mês' : 'meses'} de gastos; o ideal é ${IDEAL_MONTHS}. Guardando ${formatBRL(r.targetCents)} por mês, chega lá em ${n} ${n === 1 ? 'mês' : 'meses'}.` });
  } else if (r.months >= IDEAL_MONTHS) {
    tips.push({ id: 'full', tone: 'good', text: `A reserva já cobre ${Math.floor(r.months)} meses de gastos: o que passar disso pode ir para outros objetivos.` });
  }
  return tips.slice(0, 3);
}
