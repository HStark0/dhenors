// @ts-check
// =============================================================
// parcelLimit.js — Limite das parcelas sobre os ganhos FIXOS e o
//                  fluxo do mês (o que entra, o que fica, o que sai)
// -------------------------------------------------------------
// Tudo vem de computeMonth() (ledger.js), como em outlook.js: o
// painel e as outras telas mostram os mesmos números.
//
// • fixedIncome(state, ym)   ganhos fixos × variáveis do mês.
//     fixos     = salário líquido (sem plantões/horas extras), outros
//                 vínculos e ganhos fora da folha lançados como "todo mês".
//     variáveis = plantões e extras na folha, extras avulsos, férias,
//                 PLR/abono e outros benefícios em dinheiro.
// • parcelLimit(state, ym, pct)  parcelas do mês (parcelamentos + compras
//                 parceladas no cartão) × pct% dos ganhos fixos.
//     status: 'within' (até 80% do limite) · 'average' (de 80% a 100%,
//             encostando no limite) · 'over' (passou do limite) · 'none'
//             (sem ganhos fixos para comparar).
// • monthFlow(state, ym)     o que sai (fixos, parcelas, avulsos, cartão).
// =============================================================

import { sumCents, percent, formatBRL, formatPercent } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import { computeMonth } from './ledger.js';
import { invoicesIn } from './cards.js';

export const PARCEL_LIMIT_OPTIONS = [10, 20, 30];
export const DEFAULT_PARCEL_LIMIT = 10;
/** A partir de quanto do limite o status vira "na média". */
export const AVERAGE_FROM = 0.8;

/** Percentual válido salvo nos ajustes (10, 20 ou 30; padrão 10). */
export const parcelLimitPct = (settings) => (PARCEL_LIMIT_OPTIONS.includes(settings?.parcelLimitPct) ? settings.parcelLimitPct : DEFAULT_PARCEL_LIMIT);

/**
 * → { total, fixed: { total, list: [{ label, cents }] }, variable: { total, list: [{ label, cents }] } }
 * fixed.total + variable.total = income.total (o mesmo "Ganhos do mês").
 */
export function fixedIncome(state, ym, today = todayISO()) {
  const inc = computeMonth(state, ym, today).income;
  const outside = inc.extras.filter((x) => !x.payroll);
  const recurringOut = outside.filter((x) => x.recurringIncomeId);
  const fixed = [
    { label: 'Salário líquido', cents: inc.salary },
    ...(inc.jobs?.list || []).map((j) => ({ label: j.job.name, cents: j.net })),
    ...recurringOut.map((x) => ({ label: x.description, cents: x.cents })),
  ].filter((x) => x.cents > 0);
  const variable = [
    ...(inc.payrollExtrasNet ? [{ label: 'Plantões e extras na folha', cents: inc.payrollExtrasNet }] : []),
    ...outside.filter((x) => !x.recurringIncomeId).map((x) => ({ label: x.description, cents: x.cents })),
    ...(inc.vacationNet ? [{ label: 'Férias', cents: inc.vacationNet }] : []),
    ...(inc.benefits?.cash || []).map((b) => ({ label: b.name, cents: b.net })),
  ].filter((x) => x.cents > 0);
  const fixedTotal = sumCents(fixed.map((x) => x.cents));
  return {
    total: inc.total,
    fixed: { total: fixedTotal, list: fixed },
    // o restante (inclui ajustes, ex.: líquido conferido no holerite) fica nos variáveis
    variable: { total: inc.total - fixedTotal, list: variable },
  };
}

/** Parcelas que vencem no mês: parcelamentos e compras parceladas no cartão (na fatura do mês). */
function parcelsOf(state, m, ym, today) {
  const own = m.items.filter((i) => i.kind === 'installment').map((i) => ({
    label: i.description, cents: i.cents, n: i.parcel?.n || 1, count: i.parcel?.count || 1, card: null,
  }));
  const onCard = invoicesIn(state, ym, today).flatMap((inv) => inv.lines
    .filter((l) => l.count > 1)
    .map((l) => ({ label: l.purchase.description, cents: l.cents, n: l.n, count: l.count, card: inv.card.name })));
  return [...own, ...onCard].sort((a, b) => b.cents - a.cents);
}

/**
 * → { pct, fixedIncome, limitCents, parcels: [{ label, cents, n, count, card }], total,
 *     usedPct,     // parcelas ÷ ganhos fixos (em %)
 *     usage,       // parcelas ÷ limite (1 = no limite)
 *     room,        // quanto ainda cabe (negativo = quanto passou)
 *     status: 'within'|'average'|'over'|'none', tips: [{ id, tone, text }] }
 */
export function parcelLimit(state, ym, pct = parcelLimitPct(state.settings), today = todayISO()) {
  const m = computeMonth(state, ym, today);
  const inc = fixedIncome(state, ym, today);
  const base = inc.fixed.total;
  const parcels = parcelsOf(state, m, ym, today);
  const total = sumCents(parcels.map((p) => p.cents));
  const limitCents = Math.round((base * pct) / 100);
  const usage = limitCents > 0 ? total / limitCents : total > 0 ? Infinity : 0;
  const status = base <= 0 ? 'none' : usage > 1 ? 'over' : usage >= AVERAGE_FROM ? 'average' : 'within';
  const out = {
    pct, fixedIncome: base, limitCents, parcels, total,
    usedPct: percent(total, base), usage, room: limitCents - total, status, tips: [],
  };
  out.tips = parcelTips(out, inc);
  return out;
}

/** Recomendações automáticas (curtas, com o valor em reais). */
function parcelTips(r, inc) {
  const tips = [];
  if (r.status === 'none') {
    tips.push({ id: 'no-fixed', tone: 'info', text: 'Cadastre seu salário (ou um ganho "todo mês") para comparar as parcelas com a renda fixa.' });
    return tips;
  }
  const cut = (limit) => r.total - Math.round((r.fixedIncome * limit) / 100);
  if (r.status === 'over') {
    const c = cut(r.pct);
    tips.push({ id: 'cut', tone: 'bad', text: `Reduza ${formatBRL(c)} (${formatPercent(percent(c, r.total))}) nas parcelas para voltar à meta de ${r.pct}%.` });
  }
  // A meta mais baixa (10% é a recomendada): quanto falta para chegar lá
  const lower = PARCEL_LIMIT_OPTIONS.filter((p) => p < r.pct && cut(p) > 0)[0];
  if (lower) {
    const c = cut(lower);
    tips.push({ id: `to-${lower}`, tone: 'info', text: `Reduzir ${formatPercent(percent(c, r.total))} nas parcelas (${formatBRL(c)}) leva você à meta de ${lower}%.` });
  }
  // Parcela que termina logo: alívio já garantido
  const ending = r.parcels.filter((p) => p.count > 1 && p.count - p.n <= 2).sort((a, b) => b.cents - a.cents)[0];
  if (ending) {
    const left = ending.count - ending.n;
    tips.push({ id: 'ending', tone: 'good', text: `${ending.label} ${left === 0 ? 'termina neste mês' : `termina em ${left} ${left === 1 ? 'mês' : 'meses'}`}: libera ${formatBRL(ending.cents)} por mês.` });
  }
  if (r.status !== 'over' && r.room > 0) {
    tips.push({ id: 'room', tone: r.status === 'average' ? 'warn' : 'good', text: r.status === 'average'
      ? `Só cabem mais ${formatBRL(r.room)} em parcelas. Evite novos parcelamentos neste mês.`
      : `Cabem mais ${formatBRL(r.room)} em parcelas. Se não usar, guarde esse valor: vira reserva.` });
  }
  if (inc.total > 0 && inc.variable.total > 0 && percent(inc.variable.total, inc.total) >= 25) {
    tips.push({ id: 'variable', tone: 'info', text: `${formatPercent(percent(inc.variable.total, inc.total))} dos ganhos do mês são variáveis: não conte com eles para assumir parcelas.` });
  }
  return tips.slice(0, 3);
}

/**
 * O que sai no mês, por tipo. A soma é o "Gasto no mês" (totals.all).
 * → { total, fixed, parcels, single, cardOther, list: [{ key, label, cents }] }
 */
export function monthOutflow(state, ym, today = todayISO()) {
  const m = computeMonth(state, ym, today);
  const t = m.totals;
  const cardParcels = Math.min(t.invoice, sumCents(invoicesIn(state, ym, today).flatMap((inv) => inv.lines.filter((l) => l.count > 1).map((l) => l.cents))));
  const parcels = t.installment + cardParcels;
  const cardOther = t.invoice - cardParcels;
  return {
    total: t.all, fixed: t.recurring, parcels, single: t.expense, cardOther,
    list: [
      { key: 'fixed', label: 'Compromissos fixos', cents: t.recurring },
      { key: 'parcels', label: 'Parcelas', cents: parcels },
      { key: 'single', label: 'Despesas avulsas', cents: t.expense },
      { key: 'card', label: 'Cartão (à vista e assinaturas)', cents: cardOther },
    ],
  };
}
