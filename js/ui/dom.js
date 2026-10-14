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

  target.innerHTML = toHTML(content);
  afterRender?.(target); // ex.: estilizar os selects antes de devolver o foco

  if (keepId) {
    const el = document.getElementById(keepId);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && 'setSelectionRange' in el) {
        try { el.setSelectionRange(selStart, selStart); } catch { /* campos sem seleção */ }
      }
    }
  }
}

/** Cria um elemento a partir de HTML seguro. */
export function fragment(content) {
  const tpl = document.createElement('template');
  tpl.innerHTML = toHTML(content).trim();
  return tpl.content.firstElementChild;
}

