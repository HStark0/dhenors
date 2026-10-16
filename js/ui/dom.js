// =============================================================
// dom.js — Montagem de HTML segura + utilidades de DOM
// -------------------------------------------------------------
// html`...` ESCAPA automaticamente tudo que é interpolado.
// Isso elimina XSS: um nome como <img onerror=...> vira texto.
// Para inserir HTML já confiável (gerado por outro html``),
// basta interpolar o resultado — ele é marcado como seguro.
// =============================================================

class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (ch) => ESCAPES[ch]);
}

function toHTML(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(toHTML).join('');
  return escapeHTML(value);
}

/** Template seguro: html`<p>${texto}</p>` */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHTML(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

/** Marca uma string como HTML confiável (use só com conteúdo fixo do app). */
export const raw = (value) => new SafeHTML(String(value));

/** Atributos condicionais: attrs({ disabled: true, 'aria-current': cond && 'page' }) */
export function attrs(obj) {
  return raw(Object.entries(obj)
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeHTML(v)}"`))
    .join(' '));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let afterRender = null;
/** Registra uma função chamada depois de cada render() (usado por select.js). */
export function onAfterRender(fn) { afterRender = fn; }

/** Substitui o conteúdo de um elemento preservando foco/cursor de campos de busca. */
export function render(target, content) {
  const active = document.activeElement;
  const keepId = active && target.contains(active) && active.id ? active.id : null;
  const selStart = keepId && 'selectionStart' in active ? active.selectionStart : null;

  // Redesenha só o que mudou (morph): mantém rolagem interna, foco,
  // <details> abertos e o estado dos campos. Na primeira vez (vazio) usa innerHTML.
  if (target.firstElementChild && !target.querySelector('.loading')) {
    const tpl = document.createElement('template');
    tpl.innerHTML = toHTML(content);
    morphChildren(target, tpl.content);
  } else {
    target.innerHTML = toHTML(content);
  }
  afterRender?.(target); // ex.: estilizar os selects antes de devolver o foco

  if (keepId && document.activeElement?.id !== keepId) {
    const el = document.getElementById(keepId);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && 'setSelectionRange' in el) {
        try { el.setSelectionRange(selStart, selStart); } catch { /* campos sem seleção */ }
      }
    }
  }
}

// ---------- Morph: atualiza o DOM existente para ficar igual ao novo ----------

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null);

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  // Selects melhorados (ui/select.js) são trocados inteiros e melhorados de novo
  return a.tagName === b.tagName && !a.hasAttribute('data-enhanced') && keyOf(a) === keyOf(b);
}

function morphChildren(from, to) {
  const keyed = new Map();
  for (const n of from.childNodes) { const k = keyOf(n); if (k) keyed.set(k, n); }
  let cursor = from.firstChild;
  for (const next of [...to.childNodes]) {
    const k = keyOf(next);
    let match = null;
    if (k && keyed.has(k) && sameKind(keyed.get(k), next)) match = keyed.get(k);
    else if (cursor && !keyOf(cursor) && !k && sameKind(cursor, next)) match = cursor;
    if (match) {
      if (match !== cursor) from.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      morphNode(match, next);
      if (k) keyed.delete(k);
    } else {
      from.insertBefore(next, cursor);
    }
  }
  while (cursor) { const after = cursor.nextSibling; from.removeChild(cursor); cursor = after; }
}

function morphNode(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.data !== b.data) a.data = b.data;
    return;
  }
  // Atributos
  for (const { name } of [...a.attributes]) {
    if (b.hasAttribute(name)) continue;
    if (name === 'open' && a.tagName === 'DETAILS') continue; // o usuário abriu: continua aberto
    if (name === 'data-scroll-more') continue;
    a.removeAttribute(name);
  }
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  // Campos: o valor digitado no campo com foco não é sobrescrito
  if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') {
    if (document.activeElement !== a) {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      else if (a.value !== (b.getAttribute('value') ?? b.textContent ?? '')) a.value = a.tagName === 'TEXTAREA' ? b.textContent : (b.getAttribute('value') ?? '');
    }
    if (a.tagName === 'TEXTAREA') return;
  }
  morphChildren(a, b);
  if (a.tagName === 'SELECT') {
    const sel = [...b.options].findIndex((o) => o.hasAttribute('selected'));
    if (sel >= 0 && a.selectedIndex !== sel) a.selectedIndex = sel;
  }
}

/** Cria um elemento a partir de HTML seguro. */
export function fragment(content) {
  const tpl = document.createElement('template');
  tpl.innerHTML = toHTML(content).trim();
  return tpl.content.firstElementChild;
}

