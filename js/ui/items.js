// =============================================================
// items.js — Linha de conta do mês (usada no Painel e em Contas)
// -------------------------------------------------------------
// Uma linha = um compromisso do mês (avulsa, recorrente ou parcela),
// com botão de pagar e menu de ações.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { actionSheet, confirmDialog } from './dialog.js';
import { store } from '../core/store.js';
import { formatBRL } from '../core/money.js';
import { formatDayMonth, relativeDays, formatMonth, ymOf, formatDateBR } from '../core/dates.js';
import * as A from '../domain/actions.js';
import * as E from './editors.js';

/** Registro das linhas desenhadas (chave → item), usado pelos cliques. */
const registry = new Map();

const KIND_LABEL = { expense: 'Avulsa', recurring: 'Recorrente', installment: 'Parcela' };
const STATUS_LABEL = { paid: 'Pago', overdue: 'Atrasada', today: 'Vence hoje', soon: 'Em breve', upcoming: 'A vencer' };

export function itemRow(item, { showMonth = false } = {}) {
  registry.set(item.key, item);
  const d = store.data;
  const cat = d.categories.find((c) => c.id === item.categoryId);
  const sub = cat?.subcategories.find((s) => s.id === item.subcategoryId);
  const cred = d.creditors.find((c) => c.id === item.creditorId);
  const paid = item.status === 'paid';
  const when = paid ? 'pago' : relativeDays(item.dueDate);

  return html`
    <li class="item item--${item.status}">
      <button type="button" class="pay-btn" data-action="item:toggle" data-key="${item.key}"
        aria-pressed="${paid}" aria-label="${paid ? 'Desmarcar pagamento de' : 'Marcar como pago:'} ${item.description}">
        ${icon('check')}
      </button>
      <div class="item__main">
        <span class="item__title">${item.description}
          ${item.parcel ? html`<span class="badge">${item.parcel.n}/${item.parcel.count}</span>` : ''}
          ${item.adjusted ? html`<span class="badge badge--info" title="Valor ajustado neste mês">ajustado</span>` : ''}
        </span>
        <span class="item__meta">
          <span class="cat-dot" style="--cat:${cat?.color || '#94A3B8'}" aria-hidden="true"></span>${cat ? `${cat.icon} ${cat.name}` : 'Sem categoria'}${sub ? ` › ${sub.name}` : ''}
          · ${KIND_LABEL[item.kind]}${cred ? html` · ${icon('handshake', 'icon--xs')} ${cred.name}` : ''}
        </span>
      </div>
      <div class="item__due">
        <span>${showMonth ? formatDateBR(item.dueDate) : formatDayMonth(item.dueDate)}</span>
        <small class="status status--${item.status}">${item.status === 'paid' ? STATUS_LABEL.paid : item.status === 'overdue' ? `atrasada · ${when}` : when}</small>
      </div>
      <div class="item__value money">${formatBRL(item.cents)}</div>
      <button type="button" class="icon-btn" data-action="item:menu" data-key="${item.key}" aria-label="Ações de ${item.description}">
        ${icon('ellipsis')}
      </button>
    </li>`;
}

export function itemList(items, opts = {}) {
  if (!items.length) return '';
  return html`<ul class="items">${items.map((i) => itemRow(i, opts))}</ul>`;
}

/** Ações tratadas pelo despachante central (main.js). */
export const itemActions = {
  'item:toggle': (el) => {
    const item = registry.get(el.dataset.key);
    if (!item) return;
    const paid = item.status !== 'paid';
    A.setItemPaid(item, paid);
    toast(paid ? `${item.description} paga.` : `Pagamento de ${item.description} desfeito.`, {
      action: { label: 'Desfazer', run: () => A.setItemPaid(item, !paid) },
    });
  },

  'item:menu': (el) => {
    const item = registry.get(el.dataset.key);
    if (!item) return;
    const d = store.data;
    const paid = item.status === 'paid';
    const ym = ymOf(item.dueDate);
    const actions = [{
      label: paid ? 'Desmarcar pagamento' : 'Marcar como pago',
      icon: paid ? 'undo-2' : 'circle-check',
      run: () => A.setItemPaid(item, !paid),
    }];

    if (item.kind === 'expense') {
      const expense = d.expenses.find((e) => e.id === item.refId);
      actions.push({ label: 'Editar', icon: 'pencil', run: () => E.editExpense(expense) });
      if (!paid) actions.push({ label: 'Adiar', icon: 'calendar-clock', run: () => E.postponeExpenseDialog(expense) });
      actions.push({ label: 'Excluir', icon: 'trash-2', danger: true, run: () => E.confirmDelete(`"${expense.description}"`, () => A.deleteExpense(expense.id)) });
    }

    if (item.kind === 'recurring') {
      const rec = d.recurring.find((r) => r.id === item.refId);
      actions.push(
        { label: 'Ajustar valor deste mês', hint: 'Ex.: a conta de luz veio diferente', icon: 'banknote', run: () => E.adjustRecurringMonth(item) },
        { label: 'Pular este mês', icon: 'skip-forward', run: () => { A.skipRecurringMonth(rec.id, ym, true); toast(`${rec.description} pulada em ${formatMonth(ym)}.`, { action: { label: 'Desfazer', run: () => A.skipRecurringMonth(rec.id, ym, false) } }); } },
        { label: 'Editar recorrente', icon: 'pencil', run: () => E.editRecurring(rec) },
        { label: 'Encerrar após este mês', icon: 'lock', run: async () => {
          const ok = await confirmDialog({ title: 'Encerrar recorrente', message: `"${rec.description}" deixará de aparecer depois de ${formatMonth(ym)}. O histórico é mantido.`, confirmLabel: 'Encerrar' });
          if (ok) { A.endRecurring(rec.id, ym); toast('Recorrente encerrada.'); }
        } },
      );
    }

    if (item.kind === 'installment') {
      const inst = d.installments.find((x) => x.id === item.refId);
      actions.push(
        { label: 'Ver todas as parcelas', icon: 'list-filter', run: () => E.installmentDetails(inst.id) },
        { label: 'Editar parcelamento', icon: 'pencil', run: () => E.editInstallment(inst) },
      );
    }

    actionSheet({ title: item.description, subtitle: `${formatBRL(item.cents)} · vence ${formatDateBR(item.dueDate)}`, actions });
  },
};
