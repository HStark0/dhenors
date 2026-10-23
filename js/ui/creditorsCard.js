// =============================================================
// Card "Credores do mês": quanto se deve a cada credor no mês
// (só quem tem valor). Usado no Painel e em Ajustes → Credores.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { formatBRL, plural } from '../core/money.js';
import { formatMonth } from '../core/dates.js';
import { creditorsInMonth } from '../domain/ledger.js';

/**
 * @param {object} opts
 *   detailsAction  ação ao tocar num credor (recebe data-id); sem ela, a linha é só texto
 *   limit          quantos credores mostrar (o resto vira "+N" com link para Ajustes)
 */
export function creditorsMonthCard(state, ym, today, { detailsAction = null, limit = 0 } = {}) {
  const c = creditorsInMonth(state, ym, today);
  if (!c.list.length) return '';
  const shown = limit ? c.list.slice(0, limit) : c.list;
  const rest = c.list.slice(shown.length);
  const tone = c.list.some((x) => x.overdue) ? 'bad' : c.pending ? 'info' : 'good';
  const body = (x) => html`
    <span class="avatar avatar--sm" aria-hidden="true">${x.creditor.name.slice(0, 1).toUpperCase()}</span>
    <span class="stack-text">
      <strong>${x.creditor.name}</strong>
      <small class="muted">${!x.pending ? 'pago' : x.paid ? `pago ${formatBRL(x.paid)} · falta ${formatBRL(x.pending)}` : `${plural(x.count, 'conta')} a pagar`}${x.outstanding > x.pending ? ` · deve ${formatBRL(x.outstanding)} no total` : ''}</small>
    </span>`;
  return html`
    <article class="card tone-${tone}" data-key="creditors">
      <header class="card__header">
        <h2 class="card__title">${icon('handshake')} Credores de ${formatMonth(ym)}</h2>
        <strong class="money">${formatBRL(c.total)}</strong>
      </header>
      <p class="muted small">${c.pending ? `Falta pagar ${formatBRL(c.pending)} a ${plural(c.list.filter((x) => x.pending).length, 'credor', 'credores')}.` : 'Tudo pago aos credores neste mês.'}</p>
      <ul class="mini-list cred-month">
        ${shown.map((x) => html`
          <li>
            ${detailsAction
              ? html`<button type="button" class="cred-month__who" data-action="${detailsAction}" data-id="${x.creditor.id}">${body(x)}</button>`
              : html`<span class="cred-month__who">${body(x)}</span>`}
            <span class="money">${formatBRL(x.total)}</span>
            <span class="mini-list__actions">${x.overdue ? html`<span class="badge badge--bad">atrasado</span>`
              : x.pending ? html`<span class="badge badge--warn">a pagar</span>` : html`<span class="badge badge--paid">pago</span>`}</span>
          </li>`)}
      </ul>
      ${rest.length || limit ? html`
        <footer class="card__footer">
          <a class="link" href="#/ajustes?aba=credores">${rest.length ? `+ ${plural(rest.length, 'credor', 'credores')} · ` : ''}Ver credores ${icon('arrow-right', 'icon--xs')}</a>
        </footer>` : ''}
    </article>`;
}
