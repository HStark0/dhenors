// =============================================================
// pay.js — Marcar contas como pagas
// -------------------------------------------------------------
// • Toque no círculo: paga HOJE, com "Desfazer" no aviso.
// • "Pagar…" (menu, Enter na lista, deslizar): janela com a DATA
//   real do pagamento, o valor pago (recorrentes variáveis e
//   faturas podem vir diferentes) e a conta de onde saiu. O botão
//   mostra o valor: "Pagar R$ 1.400,00".
// • Ao pagar: vibração leve (celular), check animado e aviso falado
//   para leitores de tela.
// =============================================================

import { html } from './dom.js';
import { openDialog } from './dialog.js';
import { toast, announce } from './toast.js';
import { dateField, moneyField, accountField, maskCents } from './forms.js';
import { store } from '../core/store.js';
import { formatBRL, toCents } from '../core/money.js';
import { todayISO, formatDateBR } from '../core/dates.js';
import { motionReduced } from '../core/theme.js';
import * as A from '../domain/actions.js';

/** Vibração curta (se o aparelho e a preferência permitirem). */
export function buzz(pattern = 18) {
  if (motionReduced()) return;
  try { navigator.vibrate?.(pattern); } catch { /* sem suporte */ }
}

/** Anima o check da linha que acabou de ser paga. */
function celebrate(key) {
  requestAnimationFrame(() => {
    const btn = document.querySelector(`.pay-btn[data-key="${CSS.escape(key)}"]`);
    if (!btn) return;
    btn.classList.remove('is-popping');
    void btn.offsetWidth;
    btn.classList.add('is-popping');
  });
}

/** Paga hoje (ou desfaz) direto, com "Desfazer". */
export function quickToggle(item) {
  const paid = item.status !== 'paid';
  A.setItemPaid(item, paid, todayISO());
  if (paid) { buzz(); celebrate(item.key); }
  const msg = paid ? `${item.description} marcada como paga.` : `Pagamento de ${item.description} desfeito.`;
  announce(msg);
  toast(msg, { action: { label: 'Desfazer', run: () => A.setItemPaid({ ...item, status: paid ? 'paid' : item.status }, !paid, item.paidAt || todayISO()) } });
}

/** Janela de pagamento com data, valor e conta. */
export function payDialog(item) {
  const d = store.data;
  const valueEditable = item.kind === 'recurring' || item.kind === 'invoice';
  const label = (cents) => `Pagar ${formatBRL(cents)}`;
  openDialog({
    title: 'Registrar pagamento',
    size: 'sm',
    submitLabel: label(item.cents),
    body: html`
      <p class="dialog__text"><strong>${item.description}</strong>${item.parcel ? ` · parcela ${item.parcel.n}/${item.parcel.count}` : ''} · vence ${formatDateBR(item.dueDate)}</p>
      <div class="form-grid">
        ${dateField({ label: 'Data do pagamento', name: 'paidAt', value: todayISO(), max: todayISO(), hint: item.dueDate < todayISO() ? `Venceu em ${formatDateBR(item.dueDate)}: informe o dia em que pagou de verdade.` : '' })}
        ${valueEditable ? moneyField({ label: 'Valor pago', name: 'cents', cents: item.cents, hint: item.estimated ? 'Valor estimado pela média: confirme o da conta.' : '' }) : ''}
        ${accountField(d, item.accountId || '', { label: 'Pago com (conta)' })}
      </div>`,
    onMount: (dlg) => {
      const btn = dlg.querySelector('[type="submit"]');
      dlg.querySelector('[name="cents"]')?.addEventListener('input', (ev) => {
        const v = toCents(ev.target.value);
        btn.textContent = Number.isFinite(v) && v > 0 ? label(v) : 'Pagar';
      });
    },
    onSubmit: (form) => {
      const paidAt = form.paidAt.value;
      const cents = valueEditable ? toCents(form.cents.value) : null;
      if (valueEditable && (!Number.isFinite(cents) || cents <= 0)) throw new A.ValidationError('Informe o valor pago.', 'cents');
      A.setItemPaid(item, true, paidAt, { cents, accountId: form.accountId ? form.accountId.value || null : undefined });
      buzz();
      celebrate(item.key);
      const msg = `${item.description} paga em ${formatDateBR(paidAt)}${cents && cents !== item.cents ? ` (${formatBRL(cents)})` : ''}.`;
      announce(msg);
      toast(msg, { action: { label: 'Desfazer', run: () => A.setItemPaid({ ...item, status: 'paid' }, false) } });
    },
  });
}

/** Texto do valor para o botão (exportado para quem monta botões de pagar). */
export const payLabel = (cents) => `Pagar R$ ${maskCents(cents)}`;
