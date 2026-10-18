// =============================================================
// editors/income.js — Receitas (plantão, freela, reembolso…) e meta de gastos
// =============================================================

import { html } from '../dom.js';
import { openDialog } from '../dialog.js';
import { toast } from '../toast.js';
import { field, moneyField, dateField, monthField, numberField, selectField, accountField, readForm } from '../forms.js';
import { store } from '../../core/store.js';
import { toCents } from '../../core/money.js';
import { dateInMonth, ymOf } from '../../core/dates.js';
import * as A from '../../domain/actions.js';
import { INCOME_KIND_LABELS } from '../../domain/defaults.js';
import { defaultDate, deleteWithUndo } from './bills.js';

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
        ${income ? '' : html`
          <div class="field field--full" data-repeat>
            <label class="check"><input type="checkbox" name="repeat"> Repete todo mês (ganho fora da folha)</label>
            <p class="field__hint">Aluguel recebido, pensão, freela fixo… Entra sozinho em todos os meses e nas previsões.</p>
          </div>
          <div data-repeat-end hidden>${monthField({ label: 'Até (opcional)', name: 'endYM', value: '', required: false, hint: 'Deixe vazio se não tem data para acabar.' })}</div>`}
      </div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => {
        const inPayroll = ['plantao', 'extra'].includes(form.kind.value);
        dlg.querySelector('[data-payroll]').hidden = !inPayroll;
        if (!inPayroll) form.payroll.checked = false;
        const repeat = dlg.querySelector('[data-repeat]');
        if (repeat) {
          // Só ganhos fora da folha se repetem aqui (o que vem do empregador fica no salário)
          repeat.hidden = form.payroll.checked || form.kind.value === 'plantao';
          if (repeat.hidden) form.repeat.checked = false;
          dlg.querySelector('[data-repeat-end]').hidden = !form.repeat.checked;
        }
      };
      form.kind.addEventListener('change', () => {
        sync();
        const label = INCOME_KIND_LABELS[form.kind.value];
        if (!form.description.value || Object.values(INCOME_KIND_LABELS).includes(form.description.value)) form.description.value = label;
      });
      form.addEventListener('change', sync);
      sync();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      if (!income && form.repeat?.checked) {
        A.saveRecurringIncome({
          description: v.description, cents: toCents(v.cents), kind: v.kind, accountId: v.accountId,
          day: Number(String(v.date).slice(8, 10)) || 1, startYM: ymOf(v.date), endYM: v.endYM || null,
        });
        toast('Receita recorrente adicionada: entra todo mês.');
        return;
      }
      A.saveExtraIncome({ ...v, id: income?.id, cents: toCents(v.cents) });
      toast(income ? 'Receita atualizada.' : 'Receita adicionada.');
    },
  });
}

/** Ganho extra que se repete todo mês (fora da folha). */
export function editRecurringIncome(rec = null) {
  const r = rec || { description: 'Renda extra', cents: null, day: 5, startYM: store.ui.ym, endYM: null, kind: 'extra' };
  const kinds = Object.entries(INCOME_KIND_LABELS).filter(([k]) => k !== 'plantao').map(([value, label]) => ({ value, label }));
  openDialog({
    title: rec ? 'Editar receita recorrente' : 'Nova receita recorrente',
    size: 'sm',
    submitLabel: rec ? 'Salvar' : 'Adicionar',
    body: html`
      <p class="dialog__text muted">Ganho fora da folha que se repete todo mês. O valor é líquido (não passa por INSS/IR).</p>
      <div class="form-grid">
        ${selectField({ label: 'Tipo', name: 'kind', value: r.kind, options: kinds })}
        ${field({ label: 'Descrição', name: 'description', value: r.description, required: true, extra: { maxlength: 120 } })}
        ${moneyField({ label: 'Valor por mês', name: 'cents', cents: r.cents })}
        ${numberField({ label: 'Dia em que entra', name: 'day', value: r.day, min: 1, max: 31 })}
        ${monthField({ label: 'Desde', name: 'startYM', value: r.startYM })}
        ${monthField({ label: 'Até (opcional)', name: 'endYM', value: r.endYM || '', required: false, hint: 'Deixe vazio se não tem data para acabar.' })}
        ${accountField(data(), r.accountId, { label: 'Entra na conta (opcional)' })}
      </div>`,
    footer: rec ? html`<button type="button" class="btn btn--ghost danger" data-del>Excluir</button>` : '',
    onMount: (dlg) => dlg.querySelector('[data-del]')?.addEventListener('click', () => {
      dlg.close();
      deleteWithUndo(() => A.deleteRecurringIncome(rec.id), `"${rec.description}" excluída.`);
    }),
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveRecurringIncome({ ...v, id: rec?.id, cents: toCents(v.cents), day: Number(v.day), endYM: v.endYM || null });
      toast(rec ? 'Receita recorrente atualizada.' : 'Receita recorrente adicionada.');
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
