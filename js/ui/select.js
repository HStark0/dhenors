// =============================================================
// select.js — Caixas de opções estilizadas
// -------------------------------------------------------------
// A lista que o navegador abre num <select> ou num <datalist>
// não aceita estilo (fica cinza, fora do tema). Este módulo troca
// essas listas por uma versão própria, no visual do app:
//
//  • <select class="input">   → botão + lista (com busca se tiver
//                               muitas opções). O <select> original
//                               continua no formulário, escondido,
//                               guardando o valor — nada muda para
//                               quem lê o formulário.
//  • <input list="...">       → sugestões enquanto digita.
//
// Teclado: ↑ ↓ navegam, Enter escolhe, Esc fecha, letras pulam
// para a opção. Leitores de tela: role combobox/listbox/option.
// É automático: autoEnhance() observa a página e melhora todo
// select/campo novo que aparecer.
// =============================================================

let uid = 0;
const SEARCH_FROM = 9; // a partir de quantas opções mostra o campo de busca

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const chevron = '<svg class="icon select-btn__chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg>';
const check = '<svg class="icon listbox__check" aria-hidden="true"><use href="#i-check"/></svg>';

// ---------- Popover (a lista flutuante) ----------

/** Só uma lista aberta por vez. */
let openPopover = null;

function createPopover(anchor, { id, label }) {
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'listbox-pop';
  pop.innerHTML = `<ul class="listbox" role="listbox" id="${id}" aria-label="${label.replace(/"/g, '&quot;')}"></ul>`;
  // Dentro de um <dialog> aberto, precisa ficar dentro dele (camada superior)
  (anchor.closest('dialog[open]') || document.body).append(pop);

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const spaceBelow = innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const up = spaceBelow < 220 && spaceAbove > spaceBelow;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 220) - 8))}px`;
    pop.style.width = `${Math.max(r.width, 220)}px`;
    pop.style.maxHeight = `${Math.min(320, up ? spaceAbove : spaceBelow)}px`;
    pop.style.top = up ? '' : `${r.bottom + 4}px`;
    pop.style.bottom = up ? `${innerHeight - r.top + 4}px` : '';
    pop.classList.toggle('is-up', up);
  };
  place();

  const onScroll = (ev) => { if (!pop.contains(ev.target)) place(); };
  const onDown = (ev) => {
    if (!pop.contains(ev.target) && !anchor.contains(ev.target)) state.close();
  };
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', place);
  document.addEventListener('pointerdown', onDown, true);

  const state = {
    pop,
    list: pop.querySelector('.listbox'),
    place,
    onClose: null,
    close() {
      removeEventListener('scroll', onScroll, true);
      removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onDown, true);
      pop.remove();
      if (openPopover === state) openPopover = null;
      state.onClose?.();
    },
  };
  openPopover = state;
  return state;
}

function closePopover() { openPopover?.close(); }

function renderOptions(list, items, activeIndex, selectedValue) {
  list.innerHTML = items.length
    ? items.map((o, i) => `
        <li role="option" id="${list.id}-o${i}" class="listbox__opt ${i === activeIndex ? 'is-active' : ''} ${o.disabled ? 'is-disabled' : ''}"
          aria-selected="${o.value === selectedValue}" ${o.disabled ? 'aria-disabled="true"' : ''} data-index="${i}">
          <span>${escape(o.label)}</span>${o.value === selectedValue ? check : ''}
        </li>`).join('')
    : '<li class="listbox__empty" role="presentation">Nada encontrado</li>';
  list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- <select> ----------

export function enhanceSelect(select) {
  if (select.dataset.enhanced) return;
  select.dataset.enhanced = '1';

  const id = select.id || `sel-${++uid}`;
  select.id = id;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = `${id}-btn`;
  btn.className = `${select.className.replace(/\bselect\b/, '')} select-btn`.trim();
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  // O <label for> passa a apontar para o botão
  const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
  if (label) {
    label.htmlFor = btn.id;
    if (!label.id) label.id = `${id}-label`;
    btn.setAttribute('aria-labelledby', `${label.id} ${btn.id}`);
  } else if (select.getAttribute('aria-label')) {
    btn.setAttribute('aria-label', select.getAttribute('aria-label'));
  }

  select.classList.add('select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(btn);

  const options = () => [...select.options].map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled }));
  const sync = () => {
    const opt = select.options[select.selectedIndex];
    btn.innerHTML = `<span class="select-btn__value">${escape(opt ? opt.textContent.trim() : '')}</span>${chevron}`;
    btn.disabled = select.disabled;
  };
  sync();
  select.addEventListener('change', sync);
  // Opções trocadas por código (ex.: subcategorias) → atualiza o texto
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  let pop = null;
  let items = [];
  let active = 0;
  let search = null;
  let typed = '';
  let typedTimer = 0;

  const choose = (i) => {
    const o = items[i];
    if (!o || o.disabled) return;
    if (select.value !== o.value) {
      select.value = o.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
    btn.focus();
  };

  const refresh = () => {
    const all = options();
    items = search?.value ? all.filter((o) => norm(o.label).includes(norm(search.value))) : all;
    active = Math.min(Math.max(0, active), Math.max(0, items.length - 1));
    renderOptions(pop.list, items, active, select.value);
    const activeEl = pop.list.querySelector('.is-active');
    (search || btn).setAttribute('aria-activedescendant', activeEl ? activeEl.id : '');
  };

  const open = () => {
    if (pop || btn.disabled) return;
    const listId = `${id}-list`;
    pop = createPopover(btn, { id: listId, label: label?.textContent.trim() || 'Opções' });
    pop.onClose = () => {
      pop = null; search = null;
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
    };
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', listId);

    const all = options();
    if (all.length >= SEARCH_FROM) {
      pop.pop.insertAdjacentHTML('afterbegin',
        '<div class="listbox__search"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><input type="text" class="listbox__input" placeholder="Buscar…" aria-label="Buscar opção" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true"></div>');
      search = pop.pop.querySelector('.listbox__input');
      search.setAttribute('aria-controls', listId);
      search.addEventListener('input', () => { active = 0; refresh(); });
      search.addEventListener('keydown', onKey);
    }
    active = Math.max(0, all.findIndex((o) => o.value === select.value));
    refresh();
    pop.list.addEventListener('pointerdown', (ev) => ev.preventDefault()); // não tira o foco
    pop.list.addEventListener('click', (ev) => {
      const li = ev.target.closest('[data-index]');
      if (li) choose(Number(li.dataset.index));
    });
    pop.list.addEventListener('pointermove', (ev) => {
      const li = ev.target.closest('[data-index]');
      if (li && Number(li.dataset.index) !== active) { active = Number(li.dataset.index); refresh(); }
    });
    (search || btn).focus();
  };

  const close = () => pop?.close();

  function onKey(ev) {
    const { key } = ev;
    if (!pop) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) { ev.preventDefault(); open(); }
      return;
    }
    const move = (to) => { ev.preventDefault(); active = Math.max(0, Math.min(items.length - 1, to)); refresh(); };
    if (key === 'ArrowDown') return move(active + 1);
    if (key === 'ArrowUp') return move(active - 1);
    if (key === 'Home' && !search) return move(0);
    if (key === 'End' && !search) return move(items.length - 1);
    if (key === 'PageDown') return move(active + 8);
    if (key === 'PageUp') return move(active - 8);
    if (key === 'Enter' || (key === ' ' && !search)) { ev.preventDefault(); return choose(active); }
    if (key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); btn.focus(); return; }
    if (key === 'Tab') { close(); return; }
    // Digitar letras pula para a opção (sem campo de busca)
    if (!search && key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
      clearTimeout(typedTimer);
      typed += norm(key);
      typedTimer = setTimeout(() => { typed = ''; }, 600);
      const i = items.findIndex((o) => norm(o.label).replace(/^[^\p{L}\p{N}]+/u, '').startsWith(typed));
      if (i >= 0) move(i);
    }
  }

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keydown', onKey);
}

// ---------- <input list> (sugestões) ----------

export function enhanceSuggest(input) {
  if (input.dataset.enhanced) return;
  const listId = input.getAttribute('list');
  if (!listId) return;
  input.dataset.enhanced = '1';
  input.dataset.suggest = listId;
  input.removeAttribute('list'); // desliga a lista nativa sem estilo
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  let pop = null;
  let items = [];
  let active = -1;

  const source = () => [...(document.getElementById(listId)?.options || [])].map((o) => o.value).filter(Boolean);

  const choose = (i) => {
    const v = items[i];
    if (v == null) return;
    input.value = v.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  const refresh = () => {
    const q = norm(input.value);
    items = source()
      .filter((v) => !q || (norm(v).includes(q) && norm(v) !== q))
      .slice(0, 8)
      .map((v) => ({ value: v, label: v }));
    if (!items.length) return close();
    if (!pop) {
      const id = `sug-${++uid}`;
      pop = createPopover(input, { id, label: 'Sugestões' });
      pop.pop.classList.add('listbox-pop--suggest');
      pop.onClose = () => { pop = null; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', id);
      pop.list.addEventListener('pointerdown', (ev) => ev.preventDefault());
      pop.list.addEventListener('click', (ev) => {
        const li = ev.target.closest('[data-index]');
        if (li) choose(Number(li.dataset.index));
      });
    }
    active = Math.min(active, items.length - 1);
    renderOptions(pop.list, items, active, null);
    const el = pop.list.querySelector('.is-active');
    if (el) input.setAttribute('aria-activedescendant', el.id); else input.removeAttribute('aria-activedescendant');
  };

  const close = () => pop?.close();

  input.addEventListener('focus', refresh);
  input.addEventListener('input', () => { active = -1; refresh(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (ev) => {
    if (!pop) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); refresh(); }
      return;
    }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(items.length - 1, active + 1); refresh(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(-1, active - 1); refresh(); }
    else if (ev.key === 'Enter' && active >= 0) { ev.preventDefault(); choose(active); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === 'Tab') close();
  });
}

// ---------- Automático ----------

export function enhanceWithin(root) {
  if (!root.querySelectorAll) return;
  if (root.matches?.('select.input')) enhanceSelect(root);
  if (root.matches?.('input[list]')) enhanceSuggest(root);
  for (const el of root.querySelectorAll('select.input:not([data-enhanced])')) enhanceSelect(el);
  for (const el of root.querySelectorAll('input[list]:not([data-enhanced])')) enhanceSuggest(el);
}

/** Melhora todos os selects/sugestões atuais e os que aparecerem depois. */
export function autoEnhance(root = document.body) {
  enhanceWithin(root);
  new MutationObserver((mutations) => {
    for (const m of mutations) for (const node of m.addedNodes) if (node.nodeType === 1) enhanceWithin(node);
  }).observe(root, { childList: true, subtree: true });
}
