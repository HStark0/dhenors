// =============================================================
// Contas → Parcelamentos: carnês e empréstimos (fora do cartão),
// com cronograma, data real de cada pagamento e quitação antecipada
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { meter } from '../../ui/charts.js';
import { catIcon } from '../../ui/catIcon.js';
import { openDialog } from '../../ui/dialog.js';
import { field } from '../../ui/forms.js';
import * as E from '../../ui/editors.js';
import { store } from '../../core/store.js';
import { formatBRL, plural } from '../../core/money.js';
import { currentYM, formatDateBR, formatMonthShort, monthsBetween } from '../../core/dates.js';
import { installmentSummary, installmentInMonth } from '../../domain/ledger.js';
import { earlyPayoff } from '../../domain/debts.js';
import * as A from '../../domain/actions.js';

export function renderInstallments() {
  const d = store.data;
  const now = currentYM();
  const show = store.ui.filters.installments || 'active';
  const all = d.installments.map((inst) => ({ inst, s: installmentSummary(inst) }));
  const active = all.filter((x) => !x.s.finished);
  const done = all.filter((x) => x.s.finished);
  const list = (show === 'active' ? active : done)
    .sort((a, b) => (a.s.nextOpen?.dueDate || a.s.lastDueDate).localeCompare(b.s.nextOpen?.dueDate || b.s.lastDueDate));

  const thisMonth = active.reduce((a, x) => a + (installmentInMonth(x.inst, now)?.cents || 0), 0);
  const remaining = active.reduce((a, x) => a + x.s.remainingCents, 0);

  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Parcelas deste mês</dt><dd class="money">${formatBRL(thisMonth)}</dd></div>
        <div><dt>Falta pagar (total)</dt><dd class="money">${formatBRL(remaining)}</dd></div>
        <div><dt>Ativos</dt><dd>${active.length}</dd></div>
      </dl>
      <button type="button" class="btn btn--primary" data-action="inst:new">${icon('plus')} Novo parcelamento</button>
    </div>
    ${(d.cards || []).length ? html`<p class="muted small">Compras parceladas no <strong>cartão de crédito</strong> ficam dentro das faturas, em <a href="#/carteira?aba=cartoes">Cartões e contas</a>.</p>` : ''}

    <div class="segmented" role="group" aria-label="Mostrar">
      <button type="button" class="segmented__btn" data-action="inst:filter" data-filter="active" aria-pressed="${show === 'active'}">Em andamento (${active.length})</button>
      <button type="button" class="segmented__btn" data-action="inst:filter" data-filter="done" aria-pressed="${show === 'done'}">Quitados (${done.length})</button>
    </div>

    ${list.length ? html`<div class="cards-grid">${list.map(({ inst, s }) => card(inst, s, now))}</div>`
    : html`
      <div class="card empty">
        ${icon('calendar-range', 'icon--lg')}
        <p><strong>${show === 'active' ? 'Nenhum parcelamento em andamento.' : 'Nenhum parcelamento quitado ainda.'}</strong></p>
        ${show === 'active' ? html`<button type="button" class="btn btn--primary" data-action="inst:new">${icon('plus')} Novo parcelamento</button>` : ''}
      </div>`}`;
}

const find = (el) => store.data.installments.find((x) => x.id === el.dataset.id);

function card(inst, s, now) {
  const d = store.data;
  const cat = d.categories.find((c) => c.id === inst.categoryId);
  const cred = d.creditors.find((c) => c.id === inst.creditorId);
  const monthsLeft = Math.max(0, monthsBetween(now, s.lastYM) + 1);
  const late = s.schedule.filter((p) => !p.paid && p.ym < now).length;
  const parcelValue = s.schedule[s.schedule.length - 1].cents;

  return html`
    <article class="card entity">
      <header class="entity__head">
        ${catIcon(cat || { icon: 'i:calendar-range', color: '#94A3B8' }, { size: 'md' })}
        <div class="entity__title">
          <h3>${inst.description}</h3>
          <p class="muted small">${cat?.name || 'Sem categoria'}${cred ? ` · ${cred.name}` : ''}</p>
        </div>
        <p class="entity__value money">${inst.count}× ${formatBRL(parcelValue)}</p>
      </header>

      ${meter(s.paidCount, { max: inst.count, label: `${s.paidCount} de ${inst.count} parcelas pagas`, tone: s.finished ? 'good' : '' })}
      <p class="entity__progress">
        <span><strong>${s.paidCount}/${inst.count}</strong> pagas</span>
        <span>${formatBRL(s.paidCents)} de ${formatBRL(inst.totalCents)}</span>
      </p>

      <p class="entity__meta">
        ${s.finished
          ? html`${icon('circle-check', 'icon--xs pos')} Quitado em ${formatMonthShort(s.lastYM)}`
          : html`${icon('calendar', 'icon--xs')} Próxima: ${formatDateBR(s.nextOpen.dueDate)} · termina em ${formatMonthShort(s.lastYM)} (${monthsLeft} ${monthsLeft === 1 ? 'mês' : 'meses'})`}
        ${late ? html`<span class="badge badge--bad">${icon('circle-alert', 'icon--xs')} ${plural(late, 'atrasada')}</span>` : ''}
      </p>

      <footer class="entity__actions">
        <button type="button" class="btn btn--secondary btn--sm" data-action="inst:details" data-id="${inst.id}">${icon('list-filter', 'icon--xs')} Parcelas</button>
        ${s.finished ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-action="inst:payoff" data-id="${inst.id}">${icon('calculator', 'icon--xs')} Quitar antes</button>`}
        <button type="button" class="btn btn--ghost btn--sm" data-action="inst:edit" data-id="${inst.id}">${icon('pencil', 'icon--xs')} Editar</button>
        <button type="button" class="btn btn--ghost btn--sm danger" data-action="inst:delete" data-id="${inst.id}">${icon('trash-2', 'icon--xs')} Excluir</button>
      </footer>
    </article>`;
}

/** Simulação de quitação antecipada: desconto dos juros futuros. */
function payoffDialog(inst) {
  const s = installmentSummary(inst);
  const open = s.schedule.filter((p) => !p.paid).map((p) => p.cents);
  const render = (rateBp) => {
    const r = earlyPayoff(open, rateBp);
    return html`
      <dl class="kv kv--stack">
        <div><span>Parcelas restantes</span><strong>${open.length} · ${formatBRL(r.nominal)}</strong></div>
        <div><span>Valor para quitar hoje (estimado)</span><strong class="money pos">${formatBRL(r.presentValue)}</strong></div>
        <div><span>Economia em juros</span><strong class="money">${formatBRL(r.discount)} (${r.discountPct.toFixed(1).replace('.', ',')}%)</strong></div>
      </dl>
      <p class="field__hint">Pela lei (CDC, art. 52), na quitação antecipada os juros futuros saem proporcionalmente. Peça ao credor o valor oficial e compare.</p>`;
  };
  const { dialog } = openDialog({
    title: `Quitar "${inst.description}" antes`,
    size: 'sm',
    body: html`
      ${field({ label: 'Juros ao mês do contrato (%)', name: 'rate', value: '2', extra: { inputmode: 'decimal' }, hint: 'Está no contrato (taxa de juros mensal ou CET).' })}
      <div data-out>${render(200)}</div>`,
  });
  dialog.querySelector('[name="rate"]').addEventListener('input', (ev) => {
    const bp = Math.round(parseFloat(ev.target.value.replace(',', '.')) * 100) || 0;
    dialog.querySelector('[data-out]').innerHTML = render(bp).toString();
  });
}

export const installmentActions = {
  'inst:new': () => E.editInstallment(),
  'inst:filter': (el) => store.setUI({ filters: { ...store.ui.filters, installments: el.dataset.filter } }),
  'inst:details': (el) => E.installmentDetails(el.dataset.id),
  'inst:payoff': (el) => payoffDialog(find(el)),
  'inst:edit': (el) => E.editInstallment(find(el)),
  'inst:delete': (el) => {
    const inst = find(el);
    E.confirmDelete(`o parcelamento "${inst.description}"`, () => A.deleteInstallment(inst.id));
  },
};
