// =============================================================
// Busca — encontra qualquer lançamento por texto, valor, período,
// categoria, etiqueta ou situação. Buscas frequentes podem ser salvas
// ("Uber em 2026", "Tudo #viagem-natal").
// Abre também por #/busca?q=texto (a paleta Ctrl+K leva para cá).
// Digitar não recalcula a cada tecla: espera ~200 ms, e o resultado
// fica guardado enquanto os dados e a busca forem os mesmos.
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { field, catText } from '../ui/forms.js';
import { itemList } from '../ui/items.js';
import { catIcon } from '../ui/catIcon.js';
import { routeParams } from '../ui/tabs.js';
import { toast } from '../ui/toast.js';
import { runWithUndo } from '../ui/undo.js';
import { store } from '../core/store.js';
import { formatBRL, plural, toCents } from '../core/money.js';
import { formatDateBR, currentYM, addMonthsYM, ymOf, todayISO } from '../core/dates.js';
import { monthItems } from '../domain/ledger.js';
import * as A from '../domain/actions.js';

const EMPTY = { q: '', from: '', to: '', categoryId: '', tag: '', min: '', max: '', status: '' };
let query = { ...EMPTY };
let lastHash = '';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default {
  id: 'busca',
  title: 'Busca',

  render() {
    syncFromHash();
    const d = store.data;
    const results = cachedSearch(d, query);
    const minBad = badMoney(query.min);
    const maxBad = badMoney(query.max);
    const rangeBad = !minBad && !maxBad && query.min && query.max && toCents(query.min) > toCents(query.max);
    const total = results.items.reduce((s, i) => s + i.cents, 0) + results.purchases.reduce((s, p) => s + p.cents, 0);
    const tags = [...new Set([...d.expenses, ...d.recurring, ...d.installments, ...(d.cardPurchases || [])].flatMap((x) => x.tags || []))].sort();
    const saved = d.settings.savedSearches || [];
    const any = Object.entries(query).some(([k, v]) => v && EMPTY[k] !== v);
    return html`
      <section class="card search-panel">
        <div class="search search--lg">
          ${icon('search')}
          <label class="sr-only" for="s-q">Buscar lançamentos</label>
          <input id="s-q" class="input" type="search" placeholder="Uber, farmácia, aluguel…" value="${query.q}" data-filter="q" autocomplete="off" enterkeyhint="search">
        </div>
        <div class="filters">
          <div class="field field--sm"><label class="field__label" for="s-from">De</label><input id="s-from" class="input" type="month" value="${query.from}" data-filter="from"></div>
          <div class="field field--sm"><label class="field__label" for="s-to">Até</label><input id="s-to" class="input" type="month" value="${query.to}" data-filter="to"></div>
          <div class="field field--sm">
            <label class="field__label" for="s-cat">Categoria</label>
            <select id="s-cat" class="input select" data-filter="categoryId">
              <option value="">Todas</option>
              ${d.categories.map((c) => html`<option value="${c.id}" ${c.id === query.categoryId ? 'selected' : ''}>${catText(c)}</option>`)}
            </select>
          </div>
          ${tags.length ? html`
            <div class="field field--sm">
              <label class="field__label" for="s-tag">Etiqueta</label>
              <select id="s-tag" class="input select" data-filter="tag">
                <option value="">Todas</option>
                ${tags.map((t) => html`<option value="${t}" ${t === query.tag ? 'selected' : ''}>#${t}</option>`)}
              </select>
            </div>` : ''}
          <div class="field field--sm"><label class="field__label" for="s-min">Valor de</label><input id="s-min" class="input" inputmode="decimal" placeholder="0,00" value="${query.min}" data-filter="min" ${minBad || rangeBad ? html`aria-invalid="true" aria-describedby="s-val-err"` : ''}></div>
          <div class="field field--sm"><label class="field__label" for="s-max">até</label><input id="s-max" class="input" inputmode="decimal" placeholder="—" value="${query.max}" data-filter="max" ${maxBad || rangeBad ? html`aria-invalid="true" aria-describedby="s-val-err"` : ''}></div>
          <div class="field field--sm">
            <label class="field__label" for="s-st">Situação</label>
            <select id="s-st" class="input select" data-filter="status">
              ${[['', 'Todas'], ['paid', 'Pagas'], ['open', 'Em aberto'], ['overdue', 'Atrasadas']].map(([v, l]) => html`<option value="${v}" ${v === query.status ? 'selected' : ''}>${l}</option>`)}
            </select>
          </div>
        </div>
        ${minBad || maxBad || rangeBad ? html`<p class="field__error" id="s-val-err" role="alert">${rangeBad ? 'O valor mínimo é maior que o máximo.' : `Valor ${minBad ? 'mínimo' : 'máximo'} inválido: use números, como 120 ou 1.250,90. Esse filtro está sendo ignorado.`}</p>` : ''}
        <div class="card__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="search:save" ${any ? '' : 'disabled'}>${icon('bookmark-plus', 'icon--xs')} Salvar esta busca</button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="search:clear" ${any ? '' : 'disabled'}>${icon('x', 'icon--xs')} Limpar</button>
        </div>
        ${saved.length ? html`
          <div class="chips" role="list" aria-label="Buscas salvas">
            ${saved.map((s) => html`
              <span class="saved-chip" role="listitem">
                <button type="button" class="saved-chip__btn" data-action="search:load" data-id="${s.id}">${icon('bookmark', 'icon--xs')} ${s.name}</button>
                <button type="button" class="saved-chip__x" data-action="search:delete" data-id="${s.id}" aria-label="Apagar a busca ${s.name}">${icon('x', 'icon--xs')}</button>
              </span>`)}
          </div>` : ''}
      </section>

      ${any ? html`
        <p class="muted small" role="status" aria-live="polite">${plural(results.items.length + results.purchases.length, 'resultado')} · ${formatBRL(total)} no total${results.truncated ? ' · mostrando os 300 mais recentes' : ''}</p>
        ${results.items.length ? html`<section class="card">${itemList(results.items, { showMonth: true })}</section>` : ''}
        ${results.purchases.length ? html`
          <section class="card">
            <h2 class="card__title">${icon('credit-card')} Compras no cartão</h2>
            <ul class="mini-list">
              ${results.purchases.map((p) => {
                const cat = d.categories.find((c) => c.id === p.categoryId);
                const card = d.cards.find((c) => c.id === p.cardId);
                return html`
                  <li>
                    <span class="row-flex">${catIcon(cat)} <span><strong>${p.description}</strong><br><span class="muted small">${formatDateBR(p.date)} · ${card?.name || 'cartão'}${p.count > 1 ? ` · ${p.count}x` : ''}</span></span></span>
                    <span class="money">${formatBRL(p.cents)}</span>
                  </li>`;
              })}
            </ul>
          </section>` : ''}
        ${!results.items.length && !results.purchases.length ? html`<div class="card empty">${icon('search-x', 'icon--lg')}<p><strong>Nada encontrado.</strong></p><p class="muted">Tente outro termo ou aumente o período.</p></div>` : ''}`
      : html`<div class="card empty">${icon('search', 'icon--lg')}<p class="muted">Digite um texto ou escolha um filtro. Por padrão a busca olha os últimos 12 meses e os próximos 3.</p></div>`}`;
  },

  actions: {
    'search:clear': () => { query = { ...EMPTY }; store.setUI({}); },
    'search:load': (el) => {
      const s = (store.data.settings.savedSearches || []).find((x) => x.id === el.dataset.id);
      if (s) { query = { ...EMPTY, ...s.query }; store.setUI({}); }
    },
    'search:delete': (el) => runWithUndo(() => A.deleteSearch(el.dataset.id), 'Busca removida.'),
    'search:save': () => openDialog({
      title: 'Salvar busca',
      size: 'sm',
      submitLabel: 'Salvar',
      body: field({ label: 'Nome', name: 'name', required: true, value: query.q || (query.tag ? `#${query.tag}` : ''), placeholder: 'Ex.: Uber em 2026', extra: { maxlength: 60 } }),
      onSubmit: (form) => { A.saveSearch(form.name.value, query); toast('Busca salva.'); },
    }),
  },

  onFilter(name, value) {
    if (!(name in EMPTY)) return;
    query = { ...query, [name]: value };
    // Campos de texto: espera a pessoa parar de digitar; listas: na hora
    clearTimeout(typingTimer);
    if (name === 'q' || name === 'min' || name === 'max') typingTimer = setTimeout(() => store.setUI({}), 200);
    else store.setUI({});
  },
};

let typingTimer = 0;

/** Texto de valor preenchido mas que não vira centavos (ex.: "abc", "1,2,3"). */
function badMoney(text) {
  if (!String(text || '').trim()) return false;
  const c = toCents(text);
  return !Number.isFinite(c) || c < 0;
}

// Último resultado: só recalcula se os dados (novo objeto a cada
// alteração), a busca ou o dia mudarem. monthItems já guarda cada mês.
let cache = { state: null, key: '', value: null };
function cachedSearch(state, qy) {
  const key = `${todayISO()}|${JSON.stringify(qy)}`;
  if (cache.state !== state || cache.key !== key) cache = { state, key, value: runSearch(state, qy) };
  return cache.value;
}

function syncFromHash() {
  if (location.hash === lastHash) return;
  lastHash = location.hash;
  const q = routeParams().get('q');
  if (q != null) query = { ...EMPTY, q };
}

/**
 * Busca pura (exportada para testes).
 * → { items (contas do ledger), purchases (compras no cartão), truncated }
 */
export function runSearch(state, qy, today = todayISO()) {
  const from = qy.from || addMonthsYM(currentYM(), -12);
  const to = qy.to || addMonthsYM(currentYM(), 3);
  const words = norm(qy.q).split(/\s+/).filter(Boolean);
  // Valor inválido não zera a busca em silêncio: o filtro é ignorado (a tela avisa)
  const money = (t) => { const c = t ? toCents(t) : NaN; return Number.isFinite(c) && c >= 0 ? c : null; };
  const min = money(qy.min);
  const max = money(qy.max);
  const textOk = (x) => {
    if (!words.length) return true;
    const cat = state.categories.find((c) => c.id === x.categoryId);
    const hay = norm([x.description, x.notes, cat?.name, ...(x.tags || []).map((t) => `#${t}`)].join(' '));
    return words.every((w) => hay.includes(w));
  };
  const common = (x) => textOk(x)
    && (!qy.categoryId || x.categoryId === qy.categoryId || (x.splits || []).some((s) => s.categoryId === qy.categoryId))
    && (!qy.tag || (x.tags || []).includes(qy.tag))
    && (min == null || x.cents >= min)
    && (max == null || x.cents <= max);

  const items = [];
  const seen = new Set();
  for (let ym = from, guard = 0; ym <= to && guard < 120; ym = addMonthsYM(ym, 1), guard++) {
    for (const i of monthItems(state, ym, today)) {
      if (seen.has(i.key) || !common(i)) continue;
      if (qy.status === 'paid' && i.status !== 'paid') continue;
      if (qy.status === 'open' && i.status === 'paid') continue;
      if (qy.status === 'overdue' && i.status !== 'overdue') continue;
      seen.add(i.key);
      items.push(i);
    }
  }
  const purchases = qy.status ? [] : (state.cardPurchases || []).filter((p) => ymOf(p.date) >= from && ymOf(p.date) <= to && common(p));
  items.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  purchases.sort((a, b) => b.date.localeCompare(a.date));
  return { items: items.slice(0, 300), purchases: purchases.slice(0, 300), truncated: items.length > 300 || purchases.length > 300 };
}
