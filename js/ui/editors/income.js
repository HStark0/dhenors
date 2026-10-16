// =============================================================
// editors/income.js — Receitas (plantão, freela, reembolso…) e meta de gastos
// =============================================================

import { html } from '../dom.js';
import { openDialog } from '../dialog.js';
import { toast } from '../toast.js';
import { field, moneyField, dateField, selectField, accountField, readForm } from '../forms.js';
import { store } from '../../core/store.js';
import { toCents } from '../../core/money.js';
import { dateInMonth } from '../../core/dates.js';
import * as A from '../../domain/actions.js';
import { INCOME_KIND_LABELS } from '../../domain/defaults.js';
import { defaultDate } from './bills.js';

const data = () => store.data;

/** Receita além do salário. Plantão/hora extra podem ser "na folha" (bruto, paga INSS/IR). */
export function editExtraIncome(income = null, { preset = {} } = {}) {
  const x = income || { description: 'Plantão', cents: null, date: defaultDate(), payroll: true, kind: 'plantao', ...preset };
  openDialog({
    title: income ? 'Editar receita' : 'Nova receita',
    size: 'sm',
    submitLabel: income ? 'Salvar' : 'Adicionar',
    body: html`
      <div class="form-grid">
        ${selectField({ label: 'Tipo', name: 'kind', value: x.kind || (x.payroll ? 'plantao' : 'extra'), options: Object.entries(INCOME_KIND_LABELS).map(([value, label]) => ({ value, label })) })}
        ${field({ label: 'Descrição', name: 'description', value: x.description, required: true, extra: { maxlength: 120, list: 'extra-suggestions' } })}
        <datalist id="extra-suggestions"><option value="Plantão"><option value="Plantão extra"><option value="Hora extra"><option value="Freela"><option value="Bônus"><option value="Venda"><option value="Reembolso"><option value="Presente"><option value="Rendimento da poupança"></datalist>
        ${moneyField({ label: 'Valor', name: 'cents', cents: x.cents })}
        ${dateField({ label: 'Data', name: 'date', value: x.date || dateInMonth(x.ym, 1), hint: 'Conta como renda do mês desta data.' })}
        ${accountField(data(), x.accountId, { label: 'Entrou na conta (opcional)' })}
        <div class="field field--full" data-payroll>
          <label class="check"><input type="checkbox" name="payroll" ${x.payroll ? 'checked' : ''}> Pago na folha (valor bruto)</label>
          <p class="field__hint">Marcado: o app soma ao salário e desconta INSS e IR. Desmarcado: valor já líquido (ex.: freela, venda).</p>
        </div>
      </div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => {
        const inPayroll = ['plantao', 'extra'].includes(form.kind.value);
        dlg.querySelector('[data-payroll]').hidden = !inPayroll;
        if (!inPayroll) form.payroll.checked = false;
      };
      form.kind.addEventListener('change', () => {
        sync();
        const label = INCOME_KIND_LABELS[form.kind.value];
        if (!form.description.value || Object.values(INCOME_KIND_LABELS).includes(form.description.value)) form.description.value = label;
      });
      sync();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveExtraIncome({ ...v, id: income?.id, cents: toCents(v.cents) });
      toast(income ? 'Receita atualizada.' : 'Receita adicionada.');
    },
  });
}

export function editSpendingLimit() {
  openDialog({
    title: 'Meta de gastos do mês',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Um teto para o total de contas do mês. Você recebe um alerta ao chegar a 80% e o Painel mostra o ritmo dos gastos.</p>
      ${moneyField({ label: 'Limite mensal', name: 'cents', cents: data().settings.spendingLimitCents, required: false, hint: 'Deixe vazio para desativar.' })}`,
    onSubmit: (form) => {
      A.setSpendingLimit(form.cents.value.trim() ? toCents(form.cents.value) : 0);
      toast('Meta de gastos salva.');
    },
  });
}
