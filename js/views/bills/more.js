// =============================================================
// Contas → Assinaturas · A receber · Dívidas
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { lineChart, chartWidth } from '../../ui/charts.js';
import { catIcon } from '../../ui/catIcon.js';
import { toast } from '../../ui/toast.js';
import * as E from '../../ui/editors.js';
import { store } from '../../core/store.js';
import { formatBRL, sumCents, toCents } from '../../core/money.js';
import { formatDateBR, todayISO, relativeDays, currentYM, addMonthsYM, formatMonthShort } from '../../core/dates.js';
import { subscriptionsSummary, comparePayoff } from '../../domain/debts.js';
import { FREQ_LABELS } from '../../domain/ledger.js';
import * as A from '../../domain/actions.js';

// ---------- Assinaturas ----------

export function renderSubscriptions() {
  const d = store.data;
  const s = subscriptionsSummary(d, todayISO());
  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Por mês</dt><dd class="money">${formatBRL(s.monthly)}</dd></div>
        <div><dt>Por ano</dt><dd class="money">${formatBRL(s.annual)}</dd></div>
        <div><dt>Assinaturas</dt><dd>${s.list.length}</dd></div>
      </dl>
      <button type="button" class="btn btn--primary" data-action="subscription:new">${icon('plus')} Nova assinatura</button>
    </div>
    ${s.list.length ? html`
      <article class="card">
        <ul class="rows">
          ${s.list.map((x) => {
            const cat = d.categories.find((c) => c.id === x.rec.categoryId);
            const card = x.rec.cardId ? d.cards.find((c) => c.id === x.rec.cardId) : null;
            return html`
              <li class="row">
                <button type="button" class="row__main" data-action="rec:edit" data-id="${x.rec.id}">
                  ${catIcon(cat || { icon: 'i:tv', color: '#64748B' })}
                  <span>
                    <strong>${x.rec.description}</strong>
                    <small class="muted">${FREQ_LABELS[x.rec.freq || 'monthly']} · ${formatBRL(x.rec.cents)}${card ? ` · cartão ${card.name}` : ''}${x.renewalDays != null ? ` · renova ${relativeDays(x.rec.renewal)}` : ''}</small>
                    ${x.increase ? html`<small class="warn">${icon('trending-up', 'icon--xs')} Aumentou ${x.increase.pct.toFixed(0)}% (${formatBRL(x.increase.from)} → ${formatBRL(x.increase.to)})</small>` : ''}
                  </span>
                </button>
                <span class="row__value"><span class="money">${formatBRL(x.annual)}</span><small class="muted">por ano</small></span>
              </li>`;
          })}
        </ul>
      </article>
      <p class="muted small">Dica: some quanto paga por ano em assinaturas e veja se todas valem a pena. Para lançar o aumento, edite o valor: o histórico de preço fica guardado.</p>`
    : html`<div class="card empty">${icon('tv', 'icon--lg')}<p><strong>Nenhuma assinatura marcada.</strong></p><p class="muted">Streaming, apps, academia, nuvem… cadastre como recorrente e ligue "É uma assinatura".</p><button type="button" class="btn btn--primary" data-action="subscription:new">${icon('plus')} Nova assinatura</button></div>`}`;
}

// ---------- A receber ("quem me deve") ----------

export function renderReceivables() {
  const d = store.data;
  const list = [...(d.receivables || [])].sort((a, b) => Boolean(a.receivedAt) - Boolean(b.receivedAt) || (a.dueDate || a.date).localeCompare(b.dueDate || b.date));
  const open = list.filter((r) => !r.receivedAt);
  const left = (r) => r.cents - sumCents((r.partials || []).map((p) => p.cents));
  const total = sumCents(open.map(left));
  const byPerson = new Map();
  for (const r of open) byPerson.set(r.person, (byPerson.get(r.person) || 0) + left(r));
  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Para receber</dt><dd class="money pos">${formatBRL(total)}</dd></div>
        <div><dt>Pessoas</dt><dd>${byPerson.size}</dd></div>
      </dl>
      <button type="button" class="btn btn--primary" data-action="rcv:new">${icon('plus')} Alguém me deve</button>
    </div>
    ${list.length ? html`
      <article class="card">
        <ul class="rows">
          ${list.map((r) => {
            const late = !r.receivedAt && r.dueDate && r.dueDate < todayISO();
            return html`
              <li class="row ${r.receivedAt ? 'is-muted' : ''}">
                <div class="row__main">
                  <span class="avatar" aria-hidden="true">${(r.person || '?').slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>${r.person}</strong> · ${r.description}
                    <small class="muted">emprestado em ${formatDateBR(r.date)}${r.dueDate ? ` · combinado para ${formatDateBR(r.dueDate)}` : ''}${(r.partials || []).length ? ` · recebido ${formatBRL(sumCents(r.partials.map((p) => p.cents)))}` : ''}</small>
                    ${late ? html`<small class="neg">${icon('circle-alert', 'icon--xs')} Atrasado</small>` : ''}
                    ${r.receivedAt ? html`<small class="pos">${icon('check', 'icon--xs')} Recebido em ${formatDateBR(r.receivedAt)}</small>` : ''}
                  </span>
                </div>
                <span class="row__value"><span class="money">${formatBRL(r.receivedAt ? r.cents : left(r))}</span><small class="muted">${r.receivedAt ? 'quitado' : 'falta'}</small></span>
                <span class="row__actions">
                  ${r.receivedAt ? html`<button type="button" class="icon-btn" data-action="rcv:reopen" data-id="${r.id}" aria-label="Reabrir">${icon('rotate-ccw')}</button>`
                    : html`<button type="button" class="btn btn--secondary btn--sm" data-action="rcv:receive" data-id="${r.id}">Recebi</button>`}
                  <button type="button" class="icon-btn" data-action="rcv:edit" data-id="${r.id}" aria-label="Editar">${icon('pencil')}</button>
                  <button type="button" class="icon-btn danger" data-action="rcv:delete" data-id="${r.id}" aria-label="Excluir">${icon('trash-2')}</button>
                </span>
              </li>`;
          })}
        </ul>
      </article>`
    : html`<div class="card empty">${icon('hand-coins', 'icon--lg')}<p><strong>Ninguém te deve nada.</strong></p><p class="muted">Emprestou dinheiro para alguém, vendeu algo a prazo ou espera um reembolso? Anote aqui e receba lembrete na data combinada.</p><button type="button" class="btn btn--primary" data-action="rcv:new">${icon('plus')} Alguém me deve</button></div>`}`;
}

// ---------- Dívidas e renegociações ----------

export function renderDebts() {
  const d = store.data;
  const debts = d.debts || [];
  const extra = Number(store.ui.filters.debtExtra || 0);
  const cmp = debts.length ? comparePayoff(debts, extra) : null;
  const total = sumCents(debts.map((x) => x.balanceCents));
  const fmtMonths = (r) => (r.months == null ? 'nunca (o pagamento não cobre os juros)' : `${r.months} ${r.months === 1 ? 'mês' : 'meses'} (${formatMonthShort(addMonthsYM(currentYM(), r.months))})`);
  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Total devido</dt><dd class="money neg">${formatBRL(total)}</dd></div>
        <div><dt>Dívidas</dt><dd>${debts.length}</dd></div>
      </dl>
      <button type="button" class="btn btn--primary" data-action="debt:new">${icon('plus')} Nova dívida</button>
    </div>
    ${debts.length ? html`
      <section class="grid grid--two">
        <article class="card">
          <h2 class="card__title">${icon('landmark')} Suas dívidas</h2>
          <ul class="rows">
            ${[...debts].sort((a, b) => b.rateMonthlyBp - a.rateMonthlyBp).map((x) => html`
              <li class="row">
                <button type="button" class="row__main" data-action="debt:edit" data-id="${x.id}">
                  <span><strong>${x.name}</strong><small class="muted">${(x.rateMonthlyBp / 100).toLocaleString('pt-BR')}% ao mês · paga ${formatBRL(x.paymentCents)}/mês</small></span>
                </button>
                <span class="row__value"><span class="money">${formatBRL(x.balanceCents)}</span></span>
                <span class="row__actions"><button type="button" class="icon-btn danger" data-action="debt:delete" data-id="${x.id}" aria-label="Excluir ${x.name}">${icon('trash-2')}</button></span>
              </li>`)}
          </ul>
        </article>
        <article class="card">
          <h2 class="card__title">${icon('calculator')} Plano de quitação</h2>
          <div class="field">
            <label class="field__label" for="debt-extra">Quanto a mais você consegue pagar por mês?</label>
            <div class="field__control has-prefix"><span class="field__prefix" aria-hidden="true">R$</span><input class="input" id="debt-extra" data-filter="debtExtra" data-money="1" inputmode="decimal" value="${extra ? (extra / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}" placeholder="0,00"></div>
          </div>
          <dl class="kv kv--stack">
            <div><span>Só os mínimos</span><strong>${fmtMonths(cmp.minimum)} · juros ${formatBRL(cmp.minimum.interest)}</strong></div>
            <div><span>Avalanche (maior juro primeiro)</span><strong>${fmtMonths(cmp.avalanche)} · juros ${formatBRL(cmp.avalanche.interest)}</strong></div>
            <div><span>Bola de neve (menor dívida primeiro)</span><strong>${fmtMonths(cmp.snowball)} · juros ${formatBRL(cmp.snowball.interest)}</strong></div>
          </dl>
          <p class="field__hint">A <strong>avalanche</strong> economiza mais juros; a <strong>bola de neve</strong> dá vitórias rápidas e ajuda a manter o ritmo. ${cmp.avalanche.interest < cmp.snowball.interest ? `Aqui, a avalanche economiza ${formatBRL(cmp.snowball.interest - cmp.avalanche.interest)}.` : ''}</p>
          ${cmp.avalanche.order.length ? html`<p class="small"><strong>Ordem (avalanche):</strong> ${cmp.avalanche.order.map((o) => `${o.name} (mês ${o.month})`).join(' → ')}</p>` : ''}
          ${lineChart(cmp.avalanche.timeline.map((t) => formatMonthShort(addMonthsYM(currentYM(), t.month))), [
            { name: 'Avalanche', values: cmp.avalanche.timeline.map((t) => t.balance), className: 'is-balance' },
            { name: 'Só mínimos', values: cmp.avalanche.timeline.map((_, i) => cmp.minimum.timeline[i]?.balance ?? 0), className: 'is-spent', dashed: true },
          ], { label: 'Saldo devedor ao longo do tempo', width: chartWidth(0.5) })}
        </article>
      </section>`
    : html`<div class="card empty">${icon('landmark', 'icon--lg')}<p><strong>Nenhuma dívida cadastrada.</strong></p><p class="muted">Cartão rotativo, cheque especial, empréstimos, acordos: informe saldo, juros e parcela para ver quando quita e qual pagar primeiro.</p><button type="button" class="btn btn--primary" data-action="debt:new">${icon('plus')} Nova dívida</button></div>`}`;
}

const findR = (el) => store.data.receivables.find((x) => x.id === el.dataset.id);
const findD = (el) => store.data.debts.find((x) => x.id === el.dataset.id);

export const moreActions = {
  'subscription:new': () => E.editRecurring(null, { preset: { subscription: true } }),
  'rcv:new': () => E.editReceivable(),
  'rcv:edit': (el) => E.editReceivable(findR(el)),
  'rcv:receive': (el) => E.receiveDialog(findR(el)),
  'rcv:reopen': (el) => { A.reopenReceivable(el.dataset.id); toast('Reaberto.'); },
  'rcv:delete': (el) => E.deleteWithUndo(() => A.deleteReceivable(el.dataset.id), 'Excluído.'),
  'debt:new': () => E.editDebt(),
  'debt:edit': (el) => E.editDebt(findD(el)),
  'debt:delete': (el) => E.deleteWithUndo(() => A.deleteDebt(el.dataset.id), 'Dívida excluída.'),
};

export function onDebtFilter(name, value) {
  if (name === 'debtExtra') store.setUI({ filters: { ...store.ui.filters, debtExtra: Math.max(0, toCents(value) || 0) } });
}

