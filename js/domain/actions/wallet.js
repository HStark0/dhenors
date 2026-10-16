// =============================================================
// actions/wallet.js — Cartões de crédito, compras no cartão,
// contas/carteiras, transferências e conferência de saldo
// =============================================================

import { store } from '../../core/store.js';
import { ymOf, todayISO } from '../../core/dates.js';
import { newId } from '../schema.js';
import { invoiceMonthFor, invoiceKey } from '../cards.js';
import { ValidationError, text, cents, date, intRange, refs, splits, assertOpen, findOrThrow } from './core.js';

// ---------- Cartões ----------

export function saveCard(input) {
  return store.commit((d) => {
    const item = {
      name: text(input.name, 'name', 'o nome do cartão', { max: 60 }),
      closingDay: intRange(input.closingDay, 'closingDay', 1, 31, 'O dia de fechamento'),
      dueDay: intRange(input.dueDay, 'dueDay', 1, 31, 'O dia de vencimento'),
      limitCents: cents(input.limitCents ?? 0, 'limitCents', { allowZero: true }),
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#7C3AED',
      accountId: (d.accounts || []).some((a) => a.id === input.accountId) ? input.accountId : null,
      archived: Boolean(input.archived),
    };
    if (item.closingDay === item.dueDay) throw new ValidationError('O vencimento precisa ser em dia diferente do fechamento.', 'dueDay');
    if (input.id) { Object.assign(findOrThrow(d.cards, input.id, 'Cartão'), item); return null; }
    const created = { id: newId(), ...item };
    d.cards.push(created);
    return created;
  });
}

/** Apaga o cartão com todas as compras e faturas dele. */
export function deleteCard(id) {
  return store.commit((d) => {
    findOrThrow(d.cards, id, 'Cartão');
    d.cards = d.cards.filter((c) => c.id !== id);
    d.cardPurchases = d.cardPurchases.filter((p) => p.cardId !== id);
    for (const k of Object.keys(d.cardInvoices || {})) if (k.startsWith(`${id}|`)) delete d.cardInvoices[k];
    for (const r of d.recurring) if (r.cardId === id) r.cardId = null;
  }, 'change', { undo: 'Cartão excluído' });
}

/**
 * Compra no cartão (à vista ou parcelada; valor negativo = estorno).
 * A fatura em que entra é calculada pelo dia de fechamento.
 */
export function saveCardPurchase(input) {
  return store.commit((d) => {
    const card = findOrThrow(d.cards, input.cardId, 'Cartão');
    const value = cents(input.cents, 'cents', { allowNegative: true });
    const item = {
      cardId: card.id,
      description: text(input.description, 'description', 'a descrição'),
      date: date(input.date, 'date'),
      cents: value,
      count: intRange(input.count ?? 1, 'count', 1, 48, 'O número de parcelas'),
      ...refs(d, input),
      splits: splits(d, input.splits, Math.abs(value)),
    };
    delete item.creditorId;
    const inv = invoiceMonthFor(card, item.date);
    if (d.cardInvoices?.[invoiceKey(card.id, inv)]?.paidAt && !input.id) {
      throw new ValidationError('A fatura em que esta compra entraria já foi paga. Desmarque o pagamento da fatura ou ajuste a data.', 'date');
    }
    if (input.id) { Object.assign(findOrThrow(d.cardPurchases, input.id, 'Compra'), item); return null; }
    const created = { id: newId(), ...item };
    d.cardPurchases.push(created);
    return { ...created, invoiceYM: inv };
  });
}

export function deleteCardPurchase(id) {
  return store.commit((d) => {
    findOrThrow(d.cardPurchases, id, 'Compra');
    d.cardPurchases = d.cardPurchases.filter((p) => p.id !== id);
  }, 'change', { undo: 'Compra excluída' });
}

/**
 * Importa compras de uma fatura (PDF/CSV) para o cartão.
 * rows: [{ date, description, cents, count, categoryId, fingerprint }]
 */
export function importCardPurchases(cardId, rows) {
  return store.commit((d) => {
    findOrThrow(d.cards, cardId, 'Cartão');
    const seen = new Set(d.importFingerprints || []);
    const out = { added: 0, skipped: 0 };
    for (const r of rows) {
      if (!r.date || !Number.isInteger(r.cents) || !r.cents || seen.has(r.fingerprint)) { out.skipped++; continue; }
      const cat = d.categories.find((c) => c.id === r.categoryId);
      d.cardPurchases.push({
        id: newId(), cardId, description: String(r.description || 'Compra').trim().slice(0, 120), date: r.date, cents: r.cents,
        count: Number.isInteger(r.count) && r.count >= 1 && r.count <= 48 ? r.count : 1,
        categoryId: cat?.id || null, subcategoryId: null, tags: [], notes: 'Importado da fatura', splits: [],
      });
      if (r.fingerprint) seen.add(r.fingerprint);
      out.added++;
    }
    d.importFingerprints = [...seen].slice(-5000);
    return out;
  });
}

// ---------- Contas e carteiras ----------

const KINDS = ['corrente', 'salario', 'poupanca', 'digital', 'carteira', 'investimento', 'outro'];

export function saveAccount(input) {
  return store.commit((d) => {
    const item = {
      name: text(input.name, 'name', 'o nome da conta', { max: 60 }),
      kind: KINDS.includes(input.kind) ? input.kind : 'corrente',
      institution: text(input.institution, 'institution', 'a instituição', { max: 60, required: false }),
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#0891B2',
      anchor: { cents: cents(input.anchorCents ?? 0, 'anchorCents', { allowZero: true, allowNegative: true }), date: date(input.anchorDate || todayISO(), 'anchorDate') },
      archived: Boolean(input.archived),
    };
    if (input.id) { Object.assign(findOrThrow(d.accounts, input.id, 'Conta'), item); return null; }
    const created = { id: newId(), ...item };
    d.accounts.push(created);
    if (input.salary) d.settings.salaryAccountId = created.id;
    return created;
  });
}

export function deleteAccount(id) {
  return store.commit((d) => {
    findOrThrow(d.accounts, id, 'Conta');
    d.accounts = d.accounts.filter((a) => a.id !== id);
    d.transfers = d.transfers.filter((t) => t.fromId !== id && t.toId !== id);
    d.balanceChecks = d.balanceChecks.filter((b) => b.accountId !== id);
    for (const list of [d.expenses, d.recurring, d.extraIncomes, d.cards]) for (const x of list) if (x.accountId === id) x.accountId = null;
    if (d.settings.salaryAccountId === id) d.settings.salaryAccountId = null;
  }, 'change', { undo: 'Conta excluída' });
}

export function saveTransfer(input) {
  return store.commit((d) => {
    const from = findOrThrow(d.accounts, input.fromId, 'Conta de origem');
    const to = findOrThrow(d.accounts, input.toId, 'Conta de destino');
    if (from.id === to.id) throw new ValidationError('Escolha contas diferentes.', 'toId');
    const item = { fromId: from.id, toId: to.id, cents: cents(input.cents, 'cents'), date: date(input.date, 'date'), note: text(input.note, 'note', 'a observação', { max: 120, required: false }) };
    if (input.id) { Object.assign(findOrThrow(d.transfers, input.id, 'Transferência'), item); return null; }
    d.transfers.push({ id: newId(), ...item });
    return null;
  });
}

export function deleteTransfer(id) {
  return store.commit((d) => { d.transfers = d.transfers.filter((t) => t.id !== id); }, 'change', { undo: 'Transferência excluída' });
}

/**
 * Saldo real informado (do app do banco). Com `adjust`, o saldo de
 * partida da conta passa a ser esse valor nessa data (zera a diferença).
 */
export function checkBalance(accountId, value, when = todayISO(), { adjust = false } = {}) {
  return store.commit((d) => {
    const acc = findOrThrow(d.accounts, accountId, 'Conta');
    const v = cents(value, 'cents', { allowZero: true, allowNegative: true });
    const day = date(when, 'date');
    d.balanceChecks.push({ id: newId(), accountId: acc.id, date: day, cents: v });
    d.balanceChecks = d.balanceChecks.slice(-500);
    if (adjust) acc.anchor = { cents: v, date: day };
  });
}

/** Ajuste avulso: assertOpen para impedir mexer em mês fechado por engano. */
export function assertMonthOpen(when) {
  assertOpen(store.data, ymOf(when), 'date');
}
