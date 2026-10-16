// =============================================================
// Metas — objetivos de economia e lista de desejos
// -------------------------------------------------------------
// • Metas: guarde por contribuições ou ligue a investimentos (o saldo
//   do investimento conta como guardado). Marque qual é a reserva de
//   emergência (entra na Saúde financeira, sem contar em dobro).
// • Desejos: o que você quer comprar, com preço-alvo, preço atual e a
//   meta onde junta o dinheiro. Avisa quando o preço chega no alvo.
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { meter } from '../ui/charts.js';
import { openDialog } from '../ui/dialog.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { helpTip } from '../ui/help.js';
import { toast } from '../ui/toast.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, formatPercent } from '../core/money.js';
import { formatDateBR, todayISO } from '../core/dates.js';
import { goalProgress } from '../domain/planning.js';
import * as A from '../domain/actions.js';

const TABS = [
  { id: 'metas', label: 'Metas', icon: 'target' },
  { id: 'desejos', label: 'Lista de desejos', icon: 'gift' },
];

export default {
  id: 'metas',
  title: 'Metas',

  render() {
    const active = currentTab(TABS);
    return html`${tabsNav('metas', TABS, active)}${active === 'metas' ? goals() : wishes()}`;
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
    'wish:new': () => E.editWish(),
    'wish:edit': (el) => E.editWish(store.data.wishlist.find((w) => w.id === el.dataset.id)),
    'wish:bought': (el) => { A.markWishBought(el.dataset.id, true); toast('Comprado!', { action: { label: 'Desfazer', run: () => A.markWishBought(el.dataset.id, false) } }); },
    'wish:delete': (el) => E.deleteWithUndo(() => A.deleteWish(el.dataset.id), 'Desejo excluído.'),
  },
};

const find = (el) => store.data.goals.find((g) => g.id === el.dataset.id);

function goals() {
  const list = store.data.goals;
  const today = todayISO();
  const plans = list.map((g) => ({ g, p: goalProgress(store.data, g, today) }));
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

    ${list.length ? html`<div class="cards-grid">${plans.map(({ g, p }) => card(g, p))}</div>`
    : html`
      <div class="card empty">
        ${icon('piggy-bank', 'icon--lg')}
        <p><strong>Nenhuma meta ainda.</strong></p>
        <p class="muted">Crie objetivos como "Reserva de emergência" ${helpTip('reserva')} e registre quanto guardou — ou ligue a meta ao investimento onde o dinheiro está.</p>
        <button type="button" class="btn btn--primary" data-action="goal:new">${icon('plus')} Nova meta</button>
      </div>`}`;
}

function card(g, p) {
  const invs = (store.data.investments || []).filter((i) => (g.investmentIds || []).includes(i.id));
  return html`
    <article class="card entity goal ${p.done ? 'is-done tone-good' : p.late ? 'tone-warn' : 'tone-info'}">
      <header class="entity__head">
        <span class="entity__icon entity__icon--goal">${g.icon}</span>
        <div class="entity__title">
          <h3>${g.description} ${g.emergency ? html`<span class="badge badge--info">${icon('shield-check', 'icon--xs')} reserva</span>` : ''}</h3>
          <p class="muted small">${g.deadline ? `Prazo: ${formatDateBR(g.deadline)}` : 'Sem prazo'}</p>
        </div>
        <p class="entity__value">${formatPercent(p.progress)}</p>
      </header>
      ${meter(p.saved, { max: g.targetCents, label: `Progresso de ${g.description}`, tone: p.done ? 'good' : p.late ? 'warn' : '' })}
      <p class="entity__progress">
        <span><strong class="money">${formatBRL(p.saved)}</strong> guardados</span>
        <span>meta ${formatBRL(g.targetCents)}</span>
      </p>
      ${invs.length ? html`<p class="small muted">${icon('coins', 'icon--xs')} ${formatBRL(p.linked)} em ${invs.map((i) => i.name).join(', ')}${p.contributed ? ` + ${formatBRL(p.contributed)} guardados à parte` : ''}</p>` : ''}
      <p class="entity__meta">
        ${p.done ? html`${icon('circle-check', 'icon--xs pos')} Meta alcançada!`
          : p.late ? html`${icon('triangle-alert', 'icon--xs')} Prazo passou · faltam ${formatBRL(p.remaining)}`
          : p.perMonth ? html`Guarde <strong>${formatBRL(p.perMonth)}/mês</strong> por ${p.monthsLeft} ${p.monthsLeft === 1 ? 'mês' : 'meses'}`
          : html`Faltam ${formatBRL(p.remaining)}`}
      </p>
      <footer class="entity__actions">
        <button type="button" class="btn btn--primary btn--sm" data-action="goal:add" data-id="${g.id}">${icon('plus', 'icon--xs')} Guardar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="goal:withdraw" data-id="${g.id}" ${p.contributed <= 0 ? 'disabled' : ''}>Retirar</button>
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
      </ul>` : html`<p class="muted">Nenhum valor guardado à parte ainda.</p>`,
  });
  dialog.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    try { A.deleteContribution(goal.id, btn.dataset.del); btn.closest('li').remove(); toast('Removido.', { action: { label: 'Desfazer', run: () => store.undo() } }); } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

// ---------- Lista de desejos ----------

function wishes() {
  const d = store.data;
  const list = [...(d.wishlist || [])].sort((a, b) => Boolean(a.boughtAt) - Boolean(b.boughtAt) || ['alta', 'media', 'baixa'].indexOf(a.priority) - ['alta', 'media', 'baixa'].indexOf(b.priority));
  const today = todayISO();
  return html`
    <div class="page-head">
      <p class="muted">Anote o que quer comprar, o preço que topa pagar e junte numa meta. Atualize o preço de vez em quando.</p>
      <button type="button" class="btn btn--primary" data-action="wish:new">${icon('plus')} Novo desejo</button>
    </div>
    ${list.length ? html`
      <div class="cards-grid">
        ${list.map((w) => {
          const goal = d.goals.find((g) => g.id === w.goalId);
          const gp = goal ? goalProgress(d, goal, today) : null;
          const atTarget = w.targetPriceCents && w.currentPriceCents && w.currentPriceCents <= w.targetPriceCents;
          const price = w.currentPriceCents || w.targetPriceCents;
          return html`
            <article class="card entity ${w.boughtAt ? 'is-muted' : atTarget ? 'tone-good' : ''}">
              <header class="entity__head">
                <span class="entity__icon">${icon('gift')}</span>
                <div class="entity__title">
                  <h3>${w.name}</h3>
                  <p class="muted small">prioridade ${w.priority === 'media' ? 'média' : w.priority}${w.url ? html` · <a href="${w.url}" target="_blank" rel="noopener noreferrer">ver na loja</a>` : ''}</p>
                </div>
                <p class="entity__value money">${price ? formatBRL(price) : '—'}</p>
              </header>
              ${w.boughtAt ? html`<p class="entity__meta">${icon('check', 'icon--xs pos')} Comprado em ${formatDateBR(w.boughtAt)}</p>` : html`
                <p class="entity__meta">
                  ${w.targetPriceCents ? html`Alvo ${formatBRL(w.targetPriceCents)}` : ''}
                  ${atTarget ? html`<span class="badge badge--good">${icon('check', 'icon--xs')} chegou no preço-alvo!</span>` : w.targetPriceCents && w.currentPriceCents ? html`<span class="badge">faltam ${formatBRL(w.currentPriceCents - w.targetPriceCents)} de desconto</span>` : ''}
                </p>
                ${goal ? html`
                  ${meter(gp.saved, { max: price || goal.targetCents, label: `Guardado para ${w.name}`, tone: gp.saved >= price ? 'good' : '' })}
                  <p class="small muted">Meta "${goal.description}": ${formatBRL(gp.saved)} de ${formatBRL(price || goal.targetCents)}${gp.saved >= price ? ' · dá para comprar à vista!' : ''}</p>` : ''}`}
              <footer class="entity__actions">
                ${w.boughtAt ? '' : html`<button type="button" class="btn btn--secondary btn--sm" data-action="wish:bought" data-id="${w.id}">${icon('check', 'icon--xs')} Comprei</button>
                  <a class="btn btn--ghost btn--sm" href="#/planejamento?aba=comprar&valor=${price || 0}">${icon('calculator', 'icon--xs')} Posso comprar?</a>`}
                <button type="button" class="icon-btn" data-action="wish:edit" data-id="${w.id}" aria-label="Editar ${w.name}">${icon('pencil')}</button>
                <button type="button" class="icon-btn danger" data-action="wish:delete" data-id="${w.id}" aria-label="Excluir ${w.name}">${icon('trash-2')}</button>
              </footer>
            </article>`;
        })}
      </div>`
    : html`<div class="card empty">${icon('gift', 'icon--lg')}<p><strong>Nenhum desejo anotado.</strong></p><p class="muted">Celular novo, viagem, bicicleta… anote, defina o preço que topa pagar e ligue a uma meta.</p><button type="button" class="btn btn--primary" data-action="wish:new">${icon('plus')} Novo desejo</button></div>`}`;
}
