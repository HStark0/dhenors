// =============================================================
// palette.js — Busca rápida e comandos (Ctrl+K / ⌘K / "/")
// -------------------------------------------------------------
// • Digite para achar telas, ações e lançamentos.
// • Digite (ou FALE, no microfone) "mercado 120" para lançar na
//   hora; "luz 180 todo dia 20" cria recorrente; "tv 2400 em 10x"
//   cria parcelamento (ou compra no cartão: "…no nubank").
//   Ver domain/quickadd.js.
// • "Busca completa" abre a tela de busca com filtros.
// =============================================================

import { html, fragment, escapeHTML } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { closeOnDoubleClickOutside } from './dialog.js';
import { store } from '../core/store.js';
import { formatBRL } from '../core/money.js';
import { formatDateBR, relativeDays, ymOf, addMonthsYM, dateInMonth } from '../core/dates.js';
import { parseQuickAdd } from '../domain/quickadd.js';
import { suggestCategory } from '../domain/importer.js';
import { INVEST_TYPES } from '../domain/investments.js';
import * as A from '../domain/actions.js';
import { speechSupported, listen } from './voice.js';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let el = null;

/** Lança o que o lançamento rápido entendeu. */
function launch(quick, sug) {
  const d = store.data;
  const card = quick.card ? d.cards.find((c) => norm(c.name) === norm(quick.card)) : null;
  if (quick.type === 'income') {
    A.saveExtraIncome({ description: quick.description, cents: quick.cents, date: quick.date, payroll: false, kind: 'extra' });
    return `Receita lançada: ${quick.description} (${formatBRL(quick.cents)}).`;
  }
  if (quick.type === 'recurring') {
    A.saveRecurring({ description: quick.description, cents: quick.cents, dueDay: quick.dueDay, startYM: ymOf(quick.date), categoryId: sug?.categoryId, subcategoryId: sug?.subcategoryId, cardId: card?.id });
    return `Recorrente criada: ${quick.description} · ${formatBRL(quick.cents)} todo dia ${quick.dueDay}.`;
  }
  if (quick.type === 'installment' || card) {
    if (card) {
      A.saveCardPurchase({ cardId: card.id, description: quick.description, date: quick.date, cents: quick.cents, count: quick.count || 1, categoryId: sug?.categoryId, subcategoryId: sug?.subcategoryId });
      return `Compra no ${card.name}: ${quick.description} · ${quick.count > 1 ? `${quick.count}× de ${formatBRL(Math.round(quick.cents / quick.count))}` : formatBRL(quick.cents)}.`;
    }
    const parcel = Math.round(quick.cents / quick.count);
    const next = dateInMonth(addMonthsYM(ymOf(quick.date), 1), Number(quick.date.slice(8)));
    A.saveInstallment({ description: quick.description, parcelCents: parcel, count: quick.count, paidCount: 0, nextDueDate: next, dueDay: Number(quick.date.slice(8)), categoryId: sug?.categoryId, subcategoryId: sug?.subcategoryId, keepTotalCents: quick.cents });
    return `Parcelamento criado: ${quick.description} · ${quick.count}× de ${formatBRL(parcel)}.`;
  }
  A.saveExpense({ description: quick.description, cents: quick.cents, dueDate: quick.date, paid: quick.paid, paidAt: quick.paid ? quick.date : null, categoryId: sug?.categoryId, subcategoryId: sug?.subcategoryId });
  return `Lançado: ${quick.description} (${formatBRL(quick.cents)}).`;
}

const KIND_TEXT = { income: 'Receita', recurring: 'Recorrente', installment: 'Parcelamento', expense: 'Conta' };

/**
 * @param {object} o
 * @param {Array} o.nav      [{ id, label, icon }]
 * @param {Array} o.commands [{ label, icon, hint, run }]
 * @param {Function} o.openEditor (kind, item) → abre a edição de um lançamento
 * @param {boolean} o.voice  já abre ouvindo
 */
export function openPalette({ nav, commands, openEditor, voice = false }) {
  if (el) return;
  el = fragment(html`
    <dialog class="dialog dialog--md palette" aria-label="Busca rápida">
      <div class="palette__search">
        ${icon('search')}
        <input class="palette__input" type="text" placeholder="Buscar ou lançar: “mercado 120 ontem”…" aria-label="Buscar ou lançar" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="palette-list">
        ${speechSupported() ? html`<button type="button" class="icon-btn palette__mic" data-mic aria-label="Falar o lançamento" title="Falar (ex.: gastei 50 no mercado)">${icon('mic')}</button>` : ''}
        <kbd>Esc</kbd>
      </div>
      <ul class="palette__list" id="palette-list" role="listbox"></ul>
      <p class="palette__foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span class="palette__tip">Experimente: “gastei 50 no mercado” · “luz 180 todo dia 20” · “tv 2400 em 10x”</span></p>
    </dialog>`);
  document.body.append(el);
  const input = el.querySelector('input');
  const list = el.querySelector('.palette__list');
  let results = [];
  let active = 0;

  const close = () => { el?.close(); };
  el.addEventListener('close', () => { el.remove(); el = null; });
  closeOnDoubleClickOutside(el, close);

  const build = () => {
    const q = norm(input.value.trim());
    const out = [];
    const d = store.data;
    const quick = parseQuickAdd(input.value, undefined, { cards: (d.cards || []).map((c) => c.name) });
    if (quick) {
      const sug = quick.income ? null : suggestCategory(d, quick.description);
      const cat = sug && d.categories.find((c) => c.id === sug.categoryId);
      const extra = quick.type === 'recurring' ? ` · todo dia ${quick.dueDay}` : quick.type === 'installment' ? ` · ${quick.count}× de ${formatBRL(Math.round(quick.cents / quick.count))}` : '';
      out.push({
        group: 'Lançar agora', icon: quick.income ? 'trending-up' : quick.type === 'recurring' ? 'repeat' : quick.type === 'installment' || quick.card ? 'credit-card' : 'zap',
        label: `${quick.card ? `Cartão ${quick.card}` : KIND_TEXT[quick.type]}${quick.type === 'expense' && quick.paid ? ' paga' : ''}: ${quick.description} · ${formatBRL(quick.cents)}${extra}`,
        hint: `${formatDateBR(quick.date)} (${relativeDays(quick.date)})${cat ? ` · ${cat.name}` : ''}`,
        run: () => toast(launch(quick, sug)),
      });
    }
    const match = (t) => !q || norm(t).includes(q);
    for (const c of commands) if (match(c.label)) out.push({ group: 'Ações', ...c });
    for (const n of nav) if (match(n.label)) out.push({ group: 'Ir para', icon: n.icon, label: n.label, run: () => { location.hash = `#/${n.id}`; } });
    if (q.length >= 2) {
      const found = [
        ...d.expenses.map((x) => ({ kind: 'expense', x, label: x.description, hint: `${formatBRL(x.cents)} · ${formatDateBR(x.dueDate)}`, icon: 'receipt', date: x.dueDate })),
        ...d.recurring.map((x) => ({ kind: 'recurring', x, label: x.description, hint: `${formatBRL(x.cents)} · dia ${x.dueDay}`, icon: 'repeat', date: '' })),
        ...d.installments.map((x) => ({ kind: 'installment', x, label: x.description, hint: `${x.count}× · total ${formatBRL(x.totalCents)}`, icon: 'calendar-range', date: x.firstDueDate })),
        ...(d.cardPurchases || []).map((x) => ({ kind: 'purchase', x, label: x.description, hint: `${formatBRL(Math.abs(x.cents))} · ${formatDateBR(x.date)}`, icon: 'credit-card', date: x.date })),
        ...d.goals.map((x) => ({ kind: 'goal', x, label: x.description, hint: `meta ${formatBRL(x.targetCents)}`, icon: 'target', date: '' })),
        ...(d.investments || []).map((x) => ({ kind: 'investment', x, label: x.name, hint: [INVEST_TYPES[x.type]?.label, x.institution].filter(Boolean).join(' · '), icon: 'coins', date: '' })),
      ].filter((r) => norm(r.label).includes(q) || (r.x.tags || []).some((t) => norm(t).includes(q.replace('#', ''))))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 8);
      for (const r of found) out.push({ group: 'Lançamentos', icon: r.icon, label: r.label, hint: r.hint, run: () => openEditor(r.kind, r.x) });
      out.push({ group: 'Busca', icon: 'filter', label: `Buscar "${input.value.trim()}" com filtros`, hint: 'Valor, data, categoria, etiqueta e buscas salvas', run: () => { location.hash = `#/busca?q=${encodeURIComponent(input.value.trim())}`; } });
    }
    results = out.slice(0, 30);
    active = Math.min(active, Math.max(0, results.length - 1));
    let lastGroup = '';
    list.innerHTML = results.length ? results.map((r, i) => {
      const head = r.group !== lastGroup ? `<li class="palette__group" role="presentation">${escapeHTML(r.group)}</li>` : '';
      lastGroup = r.group;
      return `${head}<li role="option" id="pal-${i}" class="palette__item ${i === active ? 'is-active' : ''}" aria-selected="${i === active}" data-index="${i}">
        <span class="palette__icon">${icon(r.icon || 'arrow-right')}</span>
        <span class="palette__text"><strong>${escapeHTML(r.label)}</strong>${r.hint ? `<small>${escapeHTML(r.hint)}</small>` : ''}</span>
      </li>`;
    }).join('') : '<li class="palette__empty">Nada encontrado. Para lançar, escreva descrição e valor: “farmácia 32,90”.</li>';
    input.setAttribute('aria-activedescendant', results.length ? `pal-${active}` : '');
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i) => {
    const r = results[i];
    if (!r) return;
    close();
    try { r.run(); } catch (err) { toast(err.message || 'Não foi possível.', { type: 'error' }); }
  };

  input.addEventListener('input', () => { active = 0; build(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(results.length - 1, active + 1); build(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(0, active - 1); build(); }
    if (ev.key === 'Enter') { ev.preventDefault(); choose(active); }
  });
  list.addEventListener('click', (ev) => {
    const li = ev.target.closest('[data-index]');
    if (li) choose(Number(li.dataset.index));
  });

  const mic = el.querySelector('[data-mic]');
  const hear = async () => {
    mic?.classList.add('is-listening');
    input.placeholder = 'Ouvindo… fale, por exemplo: gastei 50 no mercado';
    try {
      const said = await listen();
      if (said) { input.value = said; active = 0; build(); }
    } catch (err) { toast(err.message, { type: 'error' }); } finally {
      mic?.classList.remove('is-listening');
      input.placeholder = 'Buscar ou lançar: “mercado 120 ontem”…';
      input.focus();
    }
  };
  mic?.addEventListener('click', hear);

  el.showModal();
  input.focus();
  build();
  if (voice && mic) hear();
}
