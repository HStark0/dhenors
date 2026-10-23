// =============================================================
// editors/wallet.js — Cartões, compras no cartão, faturas,
// contas/carteiras, transferências e conferência de saldo
// =============================================================

import { html } from '../dom.js';
import { icon } from '../icons.js';
import { openDialog } from '../dialog.js';
import { toast } from '../toast.js';
import {
  field, moneyField, dateField, numberField, selectField, switchField, textareaField,
  categoryFields, bindCategorySelects, readForm, tagsField, accountField, cardField,
  splitsField, bindSplits, readSplits,
} from '../forms.js';
import { catIcon } from '../catIcon.js';
import { payDialog } from '../pay.js';
import { store } from '../../core/store.js';
import { toCents, formatBRL } from '../../core/money.js';
import { todayISO, formatDateBR, formatMonth } from '../../core/dates.js';
import * as A from '../../domain/actions.js';
import { invoice, invoiceMonthFor, invoiceDates } from '../../domain/cards.js';
import { ACCOUNT_KIND_LABELS } from '../../domain/accounts.js';
import { computeMonth } from '../../domain/ledger.js';
import { defaultDate, knownTags, deleteWithUndo } from './bills.js';
import { bindImpact, flagBadges } from '../outlookUI.js';
import { purchaseFlags } from '../../domain/weights.js';

const data = () => store.data;
const COLORS = ['#7C3AED', '#8A05BE', '#EC7000', '#CC092F', '#0B2C5F', '#0F766E', '#111827', '#2563EB', '#16A34A', '#DB2777'];

function colorPicker(name, selected) {
  return html`
    <fieldset class="field field--full picker">
      <legend class="field__label">Cor</legend>
      <div class="swatches">
        ${COLORS.map((c) => html`<label class="swatch" style="--swatch:${c}"><input type="radio" name="${name}" value="${c}" ${c === selected ? 'checked' : ''}><span class="sr-only">${c}</span></label>`)}
      </div>
    </fieldset>`;
}

// ---------- Cartões ----------

export function editCard(card = null) {
  const c = card || { name: '', closingDay: 1, dueDay: 10, limitCents: null, color: COLORS[0] };
  openDialog({
    title: card ? 'Editar cartão' : 'Novo cartão de crédito',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: c.name, required: true, full: true, placeholder: 'Ex.: Nubank, Inter, Itaú Visa', extra: { maxlength: 60 } })}
        ${numberField({ label: 'Dia de fechamento', name: 'closingDay', value: c.closingDay, min: 1, max: 31, hint: 'Compras a partir deste dia vão para a fatura seguinte.' })}
        ${numberField({ label: 'Dia de vencimento', name: 'dueDay', value: c.dueDay, min: 1, max: 31 })}
        ${moneyField({ label: 'Limite (opcional)', name: 'limitCents', cents: c.limitCents, required: false })}
        ${accountField(data(), c.accountId, { label: 'Fatura paga pela conta (opcional)' })}
        ${colorPicker('color', c.color)}
        ${card ? switchField({ label: 'Arquivar (não uso mais)', name: 'archived', checked: c.archived }) : ''}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveCard({ ...v, id: card?.id, closingDay: Number(v.closingDay), dueDay: Number(v.dueDay), limitCents: v.limitCents ? toCents(v.limitCents) : 0, color: form.querySelector('[name="color"]:checked')?.value });
      toast(card ? 'Cartão atualizado.' : 'Cartão adicionado. Lance as compras em "Novo → Compra no cartão".');
    },
  });
}

/** Compra no cartão (à vista, parcelada ou estorno). */
export function editPurchase(purchase = null, { cardId = null, preset = {} } = {}) {
  const cards = (data().cards || []).filter((c) => !c.archived || c.id === purchase?.cardId);
  if (!cards.length) { editCard(); return; }
  const p = purchase || { cardId: cardId || cards[0].id, description: '', date: defaultDate(), cents: null, count: 1, tags: [], splits: [], ...preset };
  const refund = (p.cents || 0) < 0;
  openDialog({
    title: purchase ? 'Editar compra no cartão' : 'Compra no cartão',
    submitLabel: purchase ? 'Salvar' : 'Lançar',
    body: html`
      <div class="form-grid">
        ${cardField(data(), p.cardId)}
        ${field({ label: 'Descrição', name: 'description', value: p.description, required: true, placeholder: 'Ex.: Mercado, Celular', extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor total', name: 'cents', cents: p.cents ? Math.abs(p.cents) : null })}
        ${numberField({ label: 'Parcelas', name: 'count', value: p.count || 1, min: 1, max: 48, hint: 'À vista = 1.' })}
        ${dateField({ label: 'Data da compra', name: 'date', value: p.date })}
        ${switchField({ label: 'É um estorno (devolução)', name: 'refund', checked: refund })}
        <div class="field field--full"><p class="preview" data-invoice aria-live="polite"></p></div>
        <div class="field field--full" data-impact aria-live="polite"></div>
        ${categoryFields(data(), p)}
        ${splitsField(data(), p.splits || [])}
        ${tagsField({ value: p.tags || [], suggestions: knownTags() })}
        ${textareaField({ label: 'Observação', name: 'notes', value: p.notes || '' })}
      </div>`,
    onMount: (dlg) => {
      bindCategorySelects(dlg, data());
      bindSplits(dlg, data());
      const form = dlg.querySelector('form');
      const out = dlg.querySelector('[data-invoice]');
      const update = () => {
        const card = data().cards.find((c) => c.id === form.cardId.value);
        if (!card || !form.date.value) { out.textContent = ''; return; }
        const ym = invoiceMonthFor(card, form.date.value);
        const { closing, due } = invoiceDates(card, ym);
        const n = Number(form.count.value) || 1;
        const v = toCents(form.cents.value);
        out.innerHTML = html`Entra na fatura de <strong>${formatMonth(ym)}</strong> (fecha ${formatDateBR(closing)}, vence ${formatDateBR(due)})${n > 1 && Number.isFinite(v) ? html` · ${n}× de <strong>${formatBRL(Math.round(v / n))}</strong>` : ''}.`.toString();
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
      // Faturas em que a compra entra, destacando os meses que ficam apertados
      bindImpact(form, dlg.querySelector('[data-impact]'), (f) => {
        const cents = toCents(f.cents.value);
        const count = Number(f.count.value) || 1;
        if (f.refund.checked || !Number.isFinite(cents) || cents <= 0 || !f.date.value || !f.cardId.value || count < 1 || count > 48) return null;
        return { kind: 'card', cardId: f.cardId.value, date: f.date.value, cents, count, replace: purchase ? { kind: 'card', id: purchase.id } : null };
      });
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const value = toCents(v.cents);
      const r = A.saveCardPurchase({ ...v, id: purchase?.id, cents: v.refund ? -value : value, count: Number(v.count), splits: readSplits(form) });
      toast(purchase ? 'Compra atualizada.' : `Compra lançada${r?.invoiceYM ? ` na fatura de ${formatMonth(r.invoiceYM)}` : ''}.`);
    },
  });
}

/** Fatura do mês: compras, parcelas, total e pagamento. */
export function invoiceDetails(cardId, ym) {
  const render = () => {
    const card = data().cards.find((c) => c.id === cardId);
    const inv = invoice(data(), card, ym, todayISO());
    const item = computeMonth(data(), ym, todayISO()).items.find((i) => i.kind === 'invoice' && i.refId === cardId);
    return html`
      <div class="kv kv--4">
        <div><span>Total</span><strong class="money">${formatBRL(inv.total)}</strong></div>
        <div><span>Fecha</span><strong>${formatDateBR(inv.closing)}</strong></div>
        <div><span>Vence</span><strong>${formatDateBR(inv.due)}</strong></div>
        <div><span>Situação</span><strong>${inv.paidAt ? `Paga em ${formatDateBR(inv.paidAt)}` : inv.status === 'closed' ? 'Fechada' : 'Aberta'}</strong></div>
      </div>
      ${inv.lines.length ? html`
        <ul class="mini-list">
          ${inv.lines.map((l) => {
            const cat = data().categories.find((c) => c.id === l.purchase.categoryId);
            return html`
              <li>
                <span>${catIcon(cat, { size: 'xs' })} ${l.purchase.description}
                  <small class="muted">${formatDateBR(l.purchase.date)}${l.count > 1 ? ` · ${l.n}/${l.count}` : ''}${l.purchase.recurringId ? ' · assinatura' : ''}</small>
                  ${l.purchase.recurringId || l.purchase.locked ? '' : flagBadges(purchaseFlags(data(), l.purchase))}</span>
                <span class="money ${l.cents < 0 ? 'pos' : ''}">${l.cents < 0 ? '−' : ''}${formatBRL(Math.abs(l.cents))}</span>
                <span class="mini-list__actions">
                  ${l.purchase.recurringId || l.purchase.locked ? '' : html`
                    <button type="button" class="icon-btn icon-btn--sm" data-edit="${l.purchase.id}" aria-label="Editar ${l.purchase.description}">${icon('pencil')}</button>
                    <button type="button" class="icon-btn icon-btn--sm danger" data-del="${l.purchase.id}" aria-label="Excluir ${l.purchase.description}">${icon('trash-2')}</button>`}
                </span>
              </li>`;
          })}
        </ul>` : html`<p class="muted">Nenhuma compra nesta fatura.</p>`}
      <div class="card__actions">
        <button type="button" class="btn btn--secondary btn--sm" data-add>${icon('plus', 'icon--xs')} Compra</button>
        ${item && !inv.paidAt ? html`<button type="button" class="btn btn--primary btn--sm" data-pay>Pagar ${formatBRL(item.cents)}</button>` : ''}
      </div>`;
  };
  const card = data().cards.find((c) => c.id === cardId);
  const { dialog, close } = openDialog({ title: `Fatura ${card.name} · ${formatMonth(ym)}`, size: 'md', body: render() });
  const body = dialog.querySelector('.dialog__body');
  const unsub = store.subscribe(() => { if (dialog.open) body.innerHTML = render().toString(); });
  dialog.addEventListener('close', unsub);
  body.addEventListener('click', (ev) => {
    const edit = ev.target.closest('[data-edit]');
    if (edit) editPurchase(data().cardPurchases.find((p) => p.id === edit.dataset.edit));
    const del = ev.target.closest('[data-del]');
    if (del) deleteWithUndo(() => A.deleteCardPurchase(del.dataset.del), 'Compra excluída.');
    if (ev.target.closest('[data-add]')) editPurchase(null, { cardId });
    if (ev.target.closest('[data-pay]')) {
      const item = computeMonth(data(), ym, todayISO()).items.find((i) => i.kind === 'invoice' && i.refId === cardId);
      close();
      payDialog(item);
    }
  });
}

// ---------- Contas e carteiras ----------

export function editAccount(account = null) {
  const a = account || { name: '', kind: 'corrente', institution: '', color: '#0891B2', anchor: { cents: null, date: todayISO() } };
  openDialog({
    title: account ? 'Editar conta bancária' : 'Nova conta bancária ou carteira',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: a.name, required: true, placeholder: 'Ex.: Nubank, Conta-salário, Dinheiro', extra: { maxlength: 60 } })}
        ${selectField({ label: 'Tipo', name: 'kind', value: a.kind, options: Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => ({ value, label })) })}
        ${field({ label: 'Banco (opcional)', name: 'institution', value: a.institution, extra: { maxlength: 60 } })}
        ${moneyField({ label: 'Saldo de hoje (ou da data abaixo)', name: 'anchorCents', cents: a.anchor?.cents, negative: true, hint: 'Como aparece no app do banco. Negativo: digite "-".' })}
        ${dateField({ label: 'Data desse saldo', name: 'anchorDate', value: a.anchor?.date || todayISO() })}
        ${switchField({ label: 'Meu salário cai nesta conta', name: 'salary', checked: data().settings.salaryAccountId === account?.id })}
        ${colorPicker('color', a.color)}
        ${account ? switchField({ label: 'Arquivar', name: 'archived', checked: a.archived }) : ''}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      const saved = A.saveAccount({ ...v, id: account?.id, anchorCents: toCents(v.anchorCents || '0') || 0, color: form.querySelector('[name="color"]:checked')?.value });
      const id = account?.id || saved?.id;
      if (v.salary) A.setSalaryAccount(id);
      else if (data().settings.salaryAccountId === id) A.setSalaryAccount(null);
      toast('Conta salva.');
    },
  });
}

export function transferDialog(preset = {}) {
  const accs = (data().accounts || []).filter((a) => !a.archived);
  if (accs.length < 2) {
    toast('Cadastre pelo menos duas contas (Carteira → Contas) para transferir.', { type: 'info' });
    if (!accs.length) editAccount();
    return;
  }
  const opts = accs.map((a) => ({ value: a.id, label: a.name }));
  openDialog({
    title: 'Transferência entre contas',
    size: 'sm',
    submitLabel: 'Transferir',
    body: html`
      <div class="form-grid">
        ${selectField({ label: 'De', name: 'fromId', value: preset.fromId || accs[0].id, options: opts })}
        ${selectField({ label: 'Para', name: 'toId', value: preset.toId || accs[1].id, options: opts })}
        ${moneyField({ label: 'Valor', name: 'cents' })}
        ${dateField({ label: 'Data', name: 'date', value: todayISO() })}
        ${field({ label: 'Observação (opcional)', name: 'note', full: true, extra: { maxlength: 120 } })}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveTransfer({ ...v, cents: toCents(v.cents) });
      toast('Transferência registrada.');
    },
  });
}

/** Saldo real × previsto: informa o saldo do banco e vê a diferença. */
export function balanceCheckDialog(account, expected) {
  openDialog({
    title: `Conferir saldo · ${account.name}`,
    size: 'sm',
    submitLabel: 'Conferir',
    body: html`
      <p class="dialog__text muted">O app espera <strong>${formatBRL(expected)}</strong> hoje. Abra o app do banco e digite o saldo que aparece lá.</p>
      ${moneyField({ label: 'Saldo no banco', name: 'cents', negative: true })}
      ${switchField({ label: 'Usar este saldo daqui em diante (zera a diferença)', name: 'adjust', checked: true, hint: 'Desligado: só registra a conferência para você ver a diferença.' })}`,
    onSubmit: (form) => {
      const v = toCents(form.cents.value);
      if (!Number.isFinite(v)) throw new A.ValidationError('Informe o saldo.', 'cents');
      A.checkBalance(account.id, v, todayISO(), { adjust: form.adjust.checked });
      const diff = v - expected;
      toast(diff === 0 ? 'Saldo confere com o previsto.' : `Diferença de ${formatBRL(Math.abs(diff))} (${diff > 0 ? 'sobrando' : 'faltando'} no banco).${form.adjust.checked ? ' Saldo ajustado.' : ''}`, { type: diff === 0 ? 'success' : 'info', duration: 8000 });
    },
  });
}
