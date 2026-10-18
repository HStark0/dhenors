// =============================================================
// actions/categories.js — Credores, categorias, regras de
// categorização e importação de extrato (com conciliação)
// =============================================================

import { store } from '../../core/store.js';
import { MAX_CENTS } from '../../core/money.js';
import { isValidISO, ymOf } from '../../core/dates.js';
import { newId, createDefaultCategories } from '../schema.js';
import { CATEGORY_COLORS, groupOfCategory } from '../defaults.js';
import { ValidationError, text, findOrThrow } from './core.js';
import { setItemPaid } from './bills.js';

// ---------- Credores ----------

export function saveCreditor(input) {
  return store.commit((d) => {
    const name = text(input.name, 'name', 'o nome', { max: 80 });
    const dup = d.creditors.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== input.id);
    if (dup) throw new ValidationError('Já existe um credor com esse nome.', 'name');
    const item = { name, notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }) };
    if (input.id) { Object.assign(findOrThrow(d.creditors, input.id, 'Credor'), item); return null; }
    const c = { id: newId(), ...item };
    d.creditors.push(c);
    return c;
  });
}

/** Remove o credor e limpa a referência em todos os lançamentos. */
export function deleteCreditor(id) {
  return store.commit((d) => {
    d.creditors = d.creditors.filter((c) => c.id !== id);
    for (const list of [d.expenses, d.recurring, d.installments, d.receivables || [], d.debts || []]) {
      for (const x of list) if (x.creditorId === id) x.creditorId = null;
    }
  }, 'change', { undo: 'Credor excluído' });
}

// ---------- Categorias ----------

export function saveCategory(input) {
  return store.commit((d) => {
    const name = text(input.name, 'name', 'o nome', { max: 60 });
    const dup = d.categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== input.id);
    if (dup) throw new ValidationError('Já existe uma categoria com esse nome.', 'name');
    const item = {
      name,
      icon: text(input.icon || 'i:tag', 'icon', 'o ícone', { max: 24 }),
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : CATEGORY_COLORS[d.categories.length % CATEGORY_COLORS.length],
      group: ['needs', 'wants', 'savings'].includes(input.group) ? input.group : groupOfCategory(name),
    };
    if (input.id) { Object.assign(findOrThrow(d.categories, input.id, 'Categoria'), item); return null; }
    const c = { id: newId(), ...item, subcategories: [] };
    d.categories.push(c);
    return c;
  });
}

/** Remove a categoria; lançamentos ficam "Sem categoria". */
export function deleteCategory(id) {
  return store.commit((d) => {
    d.categories = d.categories.filter((c) => c.id !== id);
    for (const list of [d.expenses, d.recurring, d.installments, d.cardPurchases || []]) {
      for (const x of list) {
        if (x.categoryId === id) { x.categoryId = null; x.subcategoryId = null; }
        if (x.splits?.some((s) => s.categoryId === id)) x.splits = x.splits.map((s) => (s.categoryId === id ? { ...s, categoryId: null, subcategoryId: null } : s));
      }
    }
    if (d.settings.budgets) delete d.settings.budgets[id];
    for (const e of d.settings.envelopes || []) e.categoryIds = e.categoryIds.filter((x) => x !== id);
  }, 'change', { undo: 'Categoria excluída' });
}

export function saveSubcategory(categoryId, input) {
  return store.commit((d) => {
    const cat = findOrThrow(d.categories, categoryId, 'Categoria');
    const name = text(input.name, 'name', 'o nome', { max: 60 });
    if (cat.subcategories.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== input.id)) {
      throw new ValidationError('Essa subcategoria já existe.', 'name');
    }
    if (input.id) findOrThrow(cat.subcategories, input.id, 'Subcategoria').name = name;
    else cat.subcategories.push({ id: newId(), name });
  });
}

export function deleteSubcategory(categoryId, subId) {
  return store.commit((d) => {
    const cat = findOrThrow(d.categories, categoryId, 'Categoria');
    cat.subcategories = cat.subcategories.filter((s) => s.id !== subId);
    for (const list of [d.expenses, d.recurring, d.installments, d.cardPurchases || []]) {
      for (const x of list) if (x.subcategoryId === subId) x.subcategoryId = null;
    }
  }, 'change', { undo: 'Subcategoria excluída' });
}

/**
 * Restaura as categorias padrão. Categorias com o mesmo nome são
 * mantidas (mesmo id), então os lançamentos não perdem a categoria.
 * Categorias criadas por você também são mantidas.
 */
export function restoreDefaultCategories() {
  return store.commit((d) => {
    const defaults = createDefaultCategories();
    for (const def of defaults) {
      const existing = d.categories.find((c) => c.name.toLowerCase() === def.name.toLowerCase());
      if (!existing) { d.categories.push(def); continue; }
      for (const sub of def.subcategories) {
        if (!existing.subcategories.some((s) => s.name.toLowerCase() === sub.name.toLowerCase())) {
          existing.subcategories.push(sub);
        }
      }
    }
  });
}

/** Troca os emojis das categorias pelos ícones próprios equivalentes. */
export function useCategoryIcons(map) {
  return store.commit((d) => {
    for (const c of d.categories) if (!String(c.icon).startsWith('i:') && map[c.icon]) c.icon = `i:${map[c.icon]}`;
  }, 'change', { undo: 'Ícones das categorias trocados' }); // o aviso oferece "Desfazer"
}

// ---------- Regras de categorização ----------

export function saveRule(input) {
  return store.commit((d) => {
    const pattern = text(input.pattern, 'pattern', 'o texto da regra', { max: 60 });
    const cat = findOrThrow(d.categories, input.categoryId, 'Categoria');
    const rule = { id: input.id || newId(), pattern, categoryId: cat.id, subcategoryId: cat.subcategories.some((x) => x.id === input.subcategoryId) ? input.subcategoryId : null };
    d.settings.rules = [...(d.settings.rules || []).filter((r) => r.id !== rule.id && r.pattern.toLowerCase() !== pattern.toLowerCase()), rule];
  });
}

export function deleteRule(id) {
  return store.commit((d) => { d.settings.rules = (d.settings.rules || []).filter((r) => r.id !== id); }, 'change', { undo: 'Regra removida' });
}

/**
 * Aprende ao recategorizar: cria a regra E aplica nos lançamentos
 * parecidos que ainda estão sem categoria (ou com a antiga).
 */
export function learnRule({ pattern, categoryId, subcategoryId = null, applyTo = 'uncategorized' }) {
  return store.commit((d) => {
    const p = text(pattern, 'pattern', 'o texto da regra', { max: 60 }).toLowerCase();
    const cat = findOrThrow(d.categories, categoryId, 'Categoria');
    const sub = cat.subcategories.some((s) => s.id === subcategoryId) ? subcategoryId : null;
    d.settings.rules = [...(d.settings.rules || []).filter((r) => r.pattern.toLowerCase() !== p), { id: newId(), pattern: p, categoryId: cat.id, subcategoryId: sub }];
    let n = 0;
    const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const list of [d.expenses, d.cardPurchases || []]) {
      for (const x of list) {
        if (!norm(x.description).includes(norm(p))) continue;
        if (applyTo === 'uncategorized' && x.categoryId) continue;
        if (x.dueDate && d.closedMonths[ymOf(x.dueDate)]) continue;
        x.categoryId = cat.id;
        x.subcategoryId = sub;
        n++;
      }
    }
    return n;
  });
}

// ---------- Importação de extrato ----------

/**
 * Importa transações revisadas na tela de importação.
 * rows: [{ date, description, cents (>0 gasto, <0 entrada), categoryId, subcategoryId, fingerprint, match?, accountId? }]
 *  • com `match` (conciliação), a conta já lançada é marcada como paga;
 *  • gastos sem par viram despesas JÁ PAGAS;
 *  • entradas viram renda extra (fora da folha).
 * Meses fechados são ignorados. → { expenses, incomes, matched, skipped }
 */
export function importTransactions(rows, { accountId = null } = {}) {
  const matched = rows.filter((r) => r.match && !r.ignoreMatch);
  for (const r of matched) {
    try { setItemPaid(r.match.item, true, r.date, { cents: r.cents, accountId: accountId ?? undefined }); } catch { r.ignoreMatch = true; }
  }
  return store.commit((d) => {
    const seen = new Set(d.importFingerprints || []);
    const acc = (d.accounts || []).some((a) => a.id === accountId) ? accountId : null;
    const out = { expenses: 0, incomes: 0, matched: matched.filter((r) => !r.ignoreMatch).length, skipped: 0 };
    for (const r of rows) {
      if (r.match && !r.ignoreMatch) { if (r.fingerprint) seen.add(r.fingerprint); continue; }
      if (!isValidISO(r.date) || !Number.isInteger(r.cents) || !r.cents || seen.has(r.fingerprint) || d.closedMonths[ymOf(r.date)]) {
        out.skipped++;
        continue;
      }
      const description = String(r.description || 'Lançamento').trim().replace(/\s+/g, ' ').slice(0, 120);
      if (r.cents > 0) {
        const cat = d.categories.find((c) => c.id === r.categoryId);
        d.expenses.push({
          id: newId(), description, cents: Math.min(r.cents, MAX_CENTS), dueDate: r.date, paidAt: r.date,
          categoryId: cat ? cat.id : null, subcategoryId: cat?.subcategories.some((x) => x.id === r.subcategoryId) ? r.subcategoryId : null,
          creditorId: null, notes: 'Importado do extrato', tags: [], splits: [], attachments: [], accountId: acc,
        });
        out.expenses++;
      } else {
        d.extraIncomes.push({ id: newId(), ym: ymOf(r.date), description, cents: Math.min(-r.cents, MAX_CENTS), date: r.date, payroll: false, kind: r.incomeKind || 'extra', accountId: acc });
        out.incomes++;
      }
      if (r.fingerprint) seen.add(r.fingerprint);
    }
    d.importFingerprints = [...seen].slice(-5000);
    return out;
  });
}
