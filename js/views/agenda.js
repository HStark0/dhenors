// =============================================================
// Agenda — calendário do mês: salário, contas, plantões, faturas,
// valores a receber, renovações, férias e metas
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
import { catIcon } from '../ui/catIcon.js';
import { statusBadge } from '../ui/outlookUI.js';
import { outlookRow, monthMoney } from '../domain/outlook.js';
import { STATUS_TONES } from '../domain/monthStatus.js';

const COLOR = { income: '#10B981', vacation: '#EC4899', goal: '#8B5CF6', invest: '#06B6D4', shift: '#0D9488', card: '#6D28D9', receivable: '#65A30D', renewal: '#EA580C' };

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Ícone e cor de cada tipo de evento (sem emoji: ícones da marca). */
const EVENT = {
  income: { icon: 'banknote', label: 'Entradas', tone: 'pos' },
  vacation: { icon: 'tree-palm', label: 'Férias' },
  goal: { icon: 'target', label: 'Prazo de meta' },
  invest: { icon: 'landmark', label: 'Vencimento de investimento' },
  shift: { icon: 'stethoscope', label: 'Plantões', tone: 'pos' },
  card: { icon: 'credit-card', label: 'Fechamento de fatura' },
  receivable: { icon: 'hand-coins', label: 'A receber', tone: 'pos' },
  renewal: { icon: 'repeat', label: 'Renovação de assinatura' },
};

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
      ${monthBanner(d, ym, today)}

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
            <li><span class="dot dot--shift"></span>Plantões</li>
            <li><span class="dot dot--card"></span>Fatura fecha</li>
            <li><span class="dot dot--receivable"></span>A receber</li>
            <li><span class="dot dot--renewal"></span>Renovações</li>
            <li><span class="dot dot--vacation"></span>Férias, metas e vencimentos</li>
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
                <li><span class="row-flex">${catIcon({ icon: `i:${(EVENT[e.type] || EVENT.goal).icon}`, color: COLOR[e.type] }, { size: 'xs' })} ${e.label}</span>
                <span class="money ${EVENT[e.type]?.tone || ''}">${e.cents ? `${EVENT[e.type]?.tone === 'pos' ? '+' : ''}${formatBRL(e.cents)}` : ''}</span></li>`)}
            </ul>` : ''}
          ${itemList(dayEvents.filter((e) => e.type === 'bill').map((e) => e.item), { showMonth: true })}
          ${dayEvents.length ? '' : html`<div class="empty empty--sm"><p class="muted">Nada marcado para este dia.</p></div>`}
        </article>
      </section>`;
  },

  actions: {
    'agenda:day': (el) => store.setUI({ ym: ymOf(el.dataset.date), filters: { ...store.ui.filters, agendaDay: el.dataset.date } }),
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

/** Faixa com a situação do mês (a mesma do Painel e dos 12 meses). Toque: o que pesa nele. */
function monthBanner(d, ym, today) {
  if (!d.settings.salaryHistory.length && !d.recurring.length && !d.installments.length) return '';
  const row = outlookRow(d, ym, today);
  const mm = row ? null : monthMoney(d, ym, today);
  const status = row ? row.status : mm.status;
  const balance = row ? row.balance : mm.balance;
  if (status === 'none') return '';
  const what = row ? 'Previsão' : 'Saldo';
  return html`
    <button type="button" class="month-banner tone-${STATUS_TONES[status]}" data-action="outlook:month" data-ym="${ym}">
      ${statusBadge(status)}
      <span>${what} de ${formatMonth(ym)}: ${balance < 0 ? html`<strong>faltam ${formatBRL(-balance)}</strong>` : html`sobra <strong>${formatBRL(balance)}</strong>`}</span>
      <span class="month-banner__more">O que pesa ${icon('chevron-right', 'icon--xs')}</span>
    </button>`;
}

function dayCell(date, inMonth, events, isToday, isSelected) {
  const day = Number(date.slice(8));
  const holiday = holidayName(date);
  const income = events.filter((e) => e.type === 'income');
  const bills = events.filter((e) => e.type === 'bill');
  const other = events.filter((e) => e.type !== 'income' && e.type !== 'bill');
  const total = bills.reduce((s, e) => s + e.cents, 0);
  const dots = [
    ...income.map(() => 'income'),
    ...bills.map((e) => (e.status === 'paid' ? 'paid' : e.status === 'overdue' ? 'overdue' : 'bill')),
    ...other.map((e) => e.type),
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
