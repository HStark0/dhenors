// =============================================================
// Contas → Mês: todos os compromissos do mês
// -------------------------------------------------------------
// Agrupados por data (Atrasadas · Hoje · Próximos 7 dias · Depois ·
// Pagas) com cabeçalho fixo e total; busca e filtros (tipo, situação,
// categoria, etiqueta); modo "Selecionar" para pagar, mudar categoria,
// etiquetar ou excluir várias de uma vez.
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { groupedItemList, itemList, itemByKey } from '../../ui/items.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { categoryFields, bindCategorySelects, field, catText } from '../../ui/forms.js';
import { hint } from '../../ui/help.js';
import { store } from '../../core/store.js';
import { formatBRL, plural, sumCents } from '../../core/money.js';
import { formatMonth, todayISO } from '../../core/dates.js';
import { computeMonth } from '../../domain/ledger.js';
import { exportMonthCSV } from '../../ui/backup.js';
import * as A from '../../domain/actions.js';

/** Remove acentos para a busca: "agua" encontra "Água". */
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const DEFAULTS = { q: '', kind: '', status: '', category: '', tag: '', sort: 'date', group: 'date' };

const sel = () => store.ui.sel || { on: false, keys: [] };
const setSel = (patch) => store.setUI({ sel: { ...sel(), ...patch } });

export function filteredItems(d, ym, f) {
  const m = computeMonth(d, ym, todayISO());
  let items = m.items;
  if (f.q) items = items.filter((i) => norm(i.description).includes(norm(f.q)) || (i.tags || []).some((t) => norm(t).includes(norm(f.q).replace('#', ''))));
  if (f.kind) items = items.filter((i) => i.kind === f.kind);
  if (f.status === 'open') items = items.filter((i) => i.status !== 'paid');
  else if (f.status) items = items.filter((i) => i.status === f.status);
  if (f.category) {
    items = items.filter((i) => (i.categoryId || '_none') === f.category
      || (i.splits || []).some((s) => (s.categoryId || '_none') === f.category)
      || (i.parts || []).some((p) => (p.categoryId || '_none') === f.category));
  }
  if (f.tag) items = items.filter((i) => (i.tags || []).includes(f.tag));
  if (f.sort === 'value') items = [...items].sort((a, b) => b.cents - a.cents);
  if (f.sort === 'name') items = [...items].sort((a, b) => a.description.localeCompare(b.description));
  return { m, items };
}

export function renderMonth() {
  const d = store.data;
  const ym = store.ui.ym;
  const f = { ...DEFAULTS, ...store.ui.filters.bills };
  const { m, items } = filteredItems(d, ym, f);
  const total = sumCents(items.map((i) => i.cents));
  const active = Object.entries(f).some(([k, v]) => !['sort', 'group'].includes(k) && v);
  const tags = [...new Set(m.items.flatMap((i) => i.tags || []))].sort();
  const s = sel();
  const selected = new Set(s.keys);
  const chosen = items.filter((i) => selected.has(i.key));
  const cat = f.category && d.categories.find((c) => c.id === f.category);

  return html`
    ${hint('bills-swipe', 'No celular, deslize uma conta para a direita para pagar e para a esquerda para ver as opções. No computador, use ↑ ↓ e Enter.')}
    <div class="toolbar">
      <div class="search">
        ${icon('search')}
        <label class="sr-only" for="bills-q">Buscar contas</label>
        <input id="bills-q" class="input" type="search" placeholder="Buscar pelo nome ou #etiqueta…" value="${f.q}" data-filter="q" autocomplete="off">
      </div>
      ${select('bills-kind', 'Tipo', 'kind', f.kind, [['', 'Tipos'], ['expense', 'Avulsas'], ['recurring', 'Recorrentes'], ['installment', 'Parcelas'], ['invoice', 'Faturas de cartão']])}
      ${select('bills-status', 'Situação', 'status', f.status, [['', 'Situações'], ['open', 'Não pagas'], ['overdue', 'Atrasadas'], ['paid', 'Pagas']])}
      ${select('bills-cat', 'Categoria', 'category', f.category, [['', 'Categorias'], ['_none', 'Sem categoria'], ...d.categories.map((c) => [c.id, catText(c)])])}
      ${tags.length ? select('bills-tag', 'Etiqueta', 'tag', f.tag, [['', 'Etiquetas'], ...tags.map((t) => [t, `#${t}`])]) : ''}
      ${select('bills-sort', 'Ordenar', 'sort', f.sort, [['date', 'Vencimento'], ['value', 'Maior valor'], ['name', 'Nome (A–Z)']])}
    </div>

    ${s.on ? html`
      <div class="batch-bar" role="toolbar" aria-label="Ações com as contas selecionadas">
        <label class="check"><input type="checkbox" data-action="sel:all" ${chosen.length === items.length && items.length ? 'checked' : ''}> ${plural(chosen.length, 'selecionada')}</label>
        <span class="money">${formatBRL(sumCents(chosen.map((i) => i.cents)))}</span>
        <div class="batch-bar__actions">
          <button type="button" class="btn btn--primary btn--sm" data-action="sel:pay" ${chosen.some((i) => i.status !== 'paid') ? '' : 'disabled'}>${icon('check', 'icon--xs')} Pagar</button>
          <button type="button" class="btn btn--secondary btn--sm" data-action="sel:category" ${chosen.length ? '' : 'disabled'}>${icon('tags', 'icon--xs')} Categoria</button>
          <button type="button" class="btn btn--secondary btn--sm" data-action="sel:tag" ${chosen.length ? '' : 'disabled'}>${icon('hash', 'icon--xs')} Etiqueta</button>
          <button type="button" class="btn btn--ghost btn--sm danger" data-action="sel:delete" ${chosen.some((i) => i.kind === 'expense' || i.kind === 'recurring') ? '' : 'disabled'}>${icon('trash-2', 'icon--xs')} Excluir</button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="sel:off">Cancelar</button>
        </div>
      </div>` : ''}

    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('receipt')} ${plural(items.length, 'conta')} em ${formatMonth(ym)}${cat ? html` · <span class="muted">${cat.name}</span>` : ''}</h2>
        <div class="card__header-actions">
          <span class="money strong header-total">${formatBRL(total)}</span>
          ${active ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="bills:clear">Limpar filtros</button>` : ''}
          ${s.on ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-action="sel:on" ${items.length ? '' : 'disabled'} aria-label="Selecionar contas" title="Selecionar">${icon('list-checks', 'icon--xs')}<span class="hide-sm"> Selecionar</span></button>`}
          <button type="button" class="btn btn--ghost btn--sm" data-action="bills:group" aria-pressed="${f.group === 'date'}" aria-label="Agrupar por data" title="Agrupar por data">${icon('rows-3', 'icon--xs')}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="bills:csv" aria-label="Baixar CSV" title="Baixar CSV">${icon('file-spreadsheet', 'icon--xs')}<span class="hide-sm"> CSV</span></button>
        </div>
      </header>
      ${items.length
        ? (f.group === 'date' && f.sort === 'date' ? groupedItemList(items, { selectable: s.on, selected }) : itemList(items, { selectable: s.on, selected }))
        : html`
          <div class="empty">
            ${icon(m.items.length ? 'search' : 'receipt', 'icon--lg')}
            <p><strong>${m.items.length ? 'Nenhuma conta encontrada com esses filtros.' : 'Nenhuma conta neste mês.'}</strong></p>
            ${m.items.length ? '' : html`
              <p class="muted">Lance contas avulsas, recorrentes, parcelamentos ou compras no cartão.</p>
              <div class="card__actions" style="justify-content:center">
                <button type="button" class="btn btn--primary" data-action="new:menu">${icon('plus')} Adicionar</button>
                <a class="btn btn--ghost" href="#/importar">${icon('file-up')} Importar extrato</a>
              </div>`}
          </div>`}
    </article>`;
}

function select(id, label, name, value, options) {
  return html`
    <div class="toolbar__field">
      <label class="sr-only" for="${id}">${label}</label>
      <select id="${id}" class="input select" data-filter="${name}">
        ${options.map(([v, l]) => html`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`)}
      </select>
    </div>`;
}

/** Itens marcados que estão na tela agora (mês e filtros atuais): nunca age sobre o que não se vê. */
function chosenItems() {
  const keys = new Set(sel().keys);
  const f = { ...DEFAULTS, ...store.ui.filters.bills };
  const visible = new Set(filteredItems(store.data, store.ui.ym, f).items.map((i) => i.key));
  return [...keys].filter((k) => visible.has(k)).map((k) => itemByKey(k)).filter(Boolean);
}

export const monthActions = {
  'bills:clear': () => store.setUI({ filters: { ...store.ui.filters, bills: { ...DEFAULTS, group: store.ui.filters.bills?.group || 'date' } } }),
  'bills:csv': () => exportMonthCSV(store.ui.ym),
  'bills:group': () => {
    const f = { ...DEFAULTS, ...store.ui.filters.bills };
    store.setUI({ filters: { ...store.ui.filters, bills: { ...f, group: f.group === 'date' ? 'flat' : 'date' } } });
  },
  'sel:on': () => setSel({ on: true, keys: [] }),
  'sel:off': () => setSel({ on: false, keys: [] }),
  'sel:toggle': (el) => {
    const keys = new Set(sel().keys);
    if (keys.has(el.dataset.key)) keys.delete(el.dataset.key); else keys.add(el.dataset.key);
    setSel({ keys: [...keys] });
  },
  'sel:all': () => {
    const f = { ...DEFAULTS, ...store.ui.filters.bills };
    const { items } = filteredItems(store.data, store.ui.ym, f);
    setSel({ keys: sel().keys.length === items.length ? [] : items.map((i) => i.key) });
  },
  'sel:pay': () => {
    const list = chosenItems().filter((i) => i.status !== 'paid');
    const n = A.setItemsPaid(list, true, todayISO());
    setSel({ on: false, keys: [] });
    toast(`${plural(n, 'conta paga', 'contas pagas')} hoje.`, { action: { label: 'Desfazer', run: () => store.undo() } });
  },
  'sel:category': () => {
    const list = chosenItems();
    openDialog({
      title: `Categoria de ${plural(list.length, 'conta')}`,
      size: 'sm',
      submitLabel: 'Aplicar',
      body: html`<div class="form-grid">${categoryFields(store.data)}</div><p class="field__hint">Faturas de cartão não mudam (a categoria fica em cada compra).</p>`,
      onMount: (dlg) => bindCategorySelects(dlg, store.data),
      onSubmit: (form) => {
        const n = A.setItemsCategory(list, form.categoryId.value || null, form.subcategoryId.value || null);
        setSel({ on: false, keys: [] });
        toast(`Categoria aplicada em ${plural(n, 'lançamento')}.`, { action: { label: 'Desfazer', run: () => store.undo() } });
      },
    });
  },
  'sel:tag': () => {
    const list = chosenItems();
    openDialog({
      title: 'Adicionar etiqueta',
      size: 'sm',
      submitLabel: 'Aplicar',
      body: field({ label: 'Etiquetas', name: 'tags', placeholder: '#viagem-natal', required: true }),
      onSubmit: (form) => {
        A.addItemsTags(list, form.tags.value);
        setSel({ on: false, keys: [] });
        toast('Etiquetas adicionadas.', { action: { label: 'Desfazer', run: () => store.undo() } });
      },
    });
  },
  'sel:delete': () => {
    const list = chosenItems();
    const n = A.deleteItems(list);
    setSel({ on: false, keys: [] });
    toast(`${plural(n, 'item excluído', 'itens excluídos')} (recorrentes: só neste mês).`, { action: { label: 'Desfazer', run: () => store.undo() } });
  },
};

export function onMonthFilter(name, value) {
  store.setUI({ filters: { ...store.ui.filters, bills: { ...DEFAULTS, ...store.ui.filters.bills, [name]: value } } });
}
