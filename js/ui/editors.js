// =============================================================
// editors.js — Janelas de cadastro/edição de cada tipo de dado
// -------------------------------------------------------------
// Qualquer tela pode abrir estes formulários. Toda gravação
// passa por domain/actions.js (que valida).
// =============================================================

import { html } from './dom.js';
import { openDialog, confirmDialog, actionSheet } from './dialog.js';
import { toast } from './toast.js';
import {
  field, moneyField, dateField, monthField, numberField, textareaField,
  categoryFields, bindCategorySelects, creditorField, readForm,
} from './forms.js';
import { store } from '../core/store.js';
import { toCents, formatBRL } from '../core/money.js';
import {
  todayISO, currentYM, dateInMonth, formatDateBR, formatMonth, ymOf, addDaysISO, parseISO, nextPayday,
} from '../core/dates.js';
import * as A from '../domain/actions.js';
import { installmentSummary, entryKey, goalPlan, planInstallment } from '../domain/ledger.js';
import { CATEGORY_ICONS, CATEGORY_COLORS } from '../domain/defaults.js';
import { quickMovement } from './investEditors.js';

const data = () => store.data;

/** Data padrão para novos lançamentos: hoje, se o mês exibido for o atual; senão dia 1 do mês exibido. */
function defaultDate() {
  const ym = store.ui.ym;
  return ym === currentYM() ? todayISO() : dateInMonth(ym, 1);
}

// ---------- Menu "Novo" ----------

export function openNewMenu() {
  actionSheet({
    title: 'Novo lançamento',
    actions: [
      { label: 'Conta a pagar', hint: 'Despesa avulsa com vencimento', icon: 'receipt', run: () => editExpense() },
      { label: 'Gasto já pago', hint: 'Registrar algo que você já pagou', icon: 'circle-check', run: () => editExpense(null, { paid: true }) },
      { label: 'Despesa recorrente', hint: 'Todo mês: aluguel, internet, streaming…', icon: 'repeat', run: () => editRecurring() },
      { label: 'Parcelamento', hint: 'Compra parcelada no cartão ou carnê', icon: 'credit-card', run: () => editInstallment() },
      { label: 'Renda extra', hint: 'Plantão, freela, bônus…', icon: 'stethoscope', run: () => editExtraIncome() },
      { label: 'Aporte em investimento', hint: 'CDB, Tesouro, ações, FII, cripto…', icon: 'coins', run: () => quickMovement('aporte') },
      { label: 'Importar extrato', hint: 'OFX ou CSV do banco / fatura do cartão', icon: 'file-up', run: () => { location.hash = '#/importar'; } },
      { label: 'Lançamento rápido', hint: 'Escreva "mercado 120 ontem" · Ctrl+K', icon: 'zap', run: () => document.dispatchEvent(new CustomEvent('dhenors:palette')) },
    ],
  });
}

// ---------- Despesa avulsa ----------

export function editExpense(expense = null, { paid = false } = {}) {
  const e = expense || { description: '', cents: null, dueDate: defaultDate(), paidAt: paid ? defaultDate() : null };
  const isPaid = Boolean(e.paidAt);
  openDialog({
    title: expense ? 'Editar despesa' : (paid ? 'Registrar gasto pago' : 'Nova conta a pagar'),
    submitLabel: expense ? 'Salvar' : 'Adicionar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: e.description, required: true, placeholder: 'Ex.: Conta de luz', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor', name: 'cents', cents: e.cents })}
        ${dateField({ label: isPaid && !expense ? 'Data do pagamento' : 'Vencimento', name: 'dueDate', value: e.dueDate })}
        ${categoryFields(data(), e)}
        ${creditorField(data(), e.creditorId)}
        <div class="field field--full">
          <label class="check"><input type="checkbox" name="paid" ${isPaid ? 'checked' : ''}> Já está pago</label>
        </div>
        ${textareaField({ label: 'Observação', name: 'notes', value: e.notes || '' })}
      </div>`,
    onMount: (dlg) => bindCategorySelects(dlg, data()),
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveExpense({
        ...v, id: expense?.id, cents: toCents(v.cents),
        paidAt: v.paid ? (expense?.paidAt || (v.dueDate <= todayISO() ? v.dueDate : todayISO())) : null,
      });
      toast(expense ? 'Despesa atualizada.' : 'Despesa adicionada.');
    },
  });
}

export function postponeExpenseDialog(expense) {
  openDialog({
    title: 'Adiar conta',
    size: 'sm',
    submitLabel: 'Adiar',
    body: html`
      <p class="dialog__text">${expense.description} · ${formatBRL(expense.cents)}</p>
      ${dateField({ label: 'Nova data de vencimento', name: 'dueDate', value: addDaysISO(expense.dueDate, 7) })}`,
    onSubmit: (form) => {
      A.postponeExpense(expense.id, form.dueDate.value);
      toast(`Adiada para ${formatDateBR(form.dueDate.value)}.`);
    },
  });
}

// ---------- Recorrente ----------

export function editRecurring(rec = null) {
  const r = rec || { description: '', cents: null, dueDay: 10, startYM: store.ui.ym, endYM: null };
  openDialog({
    title: rec ? 'Editar recorrente' : 'Nova despesa recorrente',
    submitLabel: rec ? 'Salvar' : 'Adicionar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: r.description, required: true, placeholder: 'Ex.: Internet, Aluguel', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor mensal', name: 'cents', cents: r.cents, hint: 'Se variar em algum mês, ajuste só aquele mês na lista de contas.' })}
        ${numberField({ label: 'Dia do vencimento', name: 'dueDay', value: r.dueDay, min: 1, max: 31, hint: 'Em meses mais curtos, vence no último dia.' })}
        ${monthField({ label: 'Começa em', name: 'startYM', value: r.startYM })}
        ${monthField({ label: 'Termina em (opcional)', name: 'endYM', value: r.endYM || '', required: false, hint: 'Deixe vazio se não tem fim.' })}
        ${categoryFields(data(), r)}
        ${creditorField(data(), r.creditorId)}
        ${textareaField({ label: 'Observação', name: 'notes', value: r.notes || '' })}
      </div>`,
    onMount: (dlg) => bindCategorySelects(dlg, data()),
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveRecurring({ ...v, id: rec?.id, cents: toCents(v.cents), dueDay: Number(v.dueDay), endYM: v.endYM || null });
      toast(rec ? 'Recorrente atualizada.' : 'Recorrente adicionada.');
    },
  });
}

/** Ajusta o valor de uma recorrente só em um mês. */
export function adjustRecurringMonth(item) {
  const ym = ymOf(item.dueDate);
  const rec = data().recurring.find((r) => r.id === item.refId);
  const entry = data().recurringEntries[entryKey(item.refId, ym)];
  openDialog({
    title: `Valor de ${formatMonth(ym)}`,
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text">${rec.description} · valor padrão ${formatBRL(rec.cents)}</p>
      ${moneyField({ label: 'Valor neste mês', name: 'cents', cents: entry?.cents ?? rec.cents })}`,
    footer: entry?.cents != null ? html`<button type="button" class="btn btn--ghost" data-reset>Voltar ao padrão</button>` : '',
    onMount: (dlg) => dlg.querySelector('[data-reset]')?.addEventListener('click', () => {
      A.setRecurringMonthAmount(item.refId, ym, null);
      dlg.close();
      toast('Valor padrão restaurado.');
    }),
    onSubmit: (form) => {
      A.setRecurringMonthAmount(item.refId, ym, toCents(form.cents.value));
      toast('Valor do mês ajustado.');
    },
  });
}

// ---------- Parcelamento ----------

export function editInstallment(inst = null) {
  // Valores iniciais: na edição, deduz parcela, pagas e próximo vencimento do cadastro atual
  let init;
  if (inst) {
    const s = installmentSummary(inst);
    init = {
      ...inst,
      parcelCents: Math.round(inst.totalCents / inst.count),
      paidCount: s.paidCount,
      nextDueDate: s.nextOpen?.dueDate || nextPayday(inst.dueDay),
      dueDay: inst.dueDay,
    };
  } else {
    init = { description: '', parcelCents: null, count: 10, paidCount: 0, dueDay: 10, nextDueDate: nextPayday(10) };
  }
  let nextTouched = Boolean(inst); // se o usuário mexer na data, paramos de sugerir

  openDialog({
    title: inst ? 'Editar parcelamento' : 'Novo parcelamento',
    submitLabel: inst ? 'Salvar' : 'Adicionar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: init.description, required: true, placeholder: 'Ex.: Celular, Geladeira', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor da parcela', name: 'parcelCents', cents: init.parcelCents })}
        ${numberField({ label: 'Nº de parcelas', name: 'count', value: init.count, min: 1, max: 420 })}
        ${numberField({ label: 'Parcelas já pagas', name: 'paidCount', value: init.paidCount, min: 0, max: 420, hint: 'Compra nova? Deixe 0.' })}
        ${numberField({ label: 'Dia do vencimento', name: 'dueDay', value: init.dueDay, min: 1, max: 31 })}
        ${dateField({ label: 'Próxima parcela a pagar vence em', name: 'nextDueDate', value: init.nextDueDate, hint: 'Calculada pelo dia do vencimento. Ajuste se já pagou a deste mês.' })}
        <div class="field field--full"><div class="preview preview--plan" data-preview aria-live="polite"></div></div>
        ${categoryFields(data(), init)}
        ${creditorField(data(), init.creditorId)}
        ${textareaField({ label: 'Observação', name: 'notes', value: init.notes || '' })}
      </div>`,
    onMount: (dlg) => {
      bindCategorySelects(dlg, data());
      const form = dlg.querySelector('form');
      const preview = dlg.querySelector('[data-preview]');

      const read = () => ({
        parcelCents: toCents(form.parcelCents.value),
        count: Number(form.count.value),
        paidCount: Number(form.paidCount.value || 0),
        nextDueDate: form.nextDueDate.value,
        dueDay: Number(form.dueDay.value),
      });

      const update = () => {
        const v = read();
        if (!Number.isFinite(v.parcelCents) || v.parcelCents <= 0 || !Number.isInteger(v.count) || v.count < 1 || v.count > 420
          || !Number.isInteger(v.paidCount) || v.paidCount < 0 || v.paidCount > v.count || !parseISO(v.nextDueDate)) {
          preview.textContent = 'Preencha o valor da parcela, o nº de parcelas e quantas já pagou para ver o resumo.';
          return;
        }
        const plan = planInstallment(v);
        const remaining = v.count - v.paidCount;
        preview.innerHTML = html`
          <dl class="plan">
            <div><dt>Valor total</dt><dd class="money">${formatBRL(plan.totalCents)}</dd></div>
            <div><dt>Começou em</dt><dd>${formatDateBR(plan.firstDueDate)}</dd></div>
            <div><dt>Termina em</dt><dd>${formatDateBR(plan.lastDueDate)}</dd></div>
            <div><dt>Falta pagar</dt><dd class="money">${remaining ? `${remaining}× · ${formatBRL(remaining * v.parcelCents)}` : 'quitado'}</dd></div>
          </dl>
          ${remaining ? html`<p class="small">Próxima: parcela <strong>${v.paidCount + 1}/${v.count}</strong> em ${formatDateBR(v.nextDueDate)}</p>` : ''}`.toString();
      };

      // Mudar o dia → recalcula a próxima data (até o usuário editar a data à mão)
      form.dueDay.addEventListener('input', () => {
        const day = Number(form.dueDay.value);
        if (!nextTouched && Number.isInteger(day) && day >= 1 && day <= 31) form.nextDueDate.value = nextPayday(day);
        else if (nextTouched && Number.isInteger(day) && day >= 1 && day <= 31 && parseISO(form.nextDueDate.value)) {
          form.nextDueDate.value = dateInMonth(ymOf(form.nextDueDate.value), day);
        }
      });
      // Mudar a data → acompanha o dia
      form.nextDueDate.addEventListener('change', () => {
        nextTouched = true;
        const p = parseISO(form.nextDueDate.value);
        // só copia o dia se não for o fim de um mês curto (ex.: 28/02 com vencimento dia 31)
        if (p && !(Number(form.dueDay.value) > p.d && dateInMonth(ymOf(form.nextDueDate.value), Number(form.dueDay.value)) === form.nextDueDate.value)) form.dueDay.value = p.d;
      });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const parcelCents = toCents(v.parcelCents);
      const count = Number(v.count);
      // Na edição, se a parcela e a quantidade não mudaram, preserva o total exato original
      const keepTotalCents = inst && count === inst.count && parcelCents === init.parcelCents ? inst.totalCents : undefined;
      A.saveInstallment({
        ...v, id: inst?.id, parcelCents, count, keepTotalCents,
        paidCount: Number(v.paidCount || 0), nextDueDate: v.nextDueDate, dueDay: Number(v.dueDay),
      });
      toast(inst ? 'Parcelamento atualizado.' : 'Parcelamento adicionado.');
    },
  });
}

/** Cronograma com marcação individual de parcelas. */
export function installmentDetails(instId) {
  const render = () => {
    const inst = data().installments.find((x) => x.id === instId);
    if (!inst) return html`<p>Parcelamento removido.</p>`;
    const s = installmentSummary(inst);
    return html`
      <div class="kv">
        <div><span>Total</span><strong>${formatBRL(inst.totalCents)}</strong></div>
        <div><span>Pago</span><strong class="pos">${formatBRL(s.paidCents)}</strong></div>
        <div><span>Restante</span><strong>${formatBRL(s.remainingCents)}</strong></div>
        <div><span>Termina</span><strong>${formatDateBR(s.lastDueDate)}</strong></div>
      </div>
      <ol class="schedule">
        ${s.schedule.map((p) => html`
          <li class="schedule__row ${p.paid ? 'is-paid' : ''}">
            <label class="check">
              <input type="checkbox" data-parcel="${p.n}" ${p.paid ? 'checked' : ''}>
              <span>${p.n}/${inst.count}</span>
            </label>
            <span class="schedule__date">${formatDateBR(p.dueDate)}</span>
            <span class="schedule__value">${formatBRL(p.cents)}</span>
          </li>`)}
      </ol>`;
  };
  const inst = data().installments.find((x) => x.id === instId);
  const { dialog } = openDialog({ title: inst.description, body: render(), size: 'md' });
  const body = dialog.querySelector('.dialog__body');
  body.addEventListener('change', (ev) => {
    const box = ev.target.closest('[data-parcel]');
    if (!box) return;
    A.setParcelPaid(instId, Number(box.dataset.parcel), box.checked);
    const scroll = body.scrollTop;
    body.innerHTML = render().toString();
    body.scrollTop = scroll;
  });
}

// ---------- Renda extra ----------

export function editExtraIncome(income = null) {
  const x = income || { description: 'Plantão', cents: null, date: defaultDate(), payroll: true };
  openDialog({
    title: income ? 'Editar renda extra' : 'Nova renda extra',
    size: 'sm',
    submitLabel: income ? 'Salvar' : 'Adicionar',
    body: html`
      ${field({ label: 'Descrição', name: 'description', value: x.description, required: true, extra: { maxlength: 120, list: 'extra-suggestions' } })}
      <datalist id="extra-suggestions"><option value="Plantão"><option value="Plantão extra"><option value="Hora extra"><option value="Freela"><option value="Bônus"><option value="Venda"></datalist>
      ${moneyField({ label: 'Valor', name: 'cents', cents: x.cents })}
      ${dateField({ label: 'Data', name: 'date', value: x.date || dateInMonth(x.ym, 1), hint: 'Conta como renda do mês desta data.' })}
      <div class="field">
        <label class="check"><input type="checkbox" name="payroll" ${x.payroll ? 'checked' : ''}> Pago na folha (valor bruto)</label>
        <p class="field__hint">Marcado: o app soma ao salário e desconta INSS e IR. Desmarcado: valor já líquido (ex.: freela, venda).</p>
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveExtraIncome({ ...v, id: income?.id, cents: toCents(v.cents) });
      toast(income ? 'Renda atualizada.' : 'Renda extra adicionada.');
    },
  });
}

// ---------- Salário (contracheque) e meta de gastos ----------

export { editSalaryBase, editPayrollLine } from './payrollEditor.js';

export function editSpendingLimit() {
  openDialog({
    title: 'Meta de gastos do mês',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Um teto para o total de contas do mês. Você recebe um alerta ao chegar a 80%.</p>
      ${moneyField({ label: 'Limite mensal', name: 'cents', cents: data().settings.spendingLimitCents, required: false, hint: 'Deixe vazio para desativar.' })}`,
    onSubmit: (form) => {
      A.setSpendingLimit(form.cents.value.trim() ? toCents(form.cents.value) : 0);
      toast('Meta de gastos salva.');
    },
  });
}

// ---------- Metas (objetivos) ----------

const GOAL_ICONS = ['🎯', '✈️', '🏠', '🚗', '🎓', '💍', '🛡️', '💻', '📱', '🏖️', '👶', '🐷'];

export function editGoal(goal = null) {
  const g = goal || { description: '', targetCents: null, deadline: '', icon: '🎯' };
  openDialog({
    title: goal ? 'Editar meta' : 'Nova meta',
    submitLabel: goal ? 'Salvar' : 'Criar meta',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Objetivo', name: 'description', value: g.description, required: true, placeholder: 'Ex.: Reserva de emergência', full: true, extra: { maxlength: 120 } })}
        ${moneyField({ label: 'Valor da meta', name: 'targetCents', cents: g.targetCents })}
        ${dateField({ label: 'Prazo (opcional)', name: 'deadline', value: g.deadline || '', required: false, min: todayISO() })}
        ${goal ? '' : moneyField({ label: 'Já guardado (opcional)', name: 'initialCents', required: false })}
        ${iconPicker('icon', GOAL_ICONS, g.icon)}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveGoal({
        ...v, id: goal?.id, targetCents: toCents(v.targetCents), deadline: v.deadline || null,
        initialCents: v.initialCents ? toCents(v.initialCents) : 0,
      });
      toast(goal ? 'Meta atualizada.' : 'Meta criada.');
    },
  });
}

export function contributeGoal(goal, withdraw = false) {
  const plan = goalPlan(goal);
  openDialog({
    title: withdraw ? `Retirar de "${goal.description}"` : `Guardar em "${goal.description}"`,
    size: 'sm',
    submitLabel: withdraw ? 'Retirar' : 'Guardar',
    body: html`
      <p class="dialog__text muted">Guardado: ${formatBRL(plan.saved)} de ${formatBRL(goal.targetCents)}
        ${plan.perMonth ? html` · sugestão: ${formatBRL(plan.perMonth)}/mês` : ''}</p>
      ${moneyField({ label: 'Valor', name: 'cents', cents: !withdraw && plan.perMonth ? plan.perMonth : null })}
      ${dateField({ label: 'Data', name: 'date', value: todayISO() })}`,
    onSubmit: (form) => {
      const value = toCents(form.cents.value);
      if (!Number.isFinite(value) || value <= 0) throw new A.ValidationError('Informe um valor.', 'cents');
      A.addContribution(goal.id, withdraw ? -value : value, form.date.value);
      toast(withdraw ? 'Retirada registrada.' : 'Valor guardado. 🎉');
    },
  });
}

// ---------- Credor ----------

export function editCreditor(creditor = null) {
  openDialog({
    title: creditor ? 'Editar credor' : 'Novo credor',
    size: 'sm',
    submitLabel: creditor ? 'Salvar' : 'Adicionar',
    body: html`
      ${field({ label: 'Nome', name: 'name', value: creditor?.name || '', required: true, placeholder: 'Ex.: Banco, loja, pessoa', extra: { maxlength: 80 } })}
      ${textareaField({ label: 'Observação', name: 'notes', value: creditor?.notes || '', hint: 'Chave Pix, telefone, contrato…' })}`,
    onSubmit: (form) => {
      A.saveCreditor({ ...readForm(form), id: creditor?.id });
      toast(creditor ? 'Credor atualizado.' : 'Credor adicionado.');
    },
  });
}

// ---------- Categoria ----------

export function editCategory(category = null) {
  const c = category || { name: '', icon: '🏷️', color: CATEGORY_COLORS[data().categories.length % CATEGORY_COLORS.length] };
  openDialog({
    title: category ? 'Editar categoria' : 'Nova categoria',
    submitLabel: category ? 'Salvar' : 'Criar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: c.name, required: true, full: true, extra: { maxlength: 60 } })}
        ${iconPicker('icon', CATEGORY_ICONS, c.icon)}
        <fieldset class="field field--full picker">
          <legend class="field__label">Cor</legend>
          <div class="swatches">
            ${CATEGORY_COLORS.map((color) => html`
              <label class="swatch" style="--swatch:${color}">
                <input type="radio" name="color" value="${color}" ${color === c.color ? 'checked' : ''}>
                <span class="sr-only">${color}</span>
              </label>`)}
          </div>
        </fieldset>
      </div>`,
    onSubmit: (form) => {
      A.saveCategory({ ...readForm(form), color: form.querySelector('[name="color"]:checked')?.value, icon: form.querySelector('[name="icon"]:checked')?.value, id: category?.id });
      toast(category ? 'Categoria atualizada.' : 'Categoria criada.');
    },
  });
}

export function editSubcategory(categoryId, sub = null) {
  openDialog({
    title: sub ? 'Renomear subcategoria' : 'Nova subcategoria',
    size: 'sm',
    submitLabel: 'Salvar',
    body: field({ label: 'Nome', name: 'name', value: sub?.name || '', required: true, extra: { maxlength: 60 } }),
    onSubmit: (form) => {
      A.saveSubcategory(categoryId, { id: sub?.id, name: form.name.value });
      toast('Subcategoria salva.');
    },
  });
}

function iconPicker(name, icons, selected) {
  const list = icons.includes(selected) ? icons : [selected, ...icons];
  return html`
    <fieldset class="field field--full picker">
      <legend class="field__label">Ícone</legend>
      <div class="emoji-grid">
        ${list.map((e) => html`
          <label class="emoji-opt">
            <input type="radio" name="${name}" value="${e}" ${e === selected ? 'checked' : ''}>
            <span aria-hidden="true">${e}</span><span class="sr-only">${e}</span>
          </label>`)}
      </div>
    </fieldset>`;
}

// ---------- Exclusões com confirmação ----------

export async function confirmDelete(what, run) {
  const ok = await confirmDialog({ title: 'Excluir', message: `Excluir ${what}? Essa ação não pode ser desfeita.`, confirmLabel: 'Excluir', danger: true });
  if (ok) { run(); toast('Excluído.'); }
}

