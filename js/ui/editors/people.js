// =============================================================
// editors/people.js — Credores, "quem me deve" e dívidas
// =============================================================

import { html } from '../dom.js';
import { openDialog } from '../dialog.js';
import { toast } from '../toast.js';
import { field, moneyField, dateField, selectField, textareaField, readForm } from '../forms.js';
import { store } from '../../core/store.js';
import { toCents, formatBRL } from '../../core/money.js';
import { todayISO } from '../../core/dates.js';
import * as A from '../../domain/actions.js';

const data = () => store.data;

export function editCreditor(creditor = null) {
  openDialog({
    title: creditor ? 'Editar pessoa ou empresa' : 'Nova pessoa ou empresa',
    size: 'sm',
    submitLabel: creditor ? 'Salvar' : 'Adicionar',
    body: html`
      ${field({ label: 'Nome', name: 'name', value: creditor?.name || '', required: true, placeholder: 'Ex.: Banco, loja, pessoa', extra: { maxlength: 80 } })}
      ${textareaField({ label: 'Observação', name: 'notes', value: creditor?.notes || '', hint: 'Chave Pix, telefone, contrato…' })}`,
    onSubmit: (form) => {
      A.saveCreditor({ ...readForm(form), id: creditor?.id });
      toast(creditor ? 'Atualizado.' : 'Adicionado.');
    },
  });
}

const personOptions = () => [{ value: '', label: 'Outra pessoa' }, ...data().creditors.map((c) => ({ value: c.id, label: c.name }))];

/** "Alguém me deve": empréstimo para amigo, venda a receber, reembolso pendente. */
export function editReceivable(r = null) {
  const x = r || { creditorId: '', person: '', description: 'Empréstimo', cents: null, date: todayISO(), dueDate: '' };
  openDialog({
    title: r ? 'Editar valor a receber' : 'Alguém me deve',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${selectField({ label: 'Quem', name: 'creditorId', value: x.creditorId || '', options: personOptions() })}
        <div data-person ${x.creditorId ? 'hidden' : ''}>${field({ label: 'Nome', name: 'person', value: x.person, extra: { maxlength: 80 } })}</div>
        ${field({ label: 'Descrição', name: 'description', value: x.description, required: true, extra: { maxlength: 120 } })}
        ${moneyField({ label: 'Valor', name: 'cents', cents: x.cents })}
        ${dateField({ label: 'Data do empréstimo', name: 'date', value: x.date })}
        ${dateField({ label: 'Devolve até (opcional)', name: 'dueDate', value: x.dueDate || '', required: false, hint: 'Data combinada: aparece na Agenda e nos lembretes.' })}
        ${textareaField({ label: 'Observação', name: 'notes', value: x.notes || '' })}
      </div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      form.creditorId.addEventListener('change', () => { dlg.querySelector('[data-person]').hidden = Boolean(form.creditorId.value); });
    },
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveReceivable({ ...v, id: r?.id, cents: toCents(v.cents), dueDate: v.dueDate || null });
      toast('Salvo em "A receber".');
    },
  });
}

export function receiveDialog(r) {
  const left = r.cents - (r.partials || []).reduce((a, p) => a + p.cents, 0);
  openDialog({
    title: `Recebi de ${r.person}`,
    size: 'sm',
    submitLabel: 'Registrar',
    body: html`
      <p class="dialog__text muted">${r.description} · falta receber ${formatBRL(left)}</p>
      ${moneyField({ label: 'Valor recebido', name: 'cents', cents: left })}
      ${dateField({ label: 'Data', name: 'date', value: todayISO() })}`,
    onSubmit: (form) => {
      A.receivePayment(r.id, toCents(form.cents.value), form.date.value);
      toast('Recebimento registrado.');
    },
  });
}

/** Dívida/renegociação: saldo devedor, juros ao mês e parcela. */
export function editDebt(debt = null) {
  const x = debt || { name: '', creditorId: '', balanceCents: null, rateMonthlyBp: null, paymentCents: null, installmentId: '' };
  openDialog({
    title: debt ? 'Editar dívida' : 'Nova dívida',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: x.name, required: true, placeholder: 'Ex.: Cartão rotativo, Empréstimo pessoal', extra: { maxlength: 80 } })}
        ${selectField({ label: 'Credor', name: 'creditorId', value: x.creditorId || '', options: [{ value: '', label: 'Nenhum' }, ...data().creditors.map((c) => ({ value: c.id, label: c.name }))] })}
        ${moneyField({ label: 'Saldo devedor hoje', name: 'balanceCents', cents: x.balanceCents })}
        ${field({ label: 'Juros ao mês (%)', name: 'rate', value: x.rateMonthlyBp != null ? (x.rateMonthlyBp / 100).toLocaleString('pt-BR') : '', placeholder: 'Ex.: 2,5', extra: { inputmode: 'decimal' }, hint: 'Está no contrato ou no app do banco (CET mensal).' })}
        ${moneyField({ label: 'Parcela/pagamento por mês', name: 'paymentCents', cents: x.paymentCents, required: false })}
        ${selectField({ label: 'É um parcelamento já lançado?', name: 'installmentId', value: x.installmentId || '', options: [{ value: '', label: 'Não' }, ...data().installments.map((i) => ({ value: i.id, label: i.description }))] })}
        ${textareaField({ label: 'Observação', name: 'notes', value: x.notes || '' })}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveDebt({
        ...v, id: debt?.id, balanceCents: toCents(v.balanceCents), paymentCents: v.paymentCents ? toCents(v.paymentCents) : 0,
        rateMonthlyBp: Math.round(parseFloat(String(v.rate || '0').replace(',', '.')) * 100) || 0,
      });
      toast('Dívida salva.');
    },
  });
}
