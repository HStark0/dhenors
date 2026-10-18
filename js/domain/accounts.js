// @ts-check
// =============================================================
// accounts.js — Contas e carteiras (Nubank, conta-salário, dinheiro…)
// -------------------------------------------------------------
// Cada conta tem um SALDO DE PARTIDA (anchor: valor numa data, como
// aparece no app do banco). Daí em diante o saldo é calculado:
//   + receitas lançadas nessa conta (rendas extras, reembolsos…)
//   + salário, se esta for a conta onde ele cai (settings.salaryAccountId)
//   − contas pagas com ela (avulsas, recorrentes) e faturas de cartão
//     cujo cartão é debitado nela
//   ± transferências entre contas
// "Saldo real × previsto": você informa o saldo do banco
// (balanceChecks) e o app mostra a diferença para o calculado.
//
// Funções puras (testadas em tests/accounts.test.mjs).
// =============================================================

import { sumCents } from '../core/money.js';
import { todayISO, ymOf, addMonthsYM, monthsBetween } from '../core/dates.js';
import { invoice } from './cards.js';
import { recurringIncomeBetween } from './recurringIncome.js';

export const ACCOUNT_KIND_LABELS = {
  corrente: 'Conta corrente', salario: 'Conta-salário', poupanca: 'Poupança', digital: 'Conta digital',
  carteira: 'Dinheiro (carteira)', investimento: 'Corretora', outro: 'Outra',
};
export const ACCOUNT_KIND_ICONS = {
  corrente: 'landmark', salario: 'banknote', poupanca: 'piggy-bank', digital: 'smartphone', carteira: 'wallet', investimento: 'trending-up', outro: 'circle-dollar-sign',
};

const inRange = (date, from, to) => (!from || date > from) && date <= to;

/**
 * Movimentos de uma conta entre o saldo de partida e `date`.
 * → [{ date, cents (+ entra / − sai), label, kind }]
 * `salaryFn(ym)` devolve o que cai na conta-salário no mês: { date, cents, label }
 * ou uma lista delas (salário, 13º, férias, benefícios — planning.employerIncomeFn).
 */
export function accountMovements(state, account, date = todayISO(), { salaryFn = null } = {}) {
  const from = account.anchor?.date || null;
  const out = [];
  const add = (d, cents, label, kind) => { if (d && cents && inRange(d, from, date)) out.push({ date: d, cents, label, kind }); };

  for (const x of state.extraIncomes || []) if (x.accountId === account.id && !x.payroll) add(x.date || `${x.ym}-01`, x.cents, x.description, 'income');
  for (const r of state.recurringIncomes || []) {
    if (r.accountId !== account.id) continue;
    for (const x of recurringIncomeBetween(r, from ? ymOf(from) : r.startYM, ymOf(date))) add(x.date, x.cents, x.description, 'income');
  }
  for (const e of state.expenses || []) if (e.accountId === account.id && e.paidAt) add(e.paidAt, -e.cents, e.description, 'expense');
  for (const r of state.recurring || []) {
    if (r.accountId !== account.id || r.cardId) continue;
    for (const [k, entry] of Object.entries(state.recurringEntries || {})) {
      if (!k.startsWith(`${r.id}|`) || !entry.paidAt) continue;
      add(entry.paidAt, -(entry.cents ?? r.cents), r.description, 'recurring');
    }
  }
  for (const card of state.cards || []) {
    if (card.accountId !== account.id) continue;
    for (const [k, pay] of Object.entries(state.cardInvoices || {})) {
      if (!k.startsWith(`${card.id}|`) || !pay.paidAt) continue;
      const inv = invoice(state, card, k.split('|')[1], date);
      add(pay.paidAt, -(pay.cents ?? inv.total), `Fatura ${card.name}`, 'invoice');
    }
  }
  for (const t of state.transfers || []) {
    if (t.fromId === account.id) add(t.date, -t.cents, `Transferência${t.note ? `: ${t.note}` : ''}`, 'transfer');
    if (t.toId === account.id) add(t.date, t.cents, `Transferência${t.note ? `: ${t.note}` : ''}`, 'transfer');
  }
  if (salaryFn && state.settings.salaryAccountId === account.id) {
    const startYM = from ? ymOf(from) : ymOf(date);
    for (let i = 0; i <= Math.max(0, monthsBetween(startYM, ymOf(date))); i++) {
      const got = salaryFn(addMonthsYM(startYM, i));
      for (const s of Array.isArray(got) ? got : got ? [got] : []) add(s.date, s.cents, s.label || 'Salário', 'salary');
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Saldo calculado da conta em `date`. */
export function accountBalance(state, account, date = todayISO(), opts = {}) {
  const movs = accountMovements(state, account, date, opts);
  return (account.anchor?.cents || 0) + sumCents(movs.map((m) => m.cents));
}

/** Todas as contas com saldo e a última conferência com o banco. */
export function accountsSummary(state, today = todayISO(), opts = {}) {
  const list = (state.accounts || []).filter((a) => !a.archived).map((a) => {
    const balance = accountBalance(state, a, today, opts);
    const check = [...(state.balanceChecks || [])].filter((b) => b.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))[0] || null;
    const expectedAtCheck = check ? accountBalance(state, a, check.date, opts) : null;
    return { account: a, balance, check, diff: check ? check.cents - expectedAtCheck : null };
  });
  return { list, total: sumCents(list.map((x) => x.balance)) };
}

