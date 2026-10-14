// =============================================================
// Credores — para quem você deve (bancos, lojas, pessoas)
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, plural } from '../core/money.js';
import { formatDateBR, formatMonthShort, todayISO } from '../core/dates.js';
import { creditorOutstanding, installmentSummary } from '../domain/ledger.js';
import * as A from '../domain/actions.js';

export default {
  id: 'credores',
  title: 'Credores',

  render() {
    const d = store.data;
    const today = todayISO();
    const rows = d.creditors
      .map((c) => ({ c, ...creditorOutstanding(d, c.id, today), uses: usage(d, c.id) }))
      .sort((a, b) => b.outstanding - a.outstanding || a.c.name.localeCompare(b.c.name));
    const total = rows.reduce((a, r) => a + r.outstanding, 0);

    return html`
      <div class="page-head">
        <dl class="stats">
          <div><dt>Total a pagar aos credores</dt><dd class="money">${formatBRL(total)}</dd></div>
          <div><dt>Credores</dt><dd>${rows.length}</dd></div>
        </dl>
        <button type="button" class="btn btn--primary" data-action="cred:new">${icon('plus')} Novo credor</button>
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
                    <small class="muted">${plural(r.uses, 'lançamento')}${r.monthlyRecurring ? ` · ${formatBRL(r.monthlyRecurring)}/mês recorrente` : ''}</small>
                  </span>
                </button>
                <span class="row__value">
                  <span class="money">${formatBRL(r.outstanding)}</span>
                  <small class="muted">em aberto</small>
                </span>
                <span class="row__actions">
                  <button type="button" class="icon-btn" data-action="cred:edit" data-id="${r.c.id}" aria-label="Editar ${r.c.name}">${icon('pencil')}</button>
                  <button type="button" class="icon-btn danger" data-action="cred:delete" data-id="${r.c.id}" aria-label="Excluir ${r.c.name}">${icon('trash-2')}</button>
                </span>
              </li>`)}
          </ul>
        </article>` : html`
        <div class="card empty">
          ${icon('handshake', 'icon--lg')}
          <p><strong>Nenhum credor cadastrado.</strong></p>
          <p class="muted">Associe contas e parcelamentos a um banco, loja ou pessoa para saber quanto deve a cada um.</p>
          <button type="button" class="btn btn--primary" data-action="cred:new">${icon('plus')} Novo credor</button>
        </div>`}`;
  },

  actions: {
    'cred:new': () => E.editCreditor(),
    'cred:edit': (el) => E.editCreditor(find(el)),
    'cred:details': (el) => details(find(el)),
    'cred:delete': (el) => {
      const c = find(el);
      E.confirmDelete(`o credor "${c.name}" (os lançamentos ficam sem credor)`, () => A.deleteCreditor(c.id));
    },
  },
};

const find = (el) => store.data.creditors.find((c) => c.id === el.dataset.id);

function usage(d, id) {
  return [d.expenses, d.recurring, d.installments].reduce((n, list) => n + list.filter((x) => x.creditorId === id).length, 0);
}

function details(c) {
  const d = store.data;
  const expenses = d.expenses.filter((e) => e.creditorId === c.id && !e.paidAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const installments = d.installments.filter((i) => i.creditorId === c.id).map((i) => ({ i, s: installmentSummary(i) })).filter((x) => !x.s.finished);
  const recurring = d.recurring.filter((r) => r.creditorId === c.id && !r.endYM);

  openDialog({
    title: c.name,
    body: html`
      ${c.notes ? html`<p class="dialog__text muted">${c.notes}</p>` : ''}
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
        : html`<p class="muted small">Nenhuma.</p>`}`,
  });
}
