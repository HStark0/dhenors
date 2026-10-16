// =============================================================
// Cartões e contas — cartões de crédito (faturas) e contas/carteiras
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { meter } from '../ui/charts.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { helpTip } from '../ui/help.js';
import { toast } from '../ui/toast.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { formatBRL, sumCents } from '../core/money.js';
import { todayISO, formatDateBR, formatMonth, addMonthsYM, ymOf } from '../core/dates.js';
import { invoice, cardUsage, nextInvoice } from '../domain/cards.js';
import { accountsSummary, accountMovements, ACCOUNT_KIND_LABELS, ACCOUNT_KIND_ICONS } from '../domain/accounts.js';
import { incomeFor } from '../domain/ledger.js';
import { paydayIn } from '../domain/payroll.js';
import * as A from '../domain/actions.js';

const TABS = [
  { id: 'cartoes', label: 'Cartões de crédito', icon: 'credit-card' },
  { id: 'contas', label: 'Contas bancárias e carteiras', icon: 'wallet' },
];

const salaryFn = (state) => (ym) => {
  const inc = incomeFor(state, ym);
  return { date: paydayIn(state.settings, ym), cents: inc.salary + (inc.payrollExtrasNet || 0) };
};

export default {
  id: 'carteira',
  title: 'Cartões e contas bancárias',
  shortTitle: 'Carteira',

  render() {
    const active = currentTab(TABS);
    return html`
      ${tabsNav('carteira', TABS, active)}
      ${active === 'cartoes' ? cards() : accounts()}`;
  },

  actions: {
    'card:new': () => E.editCard(),
    'card:edit': (el) => E.editCard(store.data.cards.find((c) => c.id === el.dataset.id)),
    'card:delete': (el) => {
      const c = store.data.cards.find((x) => x.id === el.dataset.id);
      E.confirmDelete(`o cartão "${c.name}" com todas as compras`, () => A.deleteCard(c.id));
    },
    'card:buy': (el) => E.editPurchase(null, { cardId: el.dataset.id }),
    'card:invoice': (el) => E.invoiceDetails(el.dataset.id, el.dataset.ym),
    'acc:new': () => E.editAccount(),
    'acc:edit': (el) => E.editAccount(store.data.accounts.find((a) => a.id === el.dataset.id)),
    'acc:delete': (el) => {
      const a = store.data.accounts.find((x) => x.id === el.dataset.id);
      E.confirmDelete(`a conta "${a.name}"`, () => A.deleteAccount(a.id));
    },
    'acc:check': (el) => {
      const a = store.data.accounts.find((x) => x.id === el.dataset.id);
      const s = accountsSummary(store.data, todayISO(), { salaryFn: salaryFn(store.data) }).list.find((x) => x.account.id === a.id);
      E.balanceCheckDialog(a, s.balance);
    },
    'acc:transfer': () => E.transferDialog(),
    'acc:statement': (el) => statement(el.dataset.id),
    'tr:delete': (el) => E.deleteWithUndo(() => A.deleteTransfer(el.dataset.id), 'Transferência excluída.'),
  },
};

// ---------- Cartões ----------

function cards() {
  const d = store.data;
  const today = todayISO();
  const list = (d.cards || []).filter((c) => !c.archived);
  if (!list.length) {
    return html`
      <div class="card empty">
        ${icon('credit-card', 'icon--lg')}
        <p><strong>Nenhum cartão cadastrado.</strong></p>
        <p class="muted">Com o cartão cadastrado (dia de fechamento e de vencimento), cada compra entra na fatura certa, as parcelas ficam dentro das faturas e a fatura vira uma conta do mês.</p>
        <button type="button" class="btn btn--primary" data-action="card:new">${icon('plus')} Cadastrar cartão</button>
      </div>`;
  }
  return html`
    <div class="page-head">
      <p class="muted">Compra no dia do fechamento ou depois já vai para a fatura seguinte ${helpTip('fatura')}</p>
      <button type="button" class="btn btn--primary" data-action="card:new">${icon('plus')} Novo cartão</button>
    </div>
    <div class="cards-grid">
      ${list.map((c) => {
        const next = nextInvoice(d, c, today);
        const usage = cardUsage(d, c, today);
        const prevYM = addMonthsYM(next.ym, -1);
        const prev = invoice(d, c, prevYM, today);
        return html`
          <article class="card entity credit-card" style="--card:${c.color}">
            <header class="entity__head">
              <span class="credit-card__chip" aria-hidden="true">${icon('credit-card')}</span>
              <div class="entity__title">
                <h3>${c.name}</h3>
                <p class="muted small">fecha dia ${c.closingDay} · vence dia ${c.dueDay}</p>
              </div>
              <button type="button" class="icon-btn" data-action="card:edit" data-id="${c.id}" aria-label="Editar ${c.name}">${icon('pencil')}</button>
            </header>
            <div class="credit-card__invoice">
              <p class="small muted">Fatura de ${formatMonth(next.ym)} · ${next.status === 'open' ? `fecha em ${next.daysToClose} ${next.daysToClose === 1 ? 'dia' : 'dias'}` : 'fechada'}</p>
              <p class="big-number money">${formatBRL(next.total)}</p>
              <p class="small muted">vence ${formatDateBR(next.due)} · ${next.lines.length} ${next.lines.length === 1 ? 'lançamento' : 'lançamentos'}</p>
            </div>
            ${prev.total > 0 ? html`
              <p class="entity__meta">${icon('receipt', 'icon--xs')} Fatura de ${formatMonth(prevYM)}: <strong class="money">${formatBRL(prev.total)}</strong>
                ${prev.paidAt ? html`<span class="badge badge--paid">${icon('check', 'icon--xs')} paga</span>` : html`<span class="badge ${prev.due < today ? 'badge--bad' : ''}">${prev.due < today ? 'atrasada' : `vence ${formatDateBR(prev.due)}`}</span>`}</p>` : ''}
            ${usage.limit ? html`
              ${meter(Math.max(0, usage.used), { max: usage.limit, label: `Limite usado: ${Math.round(usage.pct)}%`, tone: usage.pct > 90 ? 'bad' : usage.pct > 70 ? 'warn' : '' })}
              <p class="entity__progress"><span>Usado ${formatBRL(usage.used)}</span><span>Disponível <strong>${formatBRL(usage.available)}</strong></span></p>` : ''}
            <footer class="entity__actions">
              <button type="button" class="btn btn--primary btn--sm" data-action="card:buy" data-id="${c.id}">${icon('plus', 'icon--xs')} Compra</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="card:invoice" data-id="${c.id}" data-ym="${next.ym}">Fatura atual</button>
              ${prev.total > 0 ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="card:invoice" data-id="${c.id}" data-ym="${prevYM}">Anterior</button>` : ''}
              <button type="button" class="icon-btn danger" data-action="card:delete" data-id="${c.id}" aria-label="Excluir ${c.name}">${icon('trash-2')}</button>
            </footer>
          </article>`;
      })}
    </div>`;
}

// ---------- Contas e carteiras ----------

function accounts() {
  const d = store.data;
  const today = todayISO();
  const sum = accountsSummary(d, today, { salaryFn: salaryFn(d) });
  const transfers = [...(d.transfers || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (!sum.list.length) {
    return html`
      <div class="card empty">
        ${icon('wallet', 'icon--lg')}
        <p><strong>Nenhuma conta cadastrada.</strong></p>
        <p class="muted">Cadastre suas contas (Nubank, conta-salário, dinheiro na carteira) com o saldo de hoje. O app acompanha o saldo de cada uma, as transferências e mostra a diferença para o saldo real do banco.</p>
        <button type="button" class="btn btn--primary" data-action="acc:new">${icon('plus')} Cadastrar conta</button>
      </div>`;
  }
  return html`
    <div class="page-head">
      <dl class="stats">
        <div><dt>Saldo previsto em todas</dt><dd class="money ${sum.total < 0 ? 'neg' : ''}">${formatBRL(sum.total)}</dd></div>
        <div><dt>Contas</dt><dd>${sum.list.length}</dd></div>
      </dl>
      <div class="page-head__actions">
        <button type="button" class="btn btn--ghost" data-action="acc:transfer">${icon('arrow-left-right')} Transferir</button>
        <button type="button" class="btn btn--primary" data-action="acc:new">${icon('plus')} Nova conta bancária</button>
      </div>
    </div>
    <div class="cards-grid">
      ${sum.list.map(({ account: a, balance, check, diff }) => html`
        <article class="card entity">
          <header class="entity__head">
            <span class="cat-icon cat-icon--md" style="--cat:${a.color}" aria-hidden="true">${icon(ACCOUNT_KIND_ICONS[a.kind] || 'wallet')}</span>
            <div class="entity__title">
              <h3>${a.name}${d.settings.salaryAccountId === a.id ? html` <span class="badge badge--info">salário</span>` : ''}</h3>
              <p class="muted small">${ACCOUNT_KIND_LABELS[a.kind]}${a.institution ? ` · ${a.institution}` : ''}</p>
            </div>
            <p class="entity__value money ${balance < 0 ? 'neg' : ''}">${formatBRL(balance)}</p>
          </header>
          <p class="entity__meta">
            ${check ? html`${icon('scale', 'icon--xs')} Conferido em ${formatDateBR(check.date)}: banco ${formatBRL(check.cents)}
              ${diff ? html`<span class="badge ${Math.abs(diff) > 5000 ? 'badge--warn' : ''}">diferença ${diff > 0 ? '+' : '−'}${formatBRL(Math.abs(diff))}</span>` : html`<span class="badge badge--good">confere</span>`}`
            : html`${icon('info', 'icon--xs')} Saldo de partida ${formatBRL(a.anchor.cents)} em ${formatDateBR(a.anchor.date)}`}
            ${helpTip('saldoReal')}
          </p>
          <footer class="entity__actions">
            <button type="button" class="btn btn--secondary btn--sm" data-action="acc:check" data-id="${a.id}">${icon('scale', 'icon--xs')} Conferir com o banco</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="acc:statement" data-id="${a.id}">Extrato</button>
            <button type="button" class="icon-btn" data-action="acc:edit" data-id="${a.id}" aria-label="Editar ${a.name}">${icon('pencil')}</button>
            <button type="button" class="icon-btn danger" data-action="acc:delete" data-id="${a.id}" aria-label="Excluir ${a.name}">${icon('trash-2')}</button>
          </footer>
        </article>`)}
    </div>
    ${transfers.length ? html`
      <article class="card">
        <h2 class="card__title">${icon('arrow-left-right')} Transferências recentes</h2>
        <ul class="mini-list">
          ${transfers.map((t) => {
            const from = d.accounts.find((a) => a.id === t.fromId);
            const to = d.accounts.find((a) => a.id === t.toId);
            return html`<li><span>${from?.name} → ${to?.name} <small class="muted">${formatDateBR(t.date)}${t.note ? ` · ${t.note}` : ''}</small></span><span class="money">${formatBRL(t.cents)}</span>
              <span class="mini-list__actions"><button type="button" class="icon-btn icon-btn--sm danger" data-action="tr:delete" data-id="${t.id}" aria-label="Excluir transferência">${icon('trash-2')}</button></span></li>`;
          })}
        </ul>
      </article>` : ''}
    <p class="muted small">Para o saldo bater, informe a conta ao lançar gastos, receitas e ao pagar contas (campo "Conta"). A fatura do cartão sai da conta escolhida no cartão.</p>`;
}

function statement(accountId) {
  const d = store.data;
  const a = d.accounts.find((x) => x.id === accountId);
  const movs = accountMovements(d, a, todayISO(), { salaryFn: salaryFn(d) }).reverse().slice(0, 100);
  import('../ui/dialog.js').then(({ openDialog }) => openDialog({
    title: `Extrato · ${a.name}`,
    body: movs.length ? html`
      <ul class="mini-list">
        ${movs.map((m) => html`<li><span>${m.label} <small class="muted">${formatDateBR(m.date)}</small></span><span class="money ${m.cents > 0 ? 'pos' : ''}">${m.cents > 0 ? '+' : '−'}${formatBRL(Math.abs(m.cents))}</span></li>`)}
      </ul>
      <p class="field__hint">Desde o saldo de partida (${formatBRL(a.anchor.cents)} em ${formatDateBR(a.anchor.date)}). Total: ${formatBRL(sumCents(movs.map((m) => m.cents)))}.</p>`
      : html`<p class="muted">Nenhum movimento ligado a esta conta desde ${formatDateBR(a.anchor.date)}.</p>`,
  }));
  if (ymOf(a.anchor.date) < addMonthsYM(ymOf(todayISO()), -12)) toast('Dica: confira o saldo com o banco de vez em quando para manter o previsto certinho.', { type: 'info' });
}
