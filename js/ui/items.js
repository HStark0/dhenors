// =============================================================
// items.js — Linha de conta do mês (usada no Painel, Contas, Agenda, Busca)
//  • Selos de análise (domain/weights.js): gasto exagerado, fora do
//    comum e que pesa no futuro — com o porquê no title.
// -------------------------------------------------------------
// Uma linha = um compromisso do mês (avulsa, recorrente, parcela ou
// fatura de cartão), com botão de pagar e menu de ações.
//  • Status escrito ("Atrasada há 3 dias"), com ícone — não só cor.
//  • Paga: valor esmaecido e selo "Pago" (não riscado: riscado
//    parece cancelado).
//  • Lista agrupada por data (Atrasadas, Hoje, Esta semana, Depois,
//    Pagas) com cabeçalho fixo e o total de cada grupo.
//  • Modo seleção para ações em lote; teclado (↑ ↓, Enter paga,
//    Espaço marca, M abre o menu) e deslizar no celular (ui/swipe.js).
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { actionSheet, confirmDialog } from './dialog.js';
import { catIcon } from './catIcon.js';
import { quickToggle, payDialog } from './pay.js';
import { store } from '../core/store.js';
import { formatBRL, sumCents } from '../core/money.js';
import { formatDayMonth, relativeDays, formatMonth, ymOf, formatDateBR, todayISO, diffDays } from '../core/dates.js';
import * as A from '../domain/actions.js';
import { flagsOf } from '../domain/weights.js';
import { flagBadges } from './outlookUI.js';
import * as E from './editors.js';

/** Registro das linhas desenhadas (chave → item), usado pelos cliques.
 *  Limitado: as chaves mais antigas saem (o Map guarda a ordem de inserção). */
const registry = new Map();
const REGISTRY_MAX = 2000;
export const itemByKey = (key) => registry.get(key);

const KIND_LABEL = { expense: 'Avulsa', recurring: 'Recorrente', installment: 'Parcela', invoice: 'Fatura do cartão' };
const STATUS_ICON = { paid: 'circle-check', overdue: 'circle-alert', today: 'alarm-clock', soon: 'clock', upcoming: 'calendar' };

/** Status por extenso (o círculo colorido nunca é a única pista). */
function statusText(item, today = todayISO()) {
  if (item.status === 'paid') {
    const late = item.paidAt && item.paidAt > item.dueDate ? diffDays(item.dueDate, item.paidAt) : 0;
    return `Pago${item.paidAt && item.paidAtKnown !== false ? ` em ${formatDayMonth(item.paidAt)}` : ''}${late > 0 ? ` · ${late} ${late === 1 ? 'dia' : 'dias'} de atraso` : ''}`;
  }
  if (item.status === 'overdue') return `Atrasada · venceu ${relativeDays(item.dueDate, today)}`;
  if (item.status === 'today') return 'Vence hoje';
  return `Vence ${relativeDays(item.dueDate, today)}`;
}

export function itemRow(item, { showMonth = false, selectable = false, selected = false, first = false } = {}) {
  registry.delete(item.key);
  registry.set(item.key, item);
  if (registry.size > REGISTRY_MAX) registry.delete(registry.keys().next().value);
  const d = store.data;
  const cat = d.categories.find((c) => c.id === item.categoryId);
  const sub = cat?.subcategories.find((s) => s.id === item.subcategoryId);
  const cred = d.creditors.find((c) => c.id === item.creditorId);
  const card = item.kind === 'invoice' ? d.cards.find((c) => c.id === item.refId) : null;
  const paid = item.status === 'paid';
  const iconCat = card ? { icon: 'i:credit-card', color: card.color, name: card.name } : item.splits?.length ? { icon: 'i:split', color: '#64748B', name: 'Dividido' } : cat;

  return html`
    <li class="item item--${item.status} ${selected ? 'is-selected' : ''}" data-key="${item.key}" tabindex="${first ? 0 : -1}" data-swipe>
      ${selectable ? html`
        <label class="item__select"><input type="checkbox" data-action="sel:toggle" data-key="${item.key}" ${selected ? 'checked' : ''} aria-label="Selecionar ${item.description}"></label>` : ''}
      <button type="button" class="pay-btn" data-action="item:toggle" data-key="${item.key}"
        aria-pressed="${paid}" aria-label="${paid ? 'Desmarcar pagamento de' : 'Marcar como pago hoje:'} ${item.description}">
        ${icon('check')}
      </button>
      <div class="item__main">
        <span class="item__title">${catIcon(iconCat, { size: 'xs' })}<span class="item__name">${item.description}</span>
          ${item.parcel ? html`<span class="badge">${item.parcel.n}/${item.parcel.count}</span>` : ''}
          ${item.adjusted ? html`<span class="badge badge--info" title="Valor ajustado neste mês">ajustado</span>` : ''}
          ${item.estimated ? html`<span class="badge badge--info" title="Valor estimado pela média dos últimos meses">estimado</span>` : ''}
          ${item.subscription ? html`<span class="badge badge--muted">assinatura</span>` : ''}
          ${item.invoice ? html`<span class="badge badge--muted">${item.invoice.status === 'open' ? 'aberta' : item.invoice.status === 'closed' ? 'fechada' : 'paga'} · ${item.invoice.lines} ${item.invoice.lines === 1 ? 'compra' : 'compras'}</span>` : ''}
          ${item.attachments ? html`<span class="badge badge--muted" title="${item.attachments} anexo(s)">${icon('paperclip', 'icon--xs')}<span class="sr-only">${item.attachments} anexo(s)</span></span>` : ''}
          ${paid ? html`<span class="badge badge--paid">${icon('check', 'icon--xs')} Pago</span>` : ''}
        </span>
        <span class="item__meta">
          ${card ? `Cartão ${card.name}` : item.splits?.length ? `Dividido em ${item.splits.length} categorias` : cat ? cat.name : 'Sem categoria'}${sub ? ` › ${sub.name}` : ''}
          · ${KIND_LABEL[item.kind]}${cred ? html` · ${icon('handshake', 'icon--xs')} ${cred.name}` : ''}
          ${(item.tags || []).map((t) => html` <span class="tag-chip">#${t}</span>`)}
          ${flagBadges(flagsOf(d, item))}
        </span>
      </div>
      <div class="item__due">
        <span>${showMonth ? formatDateBR(item.dueDate) : formatDayMonth(item.dueDate)}</span>
        <small class="status status--${item.status}">${icon(STATUS_ICON[item.status], 'icon--xs')} ${statusText(item)}</small>
      </div>
      <div class="item__value money">${formatBRL(item.cents)}</div>
      <button type="button" class="icon-btn" data-action="item:menu" data-key="${item.key}" aria-label="Ações de ${item.description}">
        ${icon('ellipsis')}
      </button>
    </li>`;
}

/** Lista simples. opts: { showMonth, selectable, selected: Set } */
export function itemList(items, opts = {}) {
  if (!items.length) return '';
  return html`<ul class="items" role="list" data-listnav>${items.map((i, n) => itemRow(i, { ...opts, first: n === 0, selected: opts.selected?.has(i.key) }))}</ul>`;
}

/** Grupos por data: Atrasadas · Hoje · Esta semana · Depois · Pagas. */
export function groupItems(items, today = todayISO()) {
  const groups = [
    { id: 'overdue', label: 'Atrasadas', tone: 'bad', items: [] },
    { id: 'today', label: 'Hoje', tone: 'warn', items: [] },
    { id: 'week', label: 'Próximos 7 dias', tone: 'warn', items: [] },
    { id: 'later', label: 'Depois', tone: '', items: [] },
    { id: 'paid', label: 'Pagas', tone: 'good', items: [] },
  ];
  const by = Object.fromEntries(groups.map((g) => [g.id, g]));
  for (const i of items) {
    if (i.status === 'paid') by.paid.items.push(i);
    else if (i.status === 'overdue') by.overdue.items.push(i);
    else if (i.dueDate === today) by.today.items.push(i);
    else if (diffDays(today, i.dueDate) <= 7) by.week.items.push(i);
    else by.later.items.push(i);
  }
  return groups.filter((g) => g.items.length).map((g) => ({ ...g, total: sumCents(g.items.map((i) => i.cents)) }));
}

/** Lista agrupada por data, com cabeçalhos fixos e o total de cada grupo. */
export function groupedItemList(items, opts = {}) {
  if (!items.length) return '';
  let first = true;
  return html`
    <div class="item-groups">
      ${groupItems(items).map((g) => html`
        <section class="item-group item-group--${g.id}" aria-label="${g.label}">
          <h3 class="item-group__head">
            <span>${g.label} <span class="muted">(${g.items.length})</span></span>
            <span class="money">${formatBRL(g.total)}</span>
          </h3>
          <ul class="items" role="list" data-listnav>
            ${g.items.map((i) => { const row = itemRow(i, { ...opts, first, selected: opts.selected?.has(i.key) }); first = false; return row; })}
          </ul>
        </section>`)}
    </div>`;
}

/** Ações tratadas pelo despachante central (main.js). */
export const itemActions = {
  'item:toggle': (el) => {
    const item = registry.get(el.dataset.key);
    if (item) quickToggle(item);
  },

  'item:menu': (el) => openItemMenu(registry.get(el.dataset.key)),
};

export function openItemMenu(item) {
  if (!item) return;
  const d = store.data;
  const paid = item.status === 'paid';
  const ym = ymOf(item.dueDate);
  const actions = paid
    ? [{ label: 'Desmarcar pagamento', icon: 'undo-2', run: () => quickToggle(item) }]
    : [
      { label: `Pagar ${formatBRL(item.cents)}`, hint: 'Escolher a data, o valor e a conta', icon: 'circle-check', run: () => payDialog(item) },
      { label: 'Marcar como pago hoje', icon: 'check', run: () => quickToggle(item) },
    ];

  if (item.kind === 'expense') {
    const expense = d.expenses.find((e) => e.id === item.refId);
    actions.push({ label: 'Editar', icon: 'pencil', run: () => E.editExpense(expense) });
    if (!paid) actions.push({ label: 'Adiar', icon: 'calendar-clock', run: () => E.postponeExpenseDialog(expense) });
    actions.push({ label: 'Anexos', hint: 'Foto do comprovante ou do boleto', icon: 'paperclip', run: () => E.attachmentsDialog(expense) });
    actions.push({ label: 'Excluir', icon: 'trash-2', danger: true, run: () => E.deleteWithUndo(() => A.deleteExpense(expense.id), `"${expense.description}" excluída.`) });
  }

  if (item.kind === 'recurring') {
    const rec = d.recurring.find((r) => r.id === item.refId);
    const key = item.entryKey ? item.entryKey.split('|')[1] : ym;
    actions.push(
      { label: rec.variable ? 'Informar o valor da conta' : 'Ajustar valor deste mês', hint: rec.variable ? 'A estimativa é a média dos últimos meses' : 'Ex.: a conta de luz veio diferente', icon: 'banknote', run: () => E.adjustRecurringMonth(item) },
      { label: 'Pular este mês', icon: 'skip-forward', run: () => { A.skipRecurringMonth(rec.id, key, true); toast(`${rec.description} pulada em ${formatMonth(ym)}.`, { action: { label: 'Desfazer', run: () => A.skipRecurringMonth(rec.id, key, false) } }); } },
      { label: 'Editar recorrente', icon: 'pencil', run: () => E.editRecurring(rec) },
      { label: 'Encerrar após este mês', icon: 'lock', run: async () => {
        const ok = await confirmDialog({ title: 'Encerrar recorrente', message: `"${rec.description}" deixará de aparecer depois de ${formatMonth(ym)}. O histórico é mantido.`, confirmLabel: 'Encerrar' });
        if (ok) { A.endRecurring(rec.id, ym); toast('Recorrente encerrada.', { action: { label: 'Desfazer', run: () => store.undo() } }); }
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

  if (item.kind === 'invoice') {
    actions.push({ label: 'Ver a fatura', icon: 'receipt', run: () => E.invoiceDetails(item.refId, ym) });
  }

  actionSheet({ title: item.description, subtitle: `${formatBRL(item.cents)} · vence ${formatDateBR(item.dueDate)}`, actions });
}
