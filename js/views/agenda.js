// =============================================================
// Agenda — calendário do mês: salário, contas, férias e metas
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { itemList } from '../ui/items.js';
import { toast, toastError } from '../ui/toast.js';
import { download } from '../ui/backup.js';
import { store } from '../core/store.js';
import { formatBRL, plural } from '../core/money.js';
import { todayISO, formatDateBR, formatMonth, weekdayLong, ymOf } from '../core/dates.js';
import { holidayName } from '../core/calendar.js';
import { calendarEvents, monthGrid, buildICS } from '../domain/planning.js';
import { paydayLabel } from '../domain/payroll.js';
import { enableNotifications } from '../ui/notify.js';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default {
  id: 'agenda',
  title: 'Agenda',
  monthNav: true,

  render() {
    const d = store.data;
    const ym = store.ui.ym;
    const today = todayISO();
    const events = calendarEvents(d, ym, today);
    const selected = store.ui.filters.agendaDay && ymOf(store.ui.filters.agendaDay) === ym
      ? store.ui.filters.agendaDay
      : (ymOf(today) === ym ? today : Object.keys(events).sort()[0] || `${ym}-01`);
    const dayEvents = events[selected] || [];
    const reminders = d.settings.reminders || {};

    return html`
      <div class="page-head">
        <p class="muted">Salário cai ${paydayLabel(d.settings)} · toque num dia para ver os detalhes</p>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost" data-action="agenda:notify">${icon('bell-ring')} ${reminders.enabled ? 'Lembretes ligados' : 'Ativar lembretes'}</button>
          <button type="button" class="btn btn--secondary" data-action="agenda:ics">${icon('calendar-days')} Levar para o calendário do celular</button>
        </div>
      </div>

      <section class="grid grid--agenda">
        <article class="card cal">
          <div class="cal__week" aria-hidden="true">${WEEK.map((w) => html`<span>${w}</span>`)}</div>
          <div class="cal__grid" role="grid" aria-label="Calendário de ${formatMonth(ym)}">
            ${monthGrid(ym).map((week) => html`
              <div class="cal__row" role="row">
                ${week.map(({ date, inMonth }) => dayCell(date, inMonth, events[date] || [], date === today, date === selected))}
              </div>`)}
          </div>
          <ul class="cal__legend">
            <li><span class="dot dot--income"></span>Entradas</li>
            <li><span class="dot dot--bill"></span>A pagar</li>
            <li><span class="dot dot--overdue"></span>Atrasadas</li>
            <li><span class="dot dot--paid"></span>Pagas</li>
            <li><span class="dot dot--vacation"></span>Férias / metas</li>
          </ul>
        </article>

        <article class="card">
          <header class="card__header">
            <h2 class="card__title">${icon('calendar')} ${formatDateBR(selected)} <span class="muted small">${weekdayLong(selected)}</span></h2>
          </header>
          ${holidayName(selected) ? html`<p class="badge badge--info">Feriado: ${holidayName(selected)}</p>` : ''}
          ${dayEvents.filter((e) => e.type !== 'bill').length ? html`
            <ul class="mini-list">
              ${dayEvents.filter((e) => e.type !== 'bill').map((e) => html`
                <li><span>${e.type === 'income' ? '💰' : e.type === 'vacation' ? '🏖️' : '🎯'} ${e.label}</span>
                <span class="money ${e.type === 'income' ? 'pos' : ''}">${e.cents ? `${e.type === 'income' ? '+' : ''}${formatBRL(e.cents)}` : ''}</span></li>`)}
            </ul>` : ''}
          ${itemList(dayEvents.filter((e) => e.type === 'bill').map((e) => e.item), { showMonth: true })}
          ${dayEvents.length ? '' : html`<div class="empty empty--sm"><p class="muted">Nada marcado para este dia.</p></div>`}
        </article>
      </section>`;
  },

  actions: {
    'agenda:day': (el) => store.setUI({ filters: { ...store.ui.filters, agendaDay: el.dataset.date } }),
    'agenda:ics': () => {
      const d = store.data;
      const days = d.settings.reminders?.daysBefore ?? 1;
      const ics = buildICS(d, store.ui.ym, 12, days || 1, todayISO());
      const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
      if (!count) return toastError('Não há contas em aberto nos próximos 12 meses.');
      download(`dhenors-contas-${store.ui.ym}.ics`, ics, 'text/calendar;charset=utf-8');
      toast(`${plural(count, 'vencimento exportado', 'vencimentos exportados')}. Abra o arquivo no celular para adicionar à agenda com alarme.`);
    },
    'agenda:notify': () => enableNotifications(),
  },
};

function dayCell(date, inMonth, events, isToday, isSelected) {
  const day = Number(date.slice(8));
  const holiday = holidayName(date);
  const income = events.filter((e) => e.type === 'income');
  const bills = events.filter((e) => e.type === 'bill');
  const other = events.filter((e) => e.type === 'vacation' || e.type === 'goal');
  const total = bills.reduce((s, e) => s + e.cents, 0);
  const dots = [
    ...income.map(() => 'income'),
    ...bills.map((e) => (e.status === 'paid' ? 'paid' : e.status === 'overdue' ? 'overdue' : 'bill')),
    ...other.map(() => 'vacation'),
  ].slice(0, 5);
  const label = `${formatDateBR(date)}${holiday ? `, ${holiday}` : ''}: ${events.length ? plural(events.length, 'evento') : 'sem eventos'}`;

  return html`
    <button type="button" role="gridcell" class="cal__day ${inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${holiday ? 'is-holiday' : ''}"
      data-action="agenda:day" data-date="${date}" aria-label="${label}" aria-pressed="${isSelected}">
      <span class="cal__num">${day}</span>
      ${income.length ? html`<span class="cal__chip cal__chip--income">+${formatBRL(income.reduce((s, e) => s + e.cents, 0)).replace('R$', '').trim()}</span>` : ''}
      ${total ? html`<span class="cal__chip">${formatBRL(total).replace('R$', '').trim()}</span>` : ''}
      <span class="cal__dots">${dots.map((k) => html`<span class="dot dot--${k}"></span>`)}</span>
    </button>`;
}
