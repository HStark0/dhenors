// =============================================================
// Ajustes → Categorias (com subcategorias, orçamento e grupo 50/30/20)
// e Credores (pessoas e empresas)
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { confirmDialog, openDialog } from '../../ui/dialog.js';
import { moneyField } from '../../ui/forms.js';
import { meter } from '../../ui/charts.js';
import { catIcon } from '../../ui/catIcon.js';
import { toast } from '../../ui/toast.js';
import * as E from '../../ui/editors.js';
import { store } from '../../core/store.js';
import { formatBRL, toCents, percent, plural } from '../../core/money.js';
import { formatMonth, todayISO, formatDateBR, formatMonthShort, ymOf } from '../../core/dates.js';
import { computeMonth, creditorOutstanding, creditorMonthly, installmentSummary } from '../../domain/ledger.js';
import { GROUP_LABELS, EMOJI_ICONS } from '../../domain/defaults.js';
import * as A from '../../domain/actions.js';

// ---------- Categorias ----------

export function renderCategories() {
  const d = store.data;
  const ym = store.ui.ym;
  const spent = new Map(computeMonth(d, ym, todayISO()).categories.map((c) => [c.id, c.cents]));
  const budgets = d.settings.budgets || {};
  const totalBudget = Object.values(budgets).reduce((a, b) => a + b, 0);
  const emojis = d.categories.filter((c) => !String(c.icon).startsWith('i:') && EMOJI_ICONS[c.icon]).length;

  return html`
    <div class="page-head">
      <p class="muted">Gastos de ${formatMonth(ym)}${totalBudget ? html` · orçamento total <strong>${formatBRL(totalBudget)}</strong>` : ''}. Defina um teto mensal por categoria para acompanhar no Painel.</p>
      <div class="page-head__actions">
        ${emojis ? html`<button type="button" class="btn btn--ghost" data-action="cat:icons" title="Trocar os emojis por ícones iguais em todo aparelho">${icon('palette')} Usar ícones novos</button>` : ''}
        <button type="button" class="btn btn--ghost" data-action="cat:restore">${icon('undo-2')} Restaurar padrão</button>
        <button type="button" class="btn btn--primary" data-action="cat:new">${icon('plus')} Nova categoria</button>
      </div>
    </div>

    <div class="cards-grid">
      ${d.categories.map((c) => html`
        <article class="card category" style="--cat:${c.color}">
          <header class="entity__head">
            ${catIcon(c, { size: 'md' })}
            <div class="entity__title">
              <h3>${c.name}</h3>
              <p class="muted small">${plural(c.subcategories.length, 'subcategoria')} · ${GROUP_LABELS[c.group || 'needs']}</p>
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
}

const findCat = (id) => store.data.categories.find((c) => c.id === id);
const countUses = (id) => [store.data.expenses, store.data.recurring, store.data.installments, store.data.cardPurchases || []]
  .reduce((n, list) => n + list.filter((x) => x.categoryId === id).length, 0);

function budgetBlock(c, spent, budget) {
  if (!budget) {
    return html`<button type="button" class="btn btn--ghost btn--sm" data-action="cat:budget" data-id="${c.id}">${icon('scale', 'icon--xs')} Definir orçamento</button>`;
  }
  const pct = percent(spent, budget);
  const tone = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
  return html`
    <div class="budget">
      <button type="button" class="link small budget__name" data-action="cat:budget" data-id="${c.id}">${icon('scale', 'icon--xs')} Orçamento ${formatBRL(budget)}</button>
      <span class="budget__value ${pct > 100 ? 'state--over' : ''}">${Math.round(pct)}%</span>
      ${meter(Math.min(spent, budget), { max: budget, label: `Orçamento de ${c.name}`, tone })}
    </div>`;
}

function budgetDialog(c) {
  const current = store.data.settings.budgets?.[c.id] || null;
  openDialog({
    title: `Orçamento: ${c.name}`,
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

// ---------- Credores ----------

export function renderCreditors() {
  const d = store.data;
  const today = todayISO();
  const rows = d.creditors
    .map((c) => ({ c, ...creditorOutstanding(d, c.id, today), uses: usage(d, c.id) }))
    .sort((a, b) => b.outstanding - a.outstanding || a.c.name.localeCompare(b.c.name));
  const total = rows.reduce((a, r) => a + r.outstanding, 0);
  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Total a pagar</dt><dd class="money">${formatBRL(total)}</dd></div>
        <div><dt>Pessoas e empresas</dt><dd>${rows.length}</dd></div>
      </dl>
      <button type="button" class="btn btn--primary" data-action="cred:new">${icon('plus')} Nova</button>
    </div>
    ${rows.length ? html`
      <article class="card">
        <ul class="rows">
          ${rows.map((r) => html`
            <li class="row">
              <button type="button" class="row__main" data-action="cred:details" data-id="${r.c.id}">
                <span class="avatar" aria-hidden="true">${r.c.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>${r.c.name}</strong>
                  <small class="muted">${plural(r.uses, 'lançamento')}${r.monthlyRecurring ? ` · ${formatBRL(r.monthlyRecurring)}/mês recorrente` : ''}${r.receivable ? ` · te deve ${formatBRL(r.receivable)}` : ''}</small>
                </span>
              </button>
              <span class="row__value"><span class="money">${formatBRL(r.outstanding)}</span><small class="muted">em aberto</small></span>
              <span class="row__actions">
                <button type="button" class="icon-btn" data-action="cred:edit" data-id="${r.c.id}" aria-label="Editar ${r.c.name}">${icon('pencil')}</button>
                <button type="button" class="icon-btn danger" data-action="cred:delete" data-id="${r.c.id}" aria-label="Excluir ${r.c.name}">${icon('trash-2')}</button>
              </span>
            </li>`)}
        </ul>
      </article>
      ${monthlyTable(rows.map((r) => r.c), today)}` : html`
      <div class="card empty">
        ${icon('handshake', 'icon--lg')}
        <p><strong>Ninguém cadastrado.</strong></p>
        <p class="muted">Associe contas e parcelamentos a um banco, loja ou pessoa para saber quanto deve a cada um — e quanto te devem.</p>
        <button type="button" class="btn btn--primary" data-action="cred:new">${icon('plus')} Nova</button>
      </div>`}`;
}

/**
 * Saldo devedor de cada credor mês a mês (até 12 meses, cortando
 * os meses em que já não deve nada a ninguém).
 */
function monthlyTable(creditors, today) {
  const d = store.data;
  const per = creditors
    .map((c) => ({ c, months: creditorMonthly(d, c.id, ymOf(today), 12, today) }))
    .filter((x) => x.months.some((m) => m.balanceCents || m.dueCents));
  if (!per.length) return '';
  const last = Math.max(...per.map((x) => x.months.findLastIndex((m) => m.balanceCents || m.dueCents)));
  const months = per[0].months.slice(0, last + 1).map((m) => m.ym);
  const totals = months.map((_, i) => per.reduce((a, x) => a + x.months[i].balanceCents, 0));
  const cell = (m) => html`<td class="money">${formatBRL(m.balanceCents)}${m.dueCents ? html`<br><small class="muted">paga ${formatBRL(m.dueCents)}</small>` : ''}</td>`;
  return html`
    <article class="card">
      <h2 class="card__title">${icon('calendar')} Saldo devedor mês a mês</h2>
      <p class="muted small">Quanto você ainda deve a cada um no início do mês e, embaixo, quanto vence naquele mês. Contas atrasadas entram no mês atual; recorrentes contam só no "paga".</p>
      <div class="table-wrap">
        <table class="table table--compact">
          <thead><tr><th scope="col">Credor</th>${months.map((ym) => html`<th scope="col">${formatMonthShort(ym)}</th>`)}</tr></thead>
          <tbody>
            ${per.map((x) => html`<tr><th scope="row">${x.c.name}</th>${x.months.slice(0, months.length).map(cell)}</tr>`)}
          </tbody>
          ${per.length > 1 ? html`<tfoot><tr><th scope="row">Total</th>${totals.map((t) => html`<td class="money"><strong>${formatBRL(t)}</strong></td>`)}</tr></tfoot>` : ''}
        </table>
      </div>
    </article>`;
}

const findCred = (el) => store.data.creditors.find((c) => c.id === el.dataset.id);

function usage(d, id) {
  return [d.expenses, d.recurring, d.installments, d.receivables || []].reduce((n, list) => n + list.filter((x) => x.creditorId === id).length, 0);
}

function details(c) {
  const d = store.data;
  const expenses = d.expenses.filter((e) => e.creditorId === c.id && !e.paidAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const installments = d.installments.filter((i) => i.creditorId === c.id).map((i) => ({ i, s: installmentSummary(i) })).filter((x) => !x.s.finished);
  const recurring = d.recurring.filter((r) => r.creditorId === c.id && !r.endYM);
  const owes = (d.receivables || []).filter((r) => r.creditorId === c.id && !r.receivedAt);
  const today = todayISO();
  const months = creditorMonthly(d, c.id, ymOf(today), 12, today).filter((m) => m.balanceCents || m.dueCents);
  openDialog({
    title: c.name,
    body: html`
      ${c.notes ? html`<p class="dialog__text muted">${c.notes}</p>` : ''}
      ${months.length ? html`<h3 class="dialog__subtitle">Saldo devedor por mês</h3><ul class="mini-list">${months.map((m) => html`
        <li><span>${formatMonth(m.ym)} <small class="muted">${m.dueCents ? `paga ${formatBRL(m.dueCents)}` : 'nada vence'}</small></span><span class="money">${formatBRL(m.balanceCents)}</span></li>`)}</ul>` : ''}
      <h3 class="dialog__subtitle">Contas em aberto</h3>
      ${expenses.length ? html`<ul class="mini-list">${expenses.map((e) => html`
        <li><span>${e.description} <small class="muted">${formatDateBR(e.dueDate)}</small></span><span class="money">${formatBRL(e.cents)}</span></li>`)}</ul>`
        : html`<p class="muted small">Nenhuma.</p>`}
      <h3 class="dialog__subtitle">Parcelamentos</h3>
      ${installments.length ? html`<ul class="mini-list">${installments.map(({ i, s }) => html`
        <li><span>${i.description} <small class="muted">${s.paidCount}/${i.count} · até ${formatMonthShort(s.lastYM)}</small></span><span class="money">${formatBRL(s.remainingCents)}</span></li>`)}</ul>`
        : html`<p class="muted small">Nenhum.</p>`}
      <h3 class="dialog__subtitle">Recorrentes</h3>
      ${recurring.length ? html`<ul class="mini-list">${recurring.map((r) => html`
        <li><span>${r.description} <small class="muted">dia ${r.dueDay}</small></span><span class="money">${formatBRL(r.cents)}/mês</span></li>`)}</ul>`
        : html`<p class="muted small">Nenhuma.</p>`}
      ${owes.length ? html`<h3 class="dialog__subtitle">Te deve</h3><ul class="mini-list">${owes.map((r) => html`<li><span>${r.description}</span><span class="money pos">${formatBRL(r.cents)}</span></li>`)}</ul>` : ''}`,
  });
}

export const categoryActions = {
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
  'cat:icons': () => { A.useCategoryIcons(EMOJI_ICONS); toast('Ícones atualizados.', { action: { label: 'Desfazer', run: () => store.undo() } }); },
  'sub:new': (el) => E.editSubcategory(el.dataset.cat),
  'sub:edit': (el) => E.editSubcategory(el.dataset.cat, findCat(el.dataset.cat).subcategories.find((s) => s.id === el.dataset.id)),
  'sub:delete': (el) => {
    const sub = findCat(el.dataset.cat).subcategories.find((s) => s.id === el.dataset.id);
    E.deleteWithUndo(() => A.deleteSubcategory(el.dataset.cat, sub.id), `Subcategoria "${sub.name}" removida.`);
  },
  'cred:new': () => E.editCreditor(),
  'cred:edit': (el) => E.editCreditor(findCred(el)),
  'cred:details': (el) => details(findCred(el)),
  'cred:delete': (el) => {
    const c = findCred(el);
    E.confirmDelete(`"${c.name}" (os lançamentos ficam sem credor)`, () => A.deleteCreditor(c.id));
  },
};
