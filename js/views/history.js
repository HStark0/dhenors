// =============================================================
// Histórico — meses anteriores, fechamento e relatórios
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { meter } from '../ui/charts.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { store } from '../core/store.js';
import { formatBRL, percent, formatPercent } from '../core/money.js';
import { formatMonth, formatMonthTitle, formatDateBR, currentYM, todayISO } from '../core/dates.js';
import { monthsWithData, monthSummary, buildSnapshot } from '../domain/analysis.js';
import * as A from '../domain/actions.js';

export default {
  id: 'historico',
  title: 'Histórico',

  render() {
    const d = store.data;
    const today = todayISO();
    const months = monthsWithData(d, today);

    if (!months.length) {
      return html`
        <div class="card empty">
          ${icon('history', 'icon--lg')}
          <p><strong>Nada no histórico ainda.</strong></p>
          <p class="muted">Os meses aparecem aqui conforme você lança renda e contas. Ao fechar um mês, os números ficam congelados para consulta.</p>
        </div>`;
    }

    return html`
      <p class="muted page-intro">Fechar um mês guarda uma "fotografia" dos números e bloqueia edições nele. Nada é apagado e você pode reabrir quando quiser.</p>
      <article class="card">
        <div class="table-wrap">
          <table class="table table--history">
            <thead>
              <tr><th scope="col">Mês</th><th scope="col">Renda</th><th scope="col">Gastos</th><th scope="col">Saldo</th><th scope="col">Situação</th><th scope="col"><span class="sr-only">Ações</span></th></tr>
            </thead>
            <tbody>
              ${months.map((ym) => {
                const s = monthSummary(d, ym, today);
                return html`
                  <tr>
                    <th scope="row">${formatMonthTitle(ym)}</th>
                    <td class="money">${formatBRL(s.income)}</td>
                    <td class="money">${formatBRL(s.spent)}</td>
                    <td class="money strong ${s.balance < 0 ? 'neg' : 'pos'}">${formatBRL(s.balance)}</td>
                    <td>${s.closed
                      ? html`<span class="badge badge--muted">${icon('lock', 'icon--xs')} Fechado</span>`
                      : html`<span class="badge">${ym === currentYM() ? 'Mês atual' : 'Aberto'}</span>`}</td>
                    <td><div class="table__actions">
                      <button type="button" class="btn btn--ghost btn--sm" data-action="hist:report" data-ym="${ym}">Relatório</button>
                      ${s.closed
                        ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="hist:reopen" data-ym="${ym}">${icon('lock-open', 'icon--xs')} Reabrir</button>`
                        : html`<button type="button" class="btn btn--ghost btn--sm" data-action="hist:close" data-ym="${ym}">${icon('lock', 'icon--xs')} Fechar</button>`}
                    </div></td>
                  </tr>`;
              })}
            </tbody>
          </table>
        </div>
      </article>`;
  },

  actions: {
    'hist:report': (el) => report(el.dataset.ym),
    'hist:close': async (el) => {
      const ym = el.dataset.ym;
      const ok = await confirmDialog({ title: `Fechar ${formatMonth(ym)}`, message: 'Os números serão congelados e o mês fica bloqueado para edições. Você pode reabrir depois.', confirmLabel: 'Fechar mês' });
      if (ok) { A.closeMonth(ym); toast(`${formatMonth(ym)} fechado.`); }
    },
    'hist:reopen': async (el) => {
      const ym = el.dataset.ym;
      const ok = await confirmDialog({ title: `Reabrir ${formatMonth(ym)}`, message: 'O mês volta a aceitar edições e os números passam a ser recalculados. A fotografia salva no fechamento será descartada.', confirmLabel: 'Reabrir' });
      if (ok) { A.reopenMonth(ym); toast(`${formatMonth(ym)} reaberto.`); }
    },
  },
};

/** Relatório do mês (usa a fotografia se fechado). Pode ser impresso / salvo em PDF. */
function report(ym) {
  const d = store.data;
  const snap = d.closedMonths[ym] || buildSnapshot(d, ym, todayISO());
  const t = snap.totals;
  const top = [...snap.items].sort((a, b) => b.cents - a.cents).slice(0, 10);

  openDialog({
    title: `Relatório de ${formatMonth(ym)}`,
    size: 'lg',
    footer: html`<button type="button" class="btn btn--secondary" data-print>${icon('printer')} Imprimir / PDF</button>`,
    body: html`
      <div class="report">
        <p class="muted small">${d.closedMonths[ym] ? `Mês fechado em ${formatDateBR(snap.closedOn || snap.closedAt.slice(0, 10))}.` : 'Mês em aberto — valores calculados agora.'}</p>
        <div class="kv kv--4">
          <div><span>Renda</span><strong class="money">${formatBRL(snap.income.total)}</strong></div>
          <div><span>Gastos</span><strong class="money">${formatBRL(t.all)}</strong></div>
          <div><span>Saldo</span><strong class="money ${snap.balance < 0 ? 'neg' : 'pos'}">${formatBRL(snap.balance)}</strong></div>
          <div><span>Poupança</span><strong>${formatPercent(percent(snap.balance, snap.income.total))}</strong></div>
        </div>

        <h3 class="dialog__subtitle">Composição</h3>
        <ul class="mini-list">
          ${snap.income.payroll ? html`
            <li><span>Bruto da folha</span><span class="money">${formatBRL(snap.income.payroll.gross)}</span></li>
            <li><span>INSS + Imposto de Renda</span><span class="money neg">−${formatBRL(snap.income.payroll.inss + snap.income.payroll.ir)}</span></li>
            ${snap.income.payroll.deductions ? html`<li><span>Descontos em folha</span><span class="money neg">−${formatBRL(snap.income.payroll.deductions)}</span></li>` : ''}` : ''}
          <li><span>Salário líquido</span><span class="money">${formatBRL(snap.income.salary)}</span></li>
          ${snap.income.extras.map((x) => html`<li><span>${x.description}${x.payroll ? ' (bruto, na folha)' : ''}</span><span class="money pos">+${formatBRL(x.cents)}</span></li>`)}
          ${snap.income.extras.length ? html`<li><span>Extras (líquido)</span><span class="money pos">+${formatBRL(snap.income.extrasCents)}</span></li>` : ''}
          <li><span>Contas avulsas</span><span class="money">${formatBRL(t.expense)}</span></li>
          <li><span>Recorrentes</span><span class="money">${formatBRL(t.recurring)}</span></li>
          <li><span>Parcelas</span><span class="money">${formatBRL(t.installment)}</span></li>
          <li><span>Pago / não pago</span><span class="money">${formatBRL(t.paid)} / ${formatBRL(t.pending)}</span></li>
        </ul>

        <h3 class="dialog__subtitle">Por categoria</h3>
        ${snap.categories.length ? html`
          <ul class="rank">
            ${snap.categories.map((c) => html`
              <li>
                <span class="rank__label">${c.icon} ${c.name}</span>
                <span class="money">${formatBRL(c.cents)} <small>${formatPercent(percent(c.cents, t.all))}</small></span>
                ${meter(c.cents, { max: snap.categories[0].cents, label: c.name })}
              </li>`)}
          </ul>` : html`<p class="muted small">Sem gastos.</p>`}

        <h3 class="dialog__subtitle">Maiores lançamentos</h3>
        ${top.length ? html`
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col">Valor</th></tr></thead>
              <tbody>
                ${top.map((i) => html`
                  <tr>
                    <td>${formatDateBR(i.dueDate)}</td>
                    <td>${i.description}${i.parcel ? ` (${i.parcel.n}/${i.parcel.count})` : ''}${i.paid ? '' : html` <span class="badge badge--bad">não pago</span>`}</td>
                    <td>${i.category}</td>
                    <td class="money">${formatBRL(i.cents)}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>` : html`<p class="muted small">Nenhum lançamento.</p>`}
      </div>`,
    onMount: (dlg) => dlg.querySelector('[data-print]').addEventListener('click', () => {
      document.body.classList.add('is-printing');
      window.print();
      document.body.classList.remove('is-printing');
    }),
  });
}
