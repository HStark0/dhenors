// =============================================================
// actions/core.js — Validadores e utilidades das operações de escrita
// -------------------------------------------------------------
// As telas nunca alteram `store.data` diretamente: chamam uma
// função de domain/actions/*. Cada função valida a entrada e lança
// ValidationError (com o campo) quando algo está errado.
// =============================================================

import { MAX_CENTS } from '../../core/money.js';
import { isValidISO, isValidYM, formatMonth } from '../../core/dates.js';
import { entryKey } from '../ledger.js';

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.field = field;
  }
}

/** Texto limpo e validado. */
export function text(value, field, label, { max = 120, required = true } = {}) {
  const v = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (required && !v) throw new ValidationError(`Informe ${label}.`, field);
  if (v.length > max) throw new ValidationError(`${label[0].toUpperCase() + label.slice(1)} muito longo (máx. ${max}).`, field);
  return v;
}

/** Valor em centavos (inteiro positivo; com allowZero aceita 0; com allowNegative aceita estorno). */
export function cents(value, field, { allowZero = false, allowNegative = false } = {}) {
  if (!Number.isInteger(value) || (allowNegative ? value === 0 && !allowZero : allowZero ? value < 0 : value <= 0)) {
    throw new ValidationError(allowZero ? 'Valor inválido.' : 'Informe um valor maior que zero.', field);
  }
  if (Math.abs(value) > MAX_CENTS) throw new ValidationError('Valor alto demais.', field);
  return value;
}

export function date(value, field, { required = true } = {}) {
  if (!value && !required) return null;
  if (!isValidISO(value)) throw new ValidationError('Data inválida.', field);
  return value;
}

export function month(value, field, { required = true } = {}) {
  if (!value && !required) return null;
  if (!isValidYM(value)) throw new ValidationError('Mês inválido.', field);
  return value;
}

export function intRange(value, field, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label} deve ser entre ${min} e ${max}.`, field);
  }
  return n;
}

/** Etiquetas livres: "#viagem-natal, reforma" → ['viagem-natal', 'reforma'] */
export function tags(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 30)).filter(Boolean))].slice(0, 12);
}

/** Categoria, subcategoria, credor, observação e etiquetas (validados contra o estado). */
export function refs(data, input) {
  const cat = data.categories.find((c) => c.id === input.categoryId);
  const sub = cat?.subcategories.find((s) => s.id === input.subcategoryId);
  const cred = data.creditors.find((c) => c.id === input.creditorId);
  return {
    categoryId: cat ? cat.id : null,
    subcategoryId: sub ? sub.id : null,
    creditorId: cred ? cred.id : null,
    notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }),
    tags: tags(input.tags),
  };
}

/** Divisão de um gasto entre categorias: precisa somar o valor total. */
export function splits(data, list, total) {
  if (!Array.isArray(list) || list.length < 2) return [];
  const clean = list.filter((x) => Number.isInteger(x.cents) && x.cents > 0).map((x) => {
    const cat = data.categories.find((c) => c.id === x.categoryId);
    return { categoryId: cat?.id || null, subcategoryId: cat?.subcategories.some((s) => s.id === x.subcategoryId) ? x.subcategoryId : null, cents: x.cents };
  });
  if (clean.length < 2) return [];
  const sum = clean.reduce((a, x) => a + x.cents, 0);
  if (sum !== total) {
    const diff = (total - sum) / 100;
    throw new ValidationError(`A divisão soma ${(sum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}: ${diff > 0 ? 'faltam' : 'sobram'} ${Math.abs(diff).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`, 'splits');
  }
  return clean;
}

export function assertOpen(data, ym, field = 'dueDate') {
  if (data.closedMonths[ym]) {
    throw new ValidationError(`${formatMonth(ym)} está fechado. Reabra o mês no Histórico para alterar.`, field);
  }
}

export const findOrThrow = (list, id, what) => {
  const item = (list || []).find((x) => x.id === id);
  if (!item) throw new ValidationError(`${what} não encontrado(a).`);
  return item;
};

/** Pagamento/ajuste de uma recorrente num mês (ou numa data, nas semanais). */
export function entry(d, id, ymOrDate) {
  const key = entryKey(id, ymOrDate);
  d.recurringEntries[key] ||= { paidAt: null, cents: null, skipped: false };
  return [key, d.recurringEntries[key]];
}

export function cleanupEntry(d, key) {
  const e = d.recurringEntries[key];
  if (e && !e.paidAt && e.cents == null && !e.skipped) delete d.recurringEntries[key];
}

export const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
