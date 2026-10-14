// =============================================================
// Categorias — organizar os gastos (com subcategorias)
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { moneyField } from '../ui/forms.js';
import { meter } from '../ui/charts.js';
import { toast } from '../ui/toast.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, toCents, percent, plural } from '../core/money.js';
import { formatMonth, todayISO } from '../core/dates.js';
import { computeMonth } from '../domain/ledger.js';
import * as A from '../domain/actions.js';

export default {
  id: 'categorias',
  title: 'Categorias e orçamentos',
  monthNav: true,

  render() {
    const d = store.data;
    const ym = store.ui.ym;
    const spent = new Map(computeMonth(d, ym, todayISO()).categories.map((c) => [c.id, c.cents]));
    const budgets = d.settings.budgets || {};
    const totalBudget = Object.values(budgets).reduce((a, b) => a + b, 0);

    return html`
      <div class="page-head">
        <p class="muted">Gastos de ${formatMonth(ym)}${totalBudget ? html` · orçamento total <strong>${formatBRL(totalBudget)}</strong>` : ''}. Defina um teto mensal por categoria para acompanhar no Painel.</p>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost" data-action="cat:restore">${icon('undo-2')} Restaurar padrão</button>
          <button type="button" class="btn btn--primary" data-action="cat:new">${icon('plus')} Nova categoria</button>
        </div>
      </div>

      <div class="cards-grid">
        ${d.categories.map((c) => html`
          <article class="card category" style="--cat:${c.color}">
            <header class="entity__head">
              <span class="entity__icon">${c.icon}</span>
              <div class="entity__title">
                <h3>${c.name}</h3>
                <p class="muted small">${plural(c.subcategories.length, 'subcategoria')}</p>
              </div>
              <p class="entity__value money">${formatBRL(spent.get(c.id) || 0)}</p>
            </header>
            ${budgetBlock(c, spent.get(c.id) || 0, budgets[c.id] || 0)}
            <ul class="tags">
              ${c.subcategories.map((s) => html`
                <li class="tag">
                  <button type="button" class="tag__label" data-action="sub:edit" data-cat="${c.id}" data-id="${s.id}" aria-label="Renomear ${s.name}">${s.name}</button>
                  <button type="button" class="tag__remove" data-action="sub:delete" data-cat="${c.id}" data-id="${s.id}" aria-label="Remover ${s.name}">${icon('x')}</button>
                </li>`)}
              <li><button type="button" class="tag tag--add" data-action="sub:new" data-cat="${c.id}">${icon('plus', 'icon--xs')} Subcategoria</button></li>
            </ul>
            <footer class="entity__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-action="cat:edit" data-id="${c.id}">${icon('pencil', 'icon--xs')} Editar</button>
              <button type="button" class="btn btn--ghost btn--sm danger" data-action="cat:delete" data-id="${c.id}">${icon('trash-2', 'icon--xs')} Excluir</button>
            </footer>
          </article>`)}
      </div>`;
  },

  actions: {
    'cat:new': () => E.editCategory(),
    'cat:budget': (el) => budgetDialog(findCat(el.dataset.id)),
    'cat:edit': (el) => E.editCategory(findCat(el.dataset.id)),
    'cat:delete': (el) => {
      const c = findCat(el.dataset.id);
      const n = countUses(c.id);
      E.confirmDelete(`a categoria "${c.name}"${n ? ` (${plural(n, 'lançamento ficará', 'lançamentos ficarão')} sem categoria)` : ''}`, () => A.deleteCategory(c.id));
    },
    'cat:restore': async () => {
      const ok = await confirmDialog({
        title: 'Restaurar categorias padrão',
        message: 'As categorias padrão que estiverem faltando serão adicionadas de volta. As suas categorias e os lançamentos não são alterados.',
        confirmLabel: 'Restaurar',
      });
      if (ok) { A.restoreDefaultCategories(); toast('Categorias padrão restauradas.'); }
    },
    'sub:new': (el) => E.editSubcategory(el.dataset.cat),
    'sub:edit': (el) => E.editSubcategory(el.dataset.cat, findCat(el.dataset.cat).subcategories.find((s) => s.id === el.dataset.id)),
    'sub:delete': (el) => {
      const sub = findCat(el.dataset.cat).subcategories.find((s) => s.id === el.dataset.id);
      E.confirmDelete(`a subcategoria "${sub.name}"`, () => A.deleteSubcategory(el.dataset.cat, sub.id));
    },
  },
};

const findCat = (id) => store.data.categories.find((c) => c.id === id);
const countUses = (id) => [store.data.expenses, store.data.recurring, store.data.installments]
  .reduce((n, list) => n + list.filter((x) => x.categoryId === id).length, 0);

function budgetBlock(c, spent, budget) {
  if (!budget) {
    return html`<button type="button" class="btn btn--ghost btn--sm" data-action="cat:budget" data-id="${c.id}">${icon('scale', 'icon--xs')} Definir orçamento</button>`;
  }
  const pct = percent(spent, budget);
  const tone = pct > 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  return html`
    <div class="budget">
      <button type="button" class="link small budget__name" data-action="cat:budget" data-id="${c.id}">${icon('scale', 'icon--xs')} Orçamento ${formatBRL(budget)}</button>
      <span class="budget__value ${pct > 100 ? 'neg' : ''}">${Math.round(pct)}%</span>
      ${meter(Math.min(spent, budget), { max: budget, label: `Orçamento de ${c.name}`, tone })}
    </div>`;
}

function budgetDialog(c) {
  const current = store.data.settings.budgets?.[c.id] || null;
  openDialog({
    title: `Orçamento: ${c.icon} ${c.name}`,
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Quanto você quer gastar, no máximo, por mês nesta categoria? Deixe vazio para remover.</p>
      ${moneyField({ label: 'Teto mensal', name: 'cents', cents: current, required: false })}`,
    onSubmit: (form) => {
      const v = form.cents.value.trim();
      A.setBudget(c.id, v ? toCents(v) : 0);
      toast(v ? 'Orçamento salvo.' : 'Orçamento removido.');
    },
  });
}
