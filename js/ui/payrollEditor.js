// =============================================================
// payrollEditor.js — Janelas do salário e o contracheque
// -------------------------------------------------------------
// • editSalaryBase(ym)            salário base bruto, dependentes, dia
// • editPayrollLine(ym, kind, l)  adicional ('add') ou desconto ('ded'),
//                                 inclusive consignado parcelado
// • payslipHTML(payroll)          contracheque formatado
// A tela completa fica em views/salary.js.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { field, moneyField, monthField, numberField, dateField, selectField, switchField, segmentedField } from './forms.js';
import { store } from '../core/store.js';
import { toCents, centsToInput, formatBRL, formatPercent, percent } from '../core/money.js';
import { addMonthsYM, monthsBetween, formatMonthShort, formatDateBR, weekdayLong } from '../core/dates.js';
import { payrollProfileFor, computePayroll, loanEndYM, employmentOf, variableFor, thirteenthMonths, paydayOf, paydayForCompetence, HOUR_KINDS, daysFor } from '../domain/payroll.js';
import { tablesFor } from '../domain/taxTables.js';
import * as A from '../domain/actions.js';

export const ADDITION_SUGGESTIONS = ['Insalubridade', 'Periculosidade', 'Adicional noturno', 'Horas extras 50%', 'Horas extras 100%', 'Sobreaviso', 'Gratificação de função', 'Anuênio', 'Quinquênio', '1/3 de férias', 'Auxílio-alimentação', 'Prêmio / bonificação'];
export const DEDUCTION_SUGGESTIONS = ['Plano de saúde', 'Plano odontológico', 'Vale-transporte', 'Empréstimo consignado', 'Contribuição sindical', 'Previdência privada', 'Pensão alimentícia', 'Coparticipação', 'Faltas e atrasos', 'Vale-alimentação', 'Adiantamento salarial'];
/** Nomes que costumam variar de mês a mês (sugerem "variável"). */
const VARIABLE_HINT = /noturno|hora|extra|sobreaviso|f[ée]rias|pr[êe]mio|bonifica|falta|atraso|copartic|adiantamento/i;

/** "20" / "20,5" → 2000 / 2050 (centésimos de %). */
export function parsePercent(text) {
  const n = parseFloat(String(text).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const percentToInput = (bp) => (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** "10" / "10:30" / "10h30" / "10,5" → minutos (630). */
export function parseHours(text) {
  const t = String(text).trim().toLowerCase().replace(/\s/g, '');
  let m = /^(\d{1,3})[:h](\d{1,2})m?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Math.min(59, Number(m[2]));
  m = /^(\d{1,3})(?:[.,](\d{1,2}))?h?$/.exec(t);
  if (m) return Math.round((Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0)) * 60);
  return NaN;
}
export const hoursToInput = (min) => (min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : String(min / 60));

// ---------- Contracheque (HTML) ----------

/**
 * Contracheque formatado.
 * @param p        resultado de computePayroll
 * @param outside  rendas extras fora da folha
 * @param o.thirteenth  13º do mês (opcional)  · o.actual  líquido conferido (opcional)
 */
export function payslipHTML(p, outside = [], { thirteenth = null, actual = null } = {}) {
  if (p.legacyNet) {
    return html`
      <div class="note">${icon('info')}<span>Este salário foi cadastrado na versão anterior como valor <strong>líquido</strong>.
      Edite o salário base para informar o bruto e o app passa a calcular INSS e IR.</span></div>`;
  }
  const outsideTotal = outside.reduce((s, x) => s + x.cents, 0);
  return html`
    <div class="payslip">
      <div class="payslip__group">
        <p class="payslip__head">${icon('trending-up', 'icon--xs')} Proventos</p>
        ${(p.baseLines?.length ? p.baseLines : (p.base ? [{ description: 'Salário base', detail: '', cents: p.base }] : [])).map((l) => row(l.description, l.detail, l.cents))}
        ${p.additions.map((a) => row(a.description, [a.detail, a.auto ? 'automático' : a.variable ? 'variável' : '', a.taxable ? '' : 'sem impostos'].filter(Boolean).join(' · '), a.cents))}
        ${p.extras ? row('Plantões / extras na folha', '', p.extras) : ''}
        <div class="payslip__row payslip__row--sub"><span>Bruto</span><span class="money">${formatBRL(p.gross)}</span></div>
      </div>
      <div class="payslip__group">
        <p class="payslip__head">${icon('trending-down', 'icon--xs')} Descontos</p>
        ${row(p.inssLabel, p.inssLabel === 'INSS'
          ? `faixa ${formatPercent(p.inssBand)} · efetivo ${formatPercent(percent(p.inss, p.taxable), 2)}`
          : `${formatPercent(p.inssBand, 2)} sobre ${formatBRL(p.taxable)}`, -p.inss)}
        ${row('Imposto de Renda', `base ${formatBRL(p.ir.base)} · ${p.ir.method}${p.ir.reduction ? ` · redução de ${formatBRL(p.ir.reduction)}` : ''}`, -p.ir.value, p.ir.value ? '' : 'isento')}
        ${p.deductions.map((d) => row(d.description, [d.detail, d.variable ? 'variável' : '', d.irDeductible ? 'dedutível do IR' : ''].filter(Boolean).join(' · '), -d.cents))}
      </div>
      <div class="payslip__net">
        <span>Líquido da folha${actual != null ? html`<small>estimado: ${formatBRL(p.net)}</small>` : ''}</span>
        <strong class="money">${formatBRL(actual ?? p.net)}</strong>
      </div>
      ${actual != null && actual !== p.net ? html`<p class="payslip__diff ${actual < p.net ? 'neg' : 'pos'}">Você conferiu ${formatBRL(actual)} no holerite: ${actual < p.net ? 'menos' : 'mais'} ${formatBRL(Math.abs(actual - p.net))} que a estimativa.</p>` : ''}
      ${thirteenth ? html`
        <div class="payslip__group">
          <p class="payslip__head">${icon('sparkles', 'icon--xs')} ${thirteenth.label}</p>
          ${row('13º bruto do ano', `${thirteenth.avos}/12 avos`, thirteenth.gross)}
          ${thirteenth.part === 2 ? html`
            ${row('1ª parcela (já paga em novembro)', '', -thirteenth.first)}
            ${row(p.inssLabel + ' sobre o 13º', '', -thirteenth.inss)}
            ${row('IR sobre o 13º', 'tributação exclusiva', -thirteenth.ir, thirteenth.ir ? '' : 'isento')}` : ''}
          <div class="payslip__row payslip__row--sub"><span>A receber</span><span class="money pos">${formatBRL(thirteenth.net)}</span></div>
        </div>` : ''}
      ${p.bases ? html`
        <dl class="payslip__bases" aria-label="Bases de cálculo">
          <div><dt>Sal. base</dt><dd class="money">${formatBRL(p.bases.salary)}</dd></div>
          <div><dt>Base INSS</dt><dd class="money">${formatBRL(p.bases.inss)}</dd></div>
          ${p.bases.fgts ? html`<div><dt>Base FGTS</dt><dd class="money">${formatBRL(p.bases.fgts)}</dd></div>
          <div><dt>FGTS do mês</dt><dd class="money">${formatBRL(p.fgts)}</dd></div>` : ''}
          <div><dt>Base IRRF</dt><dd class="money">${formatBRL(p.bases.irrf)}</dd></div>
        </dl>` : ''}
      ${p.fgts ? html`<p class="payslip__fgts">${icon('piggy-bank', 'icon--xs')} <span class="muted">O FGTS (8%) é depositado pela empresa e não sai do seu salário.</span></p>` : ''}
      ${outside.length ? html`
        <div class="payslip__group">
          ${outside.map((x) => row(x.description, 'fora da folha', x.cents))}
          <div class="payslip__row payslip__row--sub"><span>Renda do mês</span><span class="money">${formatBRL(p.net + outsideTotal)}</span></div>
        </div>` : ''}
    </div>
    <p class="field__hint">Estimativa com as tabelas de ${p.year}. Pode diferir do holerite oficial se houver verbas que não foram lançadas aqui.</p>`;
}

function row(label, detail, cents, text = '') {
  return html`
    <div class="payslip__row">
      <span>${label}${detail ? html`<small>${detail}</small>` : ''}</span>
      <span class="money ${cents < 0 ? 'neg' : ''}">${text || (cents < 0 ? `−${formatBRL(-cents)}` : formatBRL(cents))}</span>
    </div>`;
}

// ---------- Salário base ----------

export function editSalaryBase(ym = store.ui.ym) {
  const s = store.data.settings;
  const current = payrollProfileFor(s, ym);
  const emp = employmentOf(s);
  const pay = paydayOf(s);
  openDialog({
    title: 'Salário e vínculo',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Informe o valor <strong>bruto</strong> (antes de INSS e IR), como aparece no contracheque.</p>
      <div class="form-grid">
        ${moneyField({ label: 'Salário base bruto', name: 'grossCents', cents: current && !current.legacyNet ? current.grossCents : null, required: false, full: true,
          hint: current?.legacyNet ? `Antes você informou ${formatBRL(current.grossCents)} já líquido.` : '' })}
        ${monthField({ label: 'Vale a partir de', name: 'fromYM', value: ym, hint: 'Meses anteriores continuam com o valor antigo.' })}
        ${numberField({ label: 'Dependentes (IR)', name: 'dependents', value: current?.dependents || 0, min: 0, max: 20, hint: 'R$ 189,59 de dedução cada.' })}
      </div>

      <h3 class="dialog__subtitle">Quando o salário cai</h3>
      <div class="form-grid">
        ${segmentedField({ label: 'Data de recebimento', name: 'paydayMode', value: pay.mode, options: [{ value: 'fixed', label: 'Dia fixo do mês' }, { value: 'business', label: 'Dia útil (ex.: 5º)' }] })}
        <div data-when-pay="fixed" ${pay.mode === 'fixed' ? '' : 'hidden'}>
          ${numberField({ label: 'Dia do pagamento', name: 'salaryDay', value: s.salaryDay, min: 1, max: 31, hint: 'Em meses mais curtos, vale o último dia.' })}
        </div>
        <div data-when-pay="business" ${pay.mode === 'business' ? '' : 'hidden'}>
          ${numberField({ label: 'Qual dia útil', name: 'paydayNth', value: pay.nth, min: 1, max: 10, hint: 'CLT: até o 5º dia útil (art. 459).' })}
        </div>
        <div class="field--full" data-when-pay="business" ${pay.mode === 'business' ? '' : 'hidden'}>
          ${switchField({ label: 'Sábado conta como dia útil', name: 'paydaySaturday', checked: pay.saturday, hint: 'Regra do Ministério do Trabalho para salário. Domingos e feriados nacionais nunca contam.' })}
        </div>
        <div class="field--full">
          ${switchField({ label: 'O salário do mês cai no mês seguinte', name: 'paydayNext', checked: pay.nextMonth, hint: 'Ex.: o holerite de setembro (competência 09) é pago em outubro. A renda passa a entrar no mês em que o dinheiro cai.' })}
        </div>
        <p class="field--full field__hint" data-payday-preview aria-live="polite"></p>
      </div>

      <h3 class="dialog__subtitle">Vínculo</h3>
      <div class="form-grid">
        ${segmentedField({ label: 'Previdência', name: 'regime', value: emp.regime, options: [{ value: 'inss', label: 'INSS (CLT)' }, { value: 'fixed', label: 'Alíquota fixa' }] })}
        <div class="field" data-when-fixed ${emp.regime === 'fixed' ? '' : 'hidden'}>
          <label class="field__label" for="emp-rate">Alíquota da previdência</label>
          <div class="field__control has-prefix">
            <span class="field__prefix" aria-hidden="true">%</span>
            <input class="input" id="emp-rate" name="fixedRate" inputmode="decimal" value="${percentToInput(emp.fixedRateBp)}" autocomplete="off">
          </div>
          <p class="field__hint">Servidor público (RPPS), ex.: 14%.</p>
        </div>
        ${dateField({ label: 'Data de admissão', name: 'admission', value: emp.admission || '', required: false, hint: 'Usada para o 13º proporcional.' })}
        ${numberField({ label: 'Divisor de horas', name: 'hoursDivisor', value: emp.hoursDivisor || 220, min: 100, max: 300, hint: 'Valor da hora = salário ÷ divisor. CLT 44 h/semana: 220.' })}
        ${numberField({ label: 'Filhos até 14 anos', name: 'familyChildren', value: emp.familyChildren || 0, min: 0, max: 20, hint: 'Para o salário-família (só para quem ganha até o limite do ano).' })}
        ${switchField({ label: 'Calcular 13º salário automaticamente', name: 'thirteenth', checked: emp.thirteenth, hint: '1ª parcela em novembro e 2ª em dezembro, já com descontos.' })}
      </div>
      <div class="preview" data-preview aria-live="polite"></div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const update = () => {
        const regime = form.querySelector('[name="regime"]:checked').value;
        dlg.querySelector('[data-when-fixed]').hidden = regime !== 'fixed';
        const mode = form.querySelector('[name="paydayMode"]:checked').value;
        dlg.querySelectorAll('[data-when-pay]').forEach((el) => { el.hidden = el.dataset.whenPay !== mode; });
        const paySettings = { ...s, salaryDay: Number(form.salaryDay.value) || s.salaryDay, payday: { mode, nth: Number(form.paydayNth.value) || 5, saturday: form.paydaySaturday.checked, nextMonth: form.paydayNext.checked } };
        const comps = [0, 1, 2].map((i) => addMonthsYM(ym, i));
        dlg.querySelector('[data-payday-preview]').textContent = `Pagamentos: ${comps.map((m) => { const dt = paydayForCompetence(paySettings, m); return `${formatMonthShort(m)} → ${formatDateBR(dt)} (${weekdayLong(dt).slice(0, 3)})`; }).join(' · ')}`;
        const gross = toCents(form.grossCents.value || '0');
        const from = form.fromYM.value || ym;
        const profile = { ...(current || { additions: [], deductions: [] }), legacyNet: false, grossCents: Number.isFinite(gross) ? gross : 0, dependents: Number(form.dependents.value) || 0 };
        const employment = { regime, fixedRateBp: parsePercent(form.fixedRate.value) || 0, hoursDivisor: Number(form.hoursDivisor.value) || 220, familyChildren: Number(form.familyChildren.value) || 0 };
        const p = computePayroll(profile, from, { loans: s.payrollLoans || [], variable: variableFor(s, from), employment, ...daysFor(s, from) });
        const avos = thirteenthMonths(form.admission.value, Number(from.slice(0, 4)));
        dlg.querySelector('[data-preview]').innerHTML = html`Líquido estimado: <strong>${formatBRL(p.net)}</strong>
          <span class="muted"> · ${p.inssLabel} ${formatBRL(p.inss)}${regime === 'inss' ? ` (faixa ${formatPercent(p.inssBand)})` : ''} · IR ${formatBRL(p.ir.value)}</span>
          ${form.thirteenth.checked ? html`<br><span class="muted">13º de ${from.slice(0, 4)}: ${avos}/12 avos</span>` : ''}`.toString();
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },
    onSubmit: (form) => {
      const regime = form.querySelector('[name="regime"]:checked').value;
      A.saveEmployment({
        admission: form.admission.value || null,
        regime,
        fixedRateBp: parsePercent(form.fixedRate.value),
        thirteenth: form.thirteenth.checked,
        hoursDivisor: Number(form.hoursDivisor.value) || 220,
        familyChildren: Number(form.familyChildren.value || 0),
      });
      A.savePayrollBase({
        fromYM: form.fromYM.value,
        grossCents: form.grossCents.value.trim() ? toCents(form.grossCents.value) : 0,
        dependents: Number(form.dependents.value || 0),
      });
      A.savePayday({
        mode: form.querySelector('[name="paydayMode"]:checked').value,
        salaryDay: Number(form.salaryDay.value) || s.salaryDay,
        nth: Number(form.paydayNth.value) || 5,
        saturday: form.paydaySaturday.checked,
        nextMonth: form.paydayNext.checked,
      });
      toast('Salário salvo.');
    },
  });
}

// ---------- Adicional / desconto ----------

/**
 * kind: 'add' (adicional) | 'ded' (desconto em folha)
 * line: a linha existente (edição) ou null (nova)
 */
export function editPayrollLine(ym, kind, line = null) {
  const isAdd = kind === 'add';
  const l = line || (isAdd
    ? { description: '', mode: 'percent', value: null, base: 'minimum', taxable: true }
    : { description: '', mode: 'fixed', value: null, base: 'salary', irDeductible: false });
  const loanPaidBefore = l.loan ? Math.max(0, Math.min(l.loan.count, monthsBetween(l.loan.startYM, ym))) : 0;
  const isVariable = Boolean(l.ym);
  const suggestions = isAdd ? ADDITION_SUGGESTIONS : DEDUCTION_SUGGESTIONS;

  openDialog({
    title: line ? (isAdd ? 'Editar adicional' : 'Editar desconto') : (isAdd ? 'Novo adicional' : 'Novo desconto em folha'),
    submitLabel: line ? 'Salvar' : 'Adicionar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: l.description, required: true, full: true,
          placeholder: isAdd ? 'Ex.: Insalubridade' : 'Ex.: Plano de saúde', extra: { maxlength: 60, autocomplete: 'off', list: `${kind}-suggest` } })}
        <datalist id="${kind}-suggest">${suggestions.map((x) => html`<option value="${x}">`)}</datalist>

        <div class="field--full" data-recurrence>
          ${segmentedField({ label: 'Recorrência', name: 'recurrence', value: isVariable ? 'variable' : 'fixed', options: [
            { value: 'fixed', label: `Fixo · todo mês desde ${formatMonthShort(ym)}` },
            { value: 'variable', label: `Variável · só em ${formatMonthShort(ym)}` },
          ] })}
        </div>

        ${segmentedField({ label: 'Tipo de valor', name: 'mode', value: l.mode, options: [{ value: 'fixed', label: 'Valor em R$' }, { value: 'percent', label: 'Percentual' }, ...(isAdd ? [{ value: 'hours', label: 'Horas' }] : [])] })}
        <div class="field">
          <label class="field__label" for="pl-value" data-value-label>${l.mode === 'hours' ? 'Horas no mês' : 'Valor'}</label>
          <div class="field__control has-prefix">
            <span class="field__prefix" aria-hidden="true" data-prefix>${l.mode === 'percent' ? '%' : l.mode === 'hours' ? 'h' : 'R$'}</span>
            <input class="input" id="pl-value" name="value" inputmode="decimal" autocomplete="off" required
              value="${l.value == null ? '' : l.mode === 'percent' ? percentToInput(l.value) : l.mode === 'hours' ? hoursToInput(l.value) : centsToInput(l.value)}">
          </div>
          <p class="field__hint" data-when-hours ${l.mode === 'hours' ? '' : 'hidden'}>Ex.: 100, 12:30 ou 7,5</p>
        </div>

        ${isAdd ? html`
          <div class="field--full form-grid loan-fields" data-when-hours ${l.mode === 'hours' ? '' : 'hidden'}>
            ${selectField({ label: 'Tipo de hora', name: 'hourKind', value: l.hourKind || 'he50', options: Object.entries(HOUR_KINDS).map(([k, v]) => ({ value: k, label: k === 'sobreaviso' ? 'Sobreaviso (1/3 da hora)' : k === 'noturno' ? 'Adicional noturno (20%, hora reduzida)' : k === 'custom' ? 'Outro percentual da hora' : v.label })) })}
            <div class="field" data-when-custom ${l.hourKind === 'custom' ? '' : 'hidden'}>
              <label class="field__label" for="pl-hpct">Percentual da hora</label>
              <div class="field__control has-prefix">
                <span class="field__prefix" aria-hidden="true">%</span>
                <input class="input" id="pl-hpct" name="hourPct" inputmode="decimal" autocomplete="off" value="${l.hourPct ? percentToInput(l.hourPct) : '150'}">
              </div>
              <p class="field__hint">Ex.: 150 = hora + 50%</p>
            </div>
            ${switchField({ label: 'Calcular o DSR (descanso semanal) sobre estas horas', name: 'dsr', checked: l.dsr ?? true, hint: 'Horas extras habituais refletem no domingo e nos feriados do mês.' })}
            <p class="field__hint field--full">Valor da hora = salário ÷ ${employmentOf(store.data.settings).hoursDivisor || 220} (horas extras e noturno incluem os adicionais fixos, como periculosidade). O divisor muda em "Salário e vínculo".</p>
          </div>` : ''}

        <div class="field--full" data-when-percent ${l.mode === 'percent' ? '' : 'hidden'}>
          ${selectField({ label: 'Calculado sobre', name: 'base', value: l.base, options: isAdd
            ? [{ value: 'minimum', label: `Salário mínimo (${formatBRL(Math.round(tablesFor(Number(ym.slice(0, 4))).minimumWage * 100))})` }, { value: 'salary', label: 'Salário base' }]
            : [{ value: 'salary', label: 'Salário base' }, { value: 'gross', label: 'Bruto (com adicionais e plantões)' }] })}
        </div>

        ${isAdd
          ? switchField({ label: 'Incide INSS e Imposto de Renda', name: 'flag', checked: l.taxable !== false, hint: 'Desligue para verbas indenizatórias, como auxílio-alimentação.' })
          : switchField({ label: 'Dedutível do Imposto de Renda', name: 'flag', checked: l.irDeductible, hint: 'Só pensão alimentícia judicial e previdência privada/complementar.' })}

        ${isAdd ? '' : html`
          ${switchField({ label: 'Desconto parcelado (empréstimo consignado)', name: 'isLoan', checked: Boolean(l.loan), hint: 'Some do contracheque sozinho depois da última parcela.' })}
          <div class="field--full form-grid loan-fields" data-when-loan ${l.loan ? '' : 'hidden'}>
            ${numberField({ label: 'Nº total de parcelas', name: 'loanCount', value: l.loan?.count || '', min: 1, max: 420, required: false })}
            ${numberField({ label: `Já descontadas antes de ${formatMonthShort(ym)}`, name: 'loanPaid', value: loanPaidBefore, min: 0, max: 420, required: false })}
          </div>`}

        <div class="field field--full"><div class="preview" data-preview aria-live="polite"></div></div>
      </div>`,

    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const $ = (sel) => dlg.querySelector(sel);

      const read = () => {
        const mode = form.querySelector('[name="mode"]:checked').value;
        const value = mode === 'percent' ? parsePercent(form.value.value) : mode === 'hours' ? parseHours(form.value.value) : toCents(form.value.value);
        const out = { id: line?.id, description: form.description.value, mode, value, base: form.base.value, variable: form.querySelector('[name="recurrence"]:checked').value === 'variable' };
        if (mode === 'hours') {
          out.hourKind = form.hourKind.value;
          out.hourPct = parsePercent(form.hourPct.value);
          out.dsr = form.dsr.checked;
        }
        if (isAdd) out.taxable = form.flag.checked;
        else {
          out.irDeductible = form.flag.checked;
          if (form.isLoan.checked) {
            const count = Number(form.loanCount.value);
            const paid = Number(form.loanPaid.value || 0);
            out.loan = { count, startYM: addMonthsYM(ym, -paid), paid };
          }
        }
        return out;
      };

      const update = () => {
        const v = read();
        $('[data-prefix]').textContent = v.mode === 'percent' ? '%' : v.mode === 'hours' ? 'h' : 'R$';
        $('[data-value-label]').textContent = v.mode === 'hours' ? 'Horas no mês' : 'Valor';
        $('[data-when-percent]').hidden = v.mode !== 'percent';
        dlg.querySelectorAll('[data-when-hours]').forEach((el) => { el.hidden = v.mode !== 'hours'; });
        if (isAdd) $('[data-when-custom]').hidden = !(v.mode === 'hours' && v.hourKind === 'custom');
        if (!isAdd) {
          $('[data-when-loan]').hidden = !form.isLoan.checked;
          $('[data-recurrence]').hidden = form.isLoan.checked; // parcelado já tem início e fim
        }

        // Valor do mês, calculado com o perfil atual + esta linha
        const profile = structuredClone(payrollProfileFor(store.data.settings, ym) || { grossCents: 0, additions: [], deductions: [] });
        profile.legacyNet = false;
        const list = isAdd ? profile.additions : profile.deductions;
        // A "sonda" é esta linha sem parcelamento, só para saber o valor no mês
        const probe = { ...v, id: '__probe__', loan: undefined, value: Number.isFinite(v.value) && v.value > 0 ? v.value : 0 };
        const i = list.findIndex((x) => x.id === line?.id);
        if (i >= 0) list[i] = probe; else list.push(probe);
        const st = store.data.settings;
        const p = computePayroll(profile, ym, {
          loans: (st.payrollLoans || []).filter((x) => x.id !== line?.id),
          variable: variableFor(st, ym).filter((x) => x.id !== line?.id),
          employment: employmentOf(st),
          ...daysFor(st, ym),
        });
        const probeLines = (isAdd ? p.additions : p.deductions).filter((x) => x.id === '__probe__' || x.id === '__probe__-dsr');
        const cents = probeLines.reduce((t, x) => t + x.cents, 0);
        const hourDetail = v.mode === 'hours' ? probeLines.map((x) => `${x.id.endsWith('-dsr') ? 'DSR' : x.detail}: ${formatBRL(x.cents)}`).join(' · ') : '';

        let loanText = '';
        if (v.loan) {
          const ok = Number.isInteger(v.loan.count) && v.loan.count >= 1 && v.loan.paid <= v.loan.count;
          if (!ok) loanText = 'Informe o nº de parcelas (maior que as já descontadas).';
          else if (v.loan.paid >= v.loan.count) loanText = 'Todas as parcelas já foram descontadas: não entra mais no contracheque.';
          else {
            const left = v.loan.count - v.loan.paid;
            loanText = `Parcela ${v.loan.paid + 1}/${v.loan.count} em ${formatMonthShort(ym)} · última em ${formatMonthShort(loanEndYM(v.loan))} · faltam ${left}× (${formatBRL(left * cents)})`;
          }
        }
        $('[data-preview]').innerHTML = html`
          <strong>${isAdd ? '+' : '−'}${formatBRL(cents)}</strong> ${v.variable && !v.loan ? `só em ${formatMonthShort(ym)}` : 'por mês'}
          ${hourDetail && cents ? html`<br><span class="muted">${hourDetail}</span>` : ''}
          ${v.mode === 'percent' && cents ? html`<span class="muted"> (${percentToInput(v.value || 0)}% ${v.base === 'minimum' ? 'do salário mínimo' : v.base === 'gross' ? 'do bruto' : 'do salário base'})</span>` : ''}
          ${loanText ? html`<br><span>${loanText}</span>` : ''}
          ${v.mode === 'percent' && v.value > 10000 ? html`<br><strong class="neg">Atenção: ${percentToInput(v.value)}% é mais que o valor inteiro. Queria informar em R$?</strong>` : ''}`.toString();
      };

      // Nomes que costumam variar (adicional noturno, horas extras, faltas…) sugerem "variável"
      form.description.addEventListener('change', () => {
        if (!line && VARIABLE_HINT.test(form.description.value)) {
          form.querySelector('[name="recurrence"][value="variable"]').checked = true;
          // Horas extras, sobreaviso e noturno: lançar em HORAS (o app calcula o valor)
          const d = form.description.value;
          const kind = isAdd && (/sobreaviso/i.test(d) ? 'sobreaviso' : /noturno/i.test(d) ? 'noturno' : /extra.*100/i.test(d) ? 'he100' : /hora.*extra|extra/i.test(d) ? 'he50' : null);
          if (kind && !form.value.value) {
            form.querySelector('[name="mode"][value="hours"]').checked = true;
            form.hourKind.value = kind;
            form.hourKind.dispatchEvent(new Event('change', { bubbles: true })); // atualiza a caixa estilizada
            form.dsr.checked = HOUR_KINDS[kind].dsr;
          } else if (!form.value.value && form.querySelector('[name="mode"]:checked').value === 'percent') {
            form.querySelector('[name="mode"][value="fixed"]').checked = true; // variáveis costumam vir em R$
          }
          update();
        }
      });
      // Escolher "Empréstimo consignado" já liga o parcelamento
      form.description.addEventListener('change', () => {
        if (!isAdd && /consignado|empr[ée]stimo/i.test(form.description.value) && !form.isLoan.checked) {
          form.isLoan.checked = true;
          update();
          form.loanCount.focus();
        }
      });
      // Trocar R$ ↔ % limpa o valor (as unidades são diferentes)
      for (const r of form.querySelectorAll('[name="mode"]')) {
        r.addEventListener('change', () => {
          form.value.value = '';
          // horas costumam variar de mês a mês
          if (r.value === 'hours' && !line) form.querySelector('[name="recurrence"][value="variable"]').checked = true;
          update(); form.value.focus();
        });
      }
      // Tipo de hora: sugere a descrição e o DSR
      form.hourKind?.addEventListener('change', () => {
        const k = HOUR_KINDS[form.hourKind.value];
        const names = Object.values(HOUR_KINDS).map((x) => x.label);
        if (!form.description.value.trim() || names.includes(form.description.value.trim())) {
          if (form.hourKind.value !== 'custom') form.description.value = k.label;
        }
        form.dsr.checked = k.dsr;
        update();
      });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },

    onSubmit: (form) => {
      const mode = form.querySelector('[name="mode"]:checked').value;
      const input = {
        id: line?.id,
        description: form.description.value,
        mode,
        value: mode === 'percent' ? parsePercent(form.value.value) : mode === 'hours' ? parseHours(form.value.value) : toCents(form.value.value),
        base: form.base.value,
        variable: form.querySelector('[name="recurrence"]:checked').value === 'variable',
      };
      if (mode === 'hours') {
        input.hourKind = form.hourKind.value;
        input.hourPct = form.hourKind.value === 'custom' ? parsePercent(form.hourPct.value) : null;
        input.dsr = form.dsr.checked;
      }
      if (isAdd) input.taxable = form.flag.checked;
      else {
        input.irDeductible = form.flag.checked;
        if (form.isLoan.checked) {
          const count = Number(form.loanCount.value);
          const paid = Number(form.loanPaid.value || 0);
          if (!Number.isInteger(paid) || paid < 0 || paid > count) throw new A.ValidationError('Parcelas já descontadas não podem passar do total.', 'loanPaid');
          input.loan = { count, startYM: addMonthsYM(ym, -paid) };
          input.variable = false;
        }
      }
      A.savePayrollLine(ym, kind, input);
      toast(line ? 'Salvo.' : (isAdd ? 'Adicional incluído.' : 'Desconto incluído.'));
    },
  });
}

