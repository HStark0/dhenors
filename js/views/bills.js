// =============================================================
// Contas — todos os compromissos do mês, com busca e filtros
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { itemList } from '../ui/items.js';
import { store } from '../core/store.js';
import { formatBRL, plural } from '../core/money.js';
import { formatMonth, todayISO } from '../core/dates.js';
import { computeMonth } from '../domain/ledger.js';
import { exportMonthCSV } from '../ui/backup.js';

/** Remove acentos para a busca: "agua" encontra "Água". */
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const DEFAULTS = { q: '', kind: '', status: '', category: '', sort: 'date' };

export default {
  id: 'contas',
  title: 'Contas do mês',
  monthNav: true,

  render() {
    const d = store.data;
    const ym = store.ui.ym;
    const f = { ...DEFAULTS, ...store.ui.filters.bills };
    const m = computeMonth(d, ym, todayISO());

    let items = m.items;
    if (f.q) items = items.filter((i) => norm(i.description).includes(norm(f.q)));
    if (f.kind) items = items.filter((i) => i.kind === f.kind);
    if (f.status === 'open') items = items.filter((i) => i.status !== 'paid');
    else if (f.status) items = items.filter((i) => i.status === f.status);
    if (f.category) items = items.filter((i) => (i.categoryId || '_none') === f.category);
    if (f.sort === 'value') items = [...items].sort((a, b) => b.cents - a.cents);
    if (f.sort === 'name') items = [...items].sort((a, b) => a.description.localeCompare(b.description));

    const total = items.reduce((a, i) => a + i.cents, 0);
    const active = Object.entries(f).some(([k, v]) => k !== 'sort' && v);

    return html`
      <div class="toolbar">
        <div class="search">
          ${icon('search')}
          <label class="sr-only" for="bills-q">Buscar contas</label>
          <input id="bills-q" class="input" type="search" placeholder="Buscar pelo nome…" value="${f.q}" data-filter="q" autocomplete="off">
        </div>
        ${select('bills-kind', 'Tipo', 'kind', f.kind, [['', 'Todos os tipos'], ['expense', 'Avulsas'], ['recurring', 'Recorrentes'], ['installment', 'Parcelas']])}
        ${select('bills-status', 'Situação', 'status', f.status, [['', 'Todas'], ['open', 'Não pagas'], ['overdue', 'Atrasadas'], ['paid', 'Pagas']])}
        ${select('bills-cat', 'Categoria', 'category', f.category, [['', 'Todas as categorias'], ['_none', 'Sem categoria'], ...d.categories.map((c) => [c.id, `${c.icon} ${c.name}`])])}
        ${select('bills-sort', 'Ordenar', 'sort', f.sort, [['date', 'Por vencimento'], ['value', 'Maior valor'], ['name', 'Nome (A–Z)']])}
      </div>

      <article class="card">
        <header class="card__header">
          <h2 class="card__title">${plural(items.length, 'conta')} em ${formatMonth(ym)}</h2>
          <div class="card__header-actions">
            <span class="money strong">${formatBRL(total)}</span>
            ${active ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="bills:clear">Limpar filtros</button>` : ''}
            <button type="button" class="btn btn--ghost btn--sm" data-action="bills:csv">${icon('file-spreadsheet', 'icon--xs')} CSV</button>
          </div>
        </header>
        ${items.length ? itemList(items) : html`
          <div class="empty">
            ${icon('search', 'icon--lg')}
            <p>${m.items.length ? 'Nenhuma conta encontrada com esses filtros.' : 'Nenhuma conta neste mês.'}</p>
            ${m.items.length ? '' : html`<button type="button" class="btn btn--primary" data-action="new:menu">${icon('plus')} Adicionar</button>`}
          </div>`}
      </article>`;
  },

  actions: {
    'bills:clear': () => store.setUI({ filters: { ...store.ui.filters, bills: { ...DEFAULTS } } }),
    'bills:csv': () => exportMonthCSV(store.ui.ym),
  },

  /** Chamado pelo main.js quando um campo com data-filter muda. */
  onFilter(name, value) {
    store.setUI({ filters: { ...store.ui.filters, bills: { ...DEFAULTS, ...store.ui.filters.bills, [name]: value } } });
  },
};

function select(id, label, name, value, options) {
  return html`
    <div class="toolbar__field">
      <label class="sr-only" for="${id}">${label}</label>
      <select id="${id}" class="input select" data-filter="${name}">
        ${options.map(([v, l]) => html`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`)}
      </select>
    </div>`;
}
