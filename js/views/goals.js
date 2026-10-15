// =============================================================
// Metas — objetivos de economia (reserva, viagem, carro…)
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { meter } from '../ui/charts.js';
import { openDialog } from '../ui/dialog.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, formatPercent } from '../core/money.js';
import { formatDateBR, todayISO } from '../core/dates.js';
import { goalPlan } from '../domain/ledger.js';
import * as A from '../domain/actions.js';

export default {
  id: 'metas',
  title: 'Metas',

  render() {
    const goals = store.data.goals;
    const today = todayISO();
    const plans = goals.map((g) => ({ g, p: goalPlan(g, today) }));
    const saved = plans.reduce((a, x) => a + x.p.saved, 0);
    const perMonth = plans.reduce((a, x) => a + (x.p.perMonth || 0), 0);

    return html`
      <div class="page-head">
        <dl class="stats">
          <div><dt>Total guardado</dt><dd class="money pos">${formatBRL(saved)}</dd></div>
          <div><dt>Para cumprir os prazos</dt><dd class="money">${formatBRL(perMonth)}<small>/mês</small></dd></div>
        </dl>
        <button type="button" class="btn btn--primary" data-action="goal:new">${icon('plus')} Nova meta</button>
      </div>

      ${goals.length ? html`<div class="cards-grid">${plans.map(({ g, p }) => card(g, p))}</div>`
      : html`
        <div class="card empty">
          ${icon('piggy-bank', 'icon--lg')}
          <p><strong>Nenhuma meta ainda.</strong></p>
          <p class="muted">Crie objetivos como "Reserva de emergência" e registre quanto guardou a cada mês.</p>
          <button type="button" class="btn btn--primary" data-action="goal:new">${icon('plus')} Nova meta</button>
        </div>`}`;
  },

  actions: {
    'goal:new': () => E.editGoal(),
    'goal:edit': (el) => E.editGoal(find(el)),
    'goal:add': (el) => E.contributeGoal(find(el)),
    'goal:withdraw': (el) => E.contributeGoal(find(el), true),
    'goal:history': (el) => history(find(el)),
    'goal:delete': (el) => {
      const g = find(el);
      E.confirmDelete(`a meta "${g.description}"`, () => A.deleteGoal(g.id));
    },
  },
};

const find = (el) => store.data.goals.find((g) => g.id === el.dataset.id);

function card(g, p) {
  return html`
    <article class="card entity goal ${p.done ? 'is-done card--feature' : ''}">
      <header class="entity__head">
        <span class="entity__icon entity__icon--goal">${g.icon}</span>
        <div class="entity__title">
          <h3>${g.description}</h3>
          <p class="muted small">${g.deadline ? `Prazo: ${formatDateBR(g.deadline)}` : 'Sem prazo'}</p>
        </div>
        <p class="entity__value">${formatPercent(p.progress)}</p>
      </header>
      ${meter(p.saved, { max: g.targetCents, label: `Progresso de ${g.description}`, tone: p.done ? 'good' : p.late ? 'warn' : '' })}
      <p class="entity__progress">
        <span><strong class="money">${formatBRL(p.saved)}</strong> guardados</span>
        <span>meta ${formatBRL(g.targetCents)}</span>
      </p>
      <p class="entity__meta">
        ${p.done ? html`${icon('circle-check', 'icon--xs pos')} Meta alcançada! 🎉`
          : p.late ? html`${icon('triangle-alert', 'icon--xs')} Prazo passou · faltam ${formatBRL(p.remaining)}`
          : p.perMonth ? html`Guarde <strong>${formatBRL(p.perMonth)}/mês</strong> por ${p.monthsLeft} ${p.monthsLeft === 1 ? 'mês' : 'meses'}`
          : html`Faltam ${formatBRL(p.remaining)}`}
      </p>
      <footer class="entity__actions">
        <button type="button" class="btn btn--primary btn--sm" data-action="goal:add" data-id="${g.id}">${icon('plus', 'icon--xs')} Guardar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="goal:withdraw" data-id="${g.id}" ${p.saved <= 0 ? 'disabled' : ''}>Retirar</button>
        <span class="entity__icons">
        <button type="button" class="icon-btn" data-action="goal:history" data-id="${g.id}" aria-label="Histórico de ${g.description}" title="Histórico">${icon('history')}</button>
        <button type="button" class="icon-btn" data-action="goal:edit" data-id="${g.id}" aria-label="Editar ${g.description}">${icon('pencil')}</button>
        <button type="button" class="icon-btn danger" data-action="goal:delete" data-id="${g.id}" aria-label="Excluir ${g.description}">${icon('trash-2')}</button>
        </span>
      </footer>
    </article>`;
}

function history(goal) {
  const list = [...goal.contributions].sort((a, b) => b.date.localeCompare(a.date));
  const { dialog } = openDialog({
    title: `${goal.icon} ${goal.description}`,
    body: list.length ? html`
      <ul class="mini-list">
        ${list.map((c) => html`
          <li>
            <span>${formatDateBR(c.date)}</span>
            <span class="money ${c.cents > 0 ? 'pos' : 'neg'}">${c.cents > 0 ? '+' : '−'}${formatBRL(Math.abs(c.cents))}</span>
            <span class="mini-list__actions">
              <button type="button" class="icon-btn icon-btn--sm" data-del="${c.id}" aria-label="Remover lançamento de ${formatDateBR(c.date)}">${icon('trash-2')}</button>
            </span>
          </li>`)}
      </ul>` : html`<p class="muted">Nenhum valor guardado ainda.</p>`,
  });
  dialog.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    A.deleteContribution(goal.id, btn.dataset.del);
    btn.closest('li').remove();
  });
}
