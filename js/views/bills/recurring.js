// =============================================================
// Contas → Recorrentes: despesas que se repetem (mensal, semanal,
// quinzenal, bimestral, trimestral, semestral, anual)
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { confirmDialog } from '../../ui/dialog.js';
import { catIcon } from '../../ui/catIcon.js';
import * as E from '../../ui/editors.js';
import { store } from '../../core/store.js';
import { formatBRL } from '../../core/money.js';
import { currentYM, formatMonth, formatMonthShort, addMonthsYM, formatDateBR } from '../../core/dates.js';
import { recurringActiveIn, entryKey, FREQ_LABELS, FREQ_DAYS, recurringDates } from '../../domain/ledger.js';
import { monthlyEquivalent } from '../../domain/debts.js';
import * as A from '../../domain/actions.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function renderRecurring() {
  const d = store.data;
  const now = currentYM();
  const active = d.recurring.filter((r) => recurringActiveIn(r, now) || r.startYM > now);
  const ended = d.recurring.filter((r) => !active.includes(r));
  const monthly = active.filter((r) => recurringActiveIn(r, now)).reduce((a, r) => a + monthlyEquivalent(r), 0);

  return html`
    <div class="page-head">
      <div>
        <p class="muted">Custo mensal das ativas (anuais e semanais convertidas para o mês)</p>
        <p class="big-number money">${formatBRL(monthly)}</p>
      </div>
      <button type="button" class="btn btn--primary" data-action="rec:new">${icon('plus')} Nova recorrente</button>
    </div>

    ${active.length ? html`
      <div class="cards-grid">${sortByDay(active).map((r) => card(r, now))}</div>`
    : html`
      <div class="card empty">
        ${icon('repeat', 'icon--lg')}
        <p><strong>Nenhuma despesa recorrente.</strong></p>
        <p class="muted">Aluguel, internet, plano de saúde, streaming, IPVA (anual)… cadastre uma vez e elas aparecem nos meses certos.</p>
        <button type="button" class="btn btn--primary" data-action="rec:new">${icon('plus')} Nova recorrente</button>
      </div>`}

    ${ended.length ? html`
      <h2 class="section-title">Encerradas</h2>
      <div class="cards-grid">${ended.map((r) => card(r, now))}</div>` : ''}`;
}

const find = (el) => store.data.recurring.find((r) => r.id === el.dataset.id);
const sortByDay = (list) => [...list].sort((a, b) => a.dueDay - b.dueDay || a.description.localeCompare(b.description));

function card(r, now) {
  const d = store.data;
  const cat = d.categories.find((c) => c.id === r.categoryId);
  const cred = d.creditors.find((c) => c.id === r.creditorId);
  const card = r.cardId ? d.cards.find((c) => c.id === r.cardId) : null;
  const isActive = recurringActiveIn(r, now);
  const dates = recurringDates(r, now);
  const k = FREQ_DAYS[r.freq] ? (dates[0] || '') : now;
  const entry = d.recurringEntries[entryKey(r.id, k)];
  const future = r.startYM > now;
  const ended = !isActive && !future;
  const freq = r.freq || 'monthly';

  let status = '';
  if (future) status = html`<span class="badge badge--info">começa em ${formatMonthShort(r.startYM)}</span>`;
  else if (ended) status = html`<span class="badge badge--muted">encerrada em ${formatMonthShort(r.endYM)}</span>`;
  else if (!dates.length) status = html`<span class="badge badge--muted">não vence neste mês</span>`;
  else if (card) status = html`<span class="badge">na fatura do ${card.name}</span>`;
  else if (entry?.skipped) status = html`<span class="badge badge--muted">pulada neste mês</span>`;
  else if (entry?.paidAt) status = html`<span class="badge badge--good">paga neste mês</span>`;
  else status = html`<span class="badge">a pagar neste mês</span>`;

  const when = FREQ_DAYS[freq] ? `${FREQ_LABELS[freq].toLowerCase()} desde ${formatDateBR(r.anchorDate)}`
    : freq === 'monthly' ? `todo dia ${r.dueDay}`
    : `${FREQ_LABELS[freq].toLowerCase()} · dia ${r.dueDay} de ${MONTHS[Number(r.startYM.slice(5)) - 1]}${freq === 'annual' ? '' : ' (a partir de)'}`;

  return html`
    <article class="card entity ${ended ? 'is-muted' : ''}">
      <header class="entity__head">
        ${catIcon(cat || { icon: 'i:repeat', color: '#94A3B8' }, { size: 'md' })}
        <div class="entity__title">
          <h3>${r.description}</h3>
          <p class="muted small">${cat?.name || 'Sem categoria'}${cred ? ` · ${cred.name}` : ''}</p>
        </div>
        <p class="entity__value money">${formatBRL(r.cents)}<small>/${freq === 'monthly' ? 'mês' : FREQ_LABELS[freq].toLowerCase()}</small></p>
      </header>
      <p class="entity__meta">
        ${icon('calendar', 'icon--xs')} ${when}
        · desde ${formatMonthShort(r.startYM)}${r.endYM && !ended ? ` até ${formatMonthShort(r.endYM)}` : ''}
        ${status}
        ${r.variable ? html`<span class="badge badge--info">valor pela média</span>` : ''}
        ${r.subscription ? html`<span class="badge badge--muted">assinatura</span>` : ''}
        ${r.adjust ? html`<span class="badge badge--muted" title="Reajuste anual">reajuste ${r.adjust.index === 'fixo' ? `${(r.adjust.pctBp / 100).toLocaleString('pt-BR')}%` : r.adjust.index.toUpperCase()} em ${MONTHS[r.adjust.month - 1]}</span>` : ''}
      </p>
      <footer class="entity__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-action="rec:edit" data-id="${r.id}">${icon('pencil', 'icon--xs')} Editar</button>
        ${ended
          ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="rec:resume" data-id="${r.id}">${icon('lock-open', 'icon--xs')} Reativar</button>`
          : html`<button type="button" class="btn btn--ghost btn--sm" data-action="rec:end" data-id="${r.id}">${icon('lock', 'icon--xs')} Encerrar</button>`}
        <button type="button" class="btn btn--ghost btn--sm danger" data-action="rec:delete" data-id="${r.id}">${icon('trash-2', 'icon--xs')} Excluir</button>
      </footer>
    </article>`;
}

export const recurringActions = {
  'rec:new': () => E.editRecurring(),
  'rec:edit': (el) => E.editRecurring(find(el)),
  'rec:end': async (el) => {
    const r = find(el);
    const last = addMonthsYM(currentYM(), -1) < r.startYM ? r.startYM : currentYM();
    const ok = await confirmDialog({ title: 'Encerrar recorrente', message: `"${r.description}" aparece até ${formatMonth(last)} e some dos meses seguintes. O histórico é mantido.`, confirmLabel: 'Encerrar' });
    if (ok) { A.endRecurring(r.id, last); toast('Recorrente encerrada.', { action: { label: 'Desfazer', run: () => store.undo() } }); }
  },
  'rec:resume': (el) => { A.resumeRecurring(find(el).id); toast('Recorrente reativada.'); },
  'rec:delete': (el) => {
    const r = find(el);
    E.confirmDelete(`"${r.description}" e todo o histórico de pagamentos dela`, () => A.deleteRecurring(r.id));
  },
};
