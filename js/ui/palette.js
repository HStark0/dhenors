// =============================================================
// palette.js — Busca rápida e comandos (Ctrl+K / ⌘K / "/")
// -------------------------------------------------------------
// • Digite para achar telas, ações e lançamentos.
// • Digite "mercado 120" para lançar na hora (linguagem natural,
//   ver domain/quickadd.js).
// =============================================================

import { html, fragment, escapeHTML } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { closeOnDoubleClickOutside } from './dialog.js';
import { store } from '../core/store.js';
import { formatBRL } from '../core/money.js';
import { formatDateBR, relativeDays } from '../core/dates.js';
import { parseQuickAdd } from '../domain/quickadd.js';
import { suggestCategory } from '../domain/importer.js';
import { INVEST_TYPES } from '../domain/investments.js';
import * as A from '../domain/actions.js';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let el = null;

/**
 * @param {object} o
 * @param {Array} o.nav      [{ id, label, icon }]
 * @param {Array} o.commands [{ label, icon, hint, run }]
 * @param {Function} o.openEditor (kind, item) → abre a edição de um lançamento
 */
export function openPalette({ nav, commands, openEditor }) {
  if (el) return;
  el = fragment(html`
    <dialog class="dialog dialog--md palette" aria-label="Busca rápida">
      <div class="palette__search">
        ${icon('search')}
        <input class="palette__input" type="text" placeholder="Buscar ou lançar: “mercado 120 ontem”…" aria-label="Buscar ou lançar" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="palette-list">
        <kbd>Esc</kbd>
      </div>
      <ul class="palette__list" id="palette-list" role="listbox"></ul>
      <p class="palette__foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span class="palette__tip">Experimente: “uber 23 ontem” · “plantão 900 recebi” · “luz 180 dia 20”</span></p>
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
    const quick = parseQuickAdd(input.value);
    if (quick) {
      const sug = quick.income ? null : suggestCategory(store.data, quick.description);
      const cat = sug && store.data.categories.find((c) => c.id === sug.categoryId);
      out.push({
        group: 'Lançar agora', icon: quick.income ? 'trending-up' : 'zap',
        label: `${quick.income ? 'Renda' : quick.paid ? 'Gasto pago' : 'Conta'}: ${quick.description} · ${formatBRL(quick.cents)}`,
        hint: `${formatDateBR(quick.date)} (${relativeDays(quick.date)})${cat ? ` · ${cat.icon} ${cat.name}` : ''}`,
        run: () => {
          if (quick.income) {
            A.saveExtraIncome({ description: quick.description, cents: quick.cents, date: quick.date, payroll: false });
          } else {
            A.saveExpense({ description: quick.description, cents: quick.cents, dueDate: quick.date, paid: quick.paid, paidAt: quick.paid ? quick.date : null, categoryId: sug?.categoryId, subcategoryId: sug?.subcategoryId });
          }
          toast(`Lançado: ${quick.description} (${formatBRL(quick.cents)}).`);
        },
      });
    }
    const match = (t) => !q || norm(t).includes(q);
    for (const c of commands) if (match(c.label)) out.push({ group: 'Ações', ...c });
    for (const n of nav) if (match(n.label)) out.push({ group: 'Ir para', icon: n.icon, label: n.label, run: () => { location.hash = `#/${n.id}`; } });
    if (q.length >= 2) {
      const d = store.data;
      const found = [
        ...d.expenses.map((x) => ({ kind: 'expense', x, label: x.description, hint: `${formatBRL(x.cents)} · ${formatDateBR(x.dueDate)}`, icon: 'receipt' })),
        ...d.recurring.map((x) => ({ kind: 'recurring', x, label: x.description, hint: `${formatBRL(x.cents)}/mês · dia ${x.dueDay}`, icon: 'repeat' })),
        ...d.installments.map((x) => ({ kind: 'installment', x, label: x.description, hint: `${x.count}× · total ${formatBRL(x.totalCents)}`, icon: 'credit-card' })),
        ...d.goals.map((x) => ({ kind: 'goal', x, label: x.description, hint: `meta ${formatBRL(x.targetCents)}`, icon: 'target' })),
        ...(d.investments || []).map((x) => ({ kind: 'investment', x, label: x.name, hint: [INVEST_TYPES[x.type]?.label, x.institution].filter(Boolean).join(' · '), icon: 'coins' })),
      ].filter((r) => norm(r.label).includes(q))
        .sort((a, b) => (b.x.dueDate || '').localeCompare(a.x.dueDate || ''))
        .slice(0, 8);
      for (const r of found) out.push({ group: 'Lançamentos', icon: r.icon, label: r.label, hint: r.hint, run: () => openEditor(r.kind, r.x) });
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

  el.showModal();
  input.focus();
  build();
}

