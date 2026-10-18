// =============================================================
// Salário → Plantões: escala do mês
// -------------------------------------------------------------
// Toque num dia do calendário para marcar o plantão (do tipo
// escolhido). Cada tipo tem valor e diz se é "na folha" (bruto, paga
// INSS/IR com o salário) ou fora dela (outro hospital). As rendas do
// mês são geradas sozinhas a partir da escala.
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openDialog } from '../../ui/dialog.js';
import { toast, toastError } from '../../ui/toast.js';
import { field, moneyField, numberField, switchField, readForm } from '../../ui/forms.js';
import * as E from '../../ui/editors.js';
import { store } from '../../core/store.js';
import { formatBRL, toCents, plural } from '../../core/money.js';
import { formatMonth, formatDateBR, weekdayLong, todayISO } from '../../core/dates.js';
import { holidayName } from '../../core/calendar.js';
import { monthGrid } from '../../domain/planning.js';
import { shiftsIn, shiftTypeOf, shiftValue, shiftSummary, shiftIncomes } from '../../domain/shifts.js';
import { payslipIncome } from '../../domain/ledger.js';
import * as A from '../../domain/actions.js';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const activeType = () => {
  const types = store.data.settings.shiftTypes || [];
  return types.find((t) => t.id === store.ui.filters.shiftType) || types[0] || null;
};

export function renderShifts() {
  const d = store.data;
  const ym = store.ui.ym;
  const types = d.settings.shiftTypes || [];
  const type = activeType();
  const list = shiftsIn(d, ym);
  const byDate = new Map();
  for (const s of list) byDate.set(s.date, [...(byDate.get(s.date) || []), s]);
  const sum = shiftSummary(d, ym);
  const incomes = shiftIncomes(d, ym);
  const inc = payslipIncome(d, ym);
  const noValue = types.filter((t) => !t.cents);

  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Plantões em ${formatMonth(ym)}</dt><dd>${sum.count}</dd></div>
        <div><dt>Horas</dt><dd>${sum.hours}h</dd></div>
        <div><dt>Valor bruto</dt><dd class="money pos">${formatBRL(sum.cents)}</dd></div>
      </dl>
      <button type="button" class="btn btn--ghost" data-action="shift:types">${icon('sliders-horizontal')} Tipos e valores</button>
    </div>
    ${noValue.length === types.length ? html`<div class="banner" role="note">${icon('info')}<p>Informe o valor de cada tipo de plantão para o app calcular a renda.</p><button type="button" class="btn btn--secondary btn--sm" data-action="shift:types">Definir valores</button></div>` : ''}

    <section class="grid grid--agenda">
      <article class="card cal">
        <div class="shift-types" role="radiogroup" aria-label="Tipo a marcar">
          ${types.map((t) => html`
            <button type="button" class="chip-btn ${t.id === type?.id ? 'is-on' : ''}" style="--chip:${t.color || '#0D9488'}" role="radio" aria-checked="${t.id === type?.id}" data-action="shift:pick" data-id="${t.id}">
              ${t.name} <small>${t.cents ? formatBRL(t.cents) : 'sem valor'}</small>
            </button>`)}
        </div>
        <p class="muted small">Toque num dia para marcar um <strong>${type?.name || 'plantão'}</strong>. Toque de novo para ver/remover.</p>
        <div class="cal__week" aria-hidden="true">${WEEK.map((w) => html`<span>${w}</span>`)}</div>
        <div class="cal__grid" role="grid" aria-label="Escala de ${formatMonth(ym)}">
          ${monthGrid(ym).map((week) => html`
            <div class="cal__row" role="row">
              ${week.map(({ date, inMonth }) => {
                const shifts = byDate.get(date) || [];
                const holiday = holidayName(date);
                return html`
                  <button type="button" role="gridcell" class="cal__day ${inMonth ? '' : 'is-out'} ${date === todayISO() ? 'is-today' : ''} ${holiday ? 'is-holiday' : ''} ${shifts.length ? 'has-shift' : ''}"
                    data-action="shift:day" data-date="${date}" aria-label="${formatDateBR(date)}${holiday ? `, ${holiday}` : ''}: ${shifts.length ? shifts.map((s) => shiftTypeOf(d, s.typeId)?.name).join(', ') : 'sem plantão'}" ${inMonth ? '' : 'disabled'}>
                    <span class="cal__num">${Number(date.slice(8))}</span>
                    ${shifts.map((s) => { const t = shiftTypeOf(d, s.typeId); return html`<span class="shift-pill" style="--chip:${t?.color || '#0D9488'}">${t?.hours || ''}h</span>`; })}
                  </button>`;
              })}
            </div>`)}
        </div>
      </article>

      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('stethoscope')} Renda dos plantões</h2></header>
        ${incomes.length ? html`
          <ul class="mini-list">
            ${incomes.map((x) => html`<li><span>${x.description} <span class="badge ${x.payroll ? '' : 'badge--muted'}">${x.payroll ? 'na folha (bruto)' : 'fora da folha'}</span></span><span class="money pos">+${formatBRL(x.cents)}</span></li>`)}
          </ul>
          <p class="card__total"><span>Somam ao líquido do mês (estimado)</span><strong class="money pos">+${formatBRL(inc.extrasCents)}</strong></p>
          <p class="field__hint">Os plantões "na folha" entram no bruto e pagam INSS e IR junto com o salário.${d.settings.payday?.nextMonth ? ' Como seu salário cai no mês seguinte, eles são pagos no próximo mês.' : ''}</p>`
        : html`<p class="muted small">Nenhum plantão marcado em ${formatMonth(ym)}.</p>`}
        ${list.length ? html`
          <h3 class="dialog__subtitle">Escala</h3>
          <ul class="mini-list">
            ${list.map((s) => { const t = shiftTypeOf(d, s.typeId); return html`<li><span>${formatDateBR(s.date)} <small class="muted">${weekdayLong(s.date)}${holidayName(s.date) ? ` · ${holidayName(s.date)}` : ''}</small> · ${t?.name}${s.note ? html` <small class="muted">${s.note}</small>` : ''}</span><span class="money">${formatBRL(shiftValue(d, s))}</span>
              <span class="mini-list__actions"><button type="button" class="icon-btn icon-btn--sm danger" data-action="shift:delete" data-id="${s.id}" aria-label="Remover plantão de ${formatDateBR(s.date)}">${icon('trash-2')}</button></span></li>`; })}
          </ul>` : ''}
        ${sum.weekendOrHoliday ? html`<p class="small muted">${plural(sum.weekendOrHoliday, 'plantão', 'plantões')} em fim de semana ou feriado.</p>` : ''}
      </article>
    </section>`;
}

function typesDialog() {
  const render = () => html`
    <ul class="plines">
      ${(store.data.settings.shiftTypes || []).map((t) => html`
        <li class="pline">
          <span class="pline__icon" style="--cat:${t.color}" aria-hidden="true">${icon('stethoscope')}</span>
          <div class="pline__main"><strong>${t.name}</strong><small>${t.hours}h · ${t.cents ? formatBRL(t.cents) : 'sem valor'} · ${t.payroll ? 'na folha' : 'fora da folha'}${t.night ? ' · noturno' : ''}${t.weekend ? ' · fim de semana' : ''}</small></div>
          <span class="pline__actions">
            <button type="button" class="icon-btn icon-btn--sm" data-edit="${t.id}" aria-label="Editar ${t.name}">${icon('pencil')}</button>
            <button type="button" class="icon-btn icon-btn--sm danger" data-del="${t.id}" aria-label="Remover ${t.name}">${icon('trash-2')}</button>
          </span>
        </li>`)}
    </ul>
    <button type="button" class="btn btn--secondary btn--sm" data-new>${icon('plus', 'icon--xs')} Novo tipo</button>`;
  const { dialog } = openDialog({ title: 'Tipos de plantão', body: render() });
  const body = dialog.querySelector('.dialog__body');
  const unsub = store.subscribe(() => { if (dialog.open) body.innerHTML = render().toString(); });
  dialog.addEventListener('close', unsub);
  body.addEventListener('click', (ev) => {
    const edit = ev.target.closest('[data-edit]');
    if (edit) typeDialog(store.data.settings.shiftTypes.find((t) => t.id === edit.dataset.edit));
    if (ev.target.closest('[data-new]')) typeDialog();
    const del = ev.target.closest('[data-del]');
    if (del) E.deleteWithUndo(() => A.deleteShiftType(del.dataset.del), 'Tipo removido.');
  });
}

function typeDialog(t = null) {
  const x = t || { name: '', hours: 12, cents: null, payroll: true, night: false, weekend: false, color: '#0D9488' };
  openDialog({
    title: t ? 'Editar tipo de plantão' : 'Novo tipo de plantão',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: x.name, required: true, placeholder: 'Ex.: Plantão 12h UTI', extra: { maxlength: 40 } })}
        ${numberField({ label: 'Horas', name: 'hours', value: x.hours, min: 1, max: 48 })}
        ${moneyField({ label: 'Valor por plantão', name: 'cents', cents: x.cents, hint: 'Bruto, se for pago na folha.' })}
        ${switchField({ label: 'Pago na folha (bruto: paga INSS/IR)', name: 'payroll', checked: x.payroll, hint: 'Desligue para plantão em outro lugar, pago à parte (valor líquido).' })}
        ${switchField({ label: 'Noturno', name: 'night', checked: x.night })}
        ${switchField({ label: 'Fim de semana / feriado', name: 'weekend', checked: x.weekend })}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveShiftType({ ...v, id: t?.id, hours: Number(v.hours), cents: toCents(v.cents), color: x.color });
      toast('Tipo salvo.');
    },
  });
}

function dayDialog(date) {
  const d = store.data;
  const list = (d.shifts || []).filter((s) => s.date === date);
  const type = activeType();
  if (!list.length) {
    if (!type) { typeDialog(); return; }
    A.addShifts([date], type.id);
    toast(`${type.name} marcado em ${formatDateBR(date)}.`, { action: { label: 'Desfazer', run: () => A.deleteShift(store.data.shifts.find((s) => s.date === date && s.typeId === type.id)?.id) } });
    return;
  }
  openDialog({
    title: `Plantões de ${formatDateBR(date)}`,
    size: 'sm',
    body: html`
      <ul class="mini-list">${list.map((s) => html`<li><span>${shiftTypeOf(d, s.typeId)?.name}</span><span class="money">${formatBRL(shiftValue(d, s))}</span>
        <span class="mini-list__actions"><button type="button" class="icon-btn icon-btn--sm danger" data-del="${s.id}" aria-label="Remover">${icon('trash-2')}</button></span></li>`)}</ul>
      ${type ? html`<button type="button" class="btn btn--secondary btn--sm" data-add>${icon('plus', 'icon--xs')} Mais um ${type.name}</button>` : ''}`,
    onMount: (dlg) => dlg.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      try {
        if (del) { A.deleteShift(del.dataset.del); dlg.close(); toast('Plantão removido.', { action: { label: 'Desfazer', run: () => store.undo() } }); }
        if (ev.target.closest('[data-add]')) { A.addShifts([date], type.id); dlg.close(); toast('Plantão marcado.'); }
      } catch (err) {
        if (err?.name !== 'GuestError') toastError(err.message); // ex.: mês fechado
      }
    }),
  });
}

export const shiftActions = {
  'shift:types': () => typesDialog(),
  'shift:pick': (el) => store.setUI({ filters: { ...store.ui.filters, shiftType: el.dataset.id } }),
  'shift:day': (el) => dayDialog(el.dataset.date),
  'shift:delete': (el) => E.deleteWithUndo(() => A.deleteShift(el.dataset.id), 'Plantão removido.'),
};
