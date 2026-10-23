// =============================================================
// forms.js — Campos de formulário reutilizáveis (sempre com <label for>)
// =============================================================

import { html, attrs } from './dom.js';
import { icon } from './icons.js';
import { toCents } from '../core/money.js';

let seq = 0;
const uid = (name) => `f-${name}-${++seq}`;

// Botão de olho dos campos de senha: mostra/esconde o que foi digitado.
// Um único listener para todos os campos (inclusive os criados depois).
globalThis.document?.addEventListener('click', (ev) => {
  const btn = ev.target.closest?.('[data-reveal]');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.reveal);
  if (!input) return;
  const show = input.type === 'password';
  const label = btn.getAttribute('aria-label').replace(/^(Mostrar|Esconder) /, '');
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', `${show ? 'Esconder' : 'Mostrar'} ${label}`);
  btn.title = show ? 'Esconder' : 'Mostrar';
  btn.innerHTML = String(icon(show ? 'eye-off' : 'eye'));
  // devolve o foco ao campo, com o cursor no fim, para continuar digitando
  input.focus({ preventScroll: true });
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch { /* campos sem seleção */ }
});

/** Campo genérico. */
export function field({ label, name, type = 'text', value = '', required = false, hint = '', placeholder = '', extra = {}, prefix = '', full = false }) {
  const id = uid(name);
  const secret = type === 'password';
  return html`
    <div class="field ${full ? 'field--full' : ''}">
      <label class="field__label" for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      <div class="field__control ${prefix ? 'has-prefix' : ''} ${secret ? 'has-reveal' : ''}">
        ${prefix ? html`<span class="field__prefix" aria-hidden="true">${prefix}</span>` : ''}
        <input class="input" id="${id}" name="${name}" type="${type}" value="${value ?? ''}"
          ${attrs({ required, placeholder: placeholder || false, 'aria-describedby': hint ? `${id}-hint` : false, ...extra })}>
        ${secret ? html`
          <button type="button" class="field__reveal" data-reveal="${id}" aria-controls="${id}" aria-pressed="false" aria-label="Mostrar ${label.toLowerCase()}" title="Mostrar">
            ${icon('eye')}
          </button>` : ''}
      </div>
      ${hint ? html`<p class="field__hint" id="${id}-hint">${hint}</p>` : ''}
    </div>`;
}

/**
 * Valor em reais, com máscara enquanto digita: "123456" vira "1.234,56".
 * O teclado do celular mostra números (inputmode="decimal").
 * `negative`: aceita estorno/saldo negativo (digite "-").
 */
export function moneyField({ label, name, cents = null, required = true, hint = '', full = false, negative = false }) {
  return field({
    label, name, required, hint, full,
    value: cents != null && cents !== 0 ? maskCents(cents) : '',
    placeholder: '0,00',
    prefix: 'R$',
    extra: { inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', 'data-money': negative ? 'neg' : '1' },
  });
}

/** Centavos → "1.234,56" (com o sinal, se negativo). */
export function maskCents(cents) {
  if (!Number.isFinite(cents)) return '';
  const s = (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-${s}` : s;
}

// Máscara de dinheiro: um listener para todos os campos [data-money].
globalThis.document?.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.matches?.('[data-money]')) return;
  const neg = el.dataset.money === 'neg' && /^\s*-/.test(el.value);
  const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
  if (!digits) { el.value = neg ? '-' : ''; return; }
  el.value = maskCents((neg ? -1 : 1) * Number(digits));
  try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* sem seleção */ }
});
// Colar "1234.5" ou "R$ 1.234,56": interpreta o valor inteiro, não só os dígitos
globalThis.document?.addEventListener('paste', (ev) => {
  const el = ev.target;
  if (!el.matches?.('[data-money]')) return;
  const text = ev.clipboardData?.getData('text') || '';
  const value = toCents(text);
  if (!Number.isFinite(value)) return;
  ev.preventDefault();
  el.value = maskCents(el.dataset.money === 'neg' ? value : Math.abs(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, true);

/** Etiquetas livres (#viagem-natal, #reforma), separadas por espaço ou vírgula. */
export function tagsField({ value = [], hint = 'Ex.: #viagem-natal #reforma — para cruzar gastos de várias categorias.', suggestions = [] } = {}) {
  const id = uid('tags');
  return html`
    <div class="field field--full">
      <label class="field__label" for="${id}">Etiquetas (opcional)</label>
      <div class="field__control has-prefix">
        <span class="field__prefix" aria-hidden="true">#</span>
        <input class="input" id="${id}" name="tags" value="${(value || []).map((t) => `#${t}`).join(' ')}" autocomplete="off" placeholder="viagem-natal reforma" list="${id}-list" aria-describedby="${id}-hint">
      </div>
      ${suggestions.length ? html`<datalist id="${id}-list">${suggestions.map((t) => html`<option value="#${t}">`)}</datalist>` : ''}
      <p class="field__hint" id="${id}-hint">${hint}</p>
    </div>`;
}

/** Conta/carteira de onde sai (ou entra) o dinheiro. */
export function accountField(data, accountId = '', { label = 'Conta (opcional)', name = 'accountId' } = {}) {
  const list = (data.accounts || []).filter((a) => !a.archived || a.id === accountId);
  if (!list.length) return '';
  return selectField({
    label, name, value: accountId || '',
    options: [{ value: '', label: 'Não informar' }, ...list.map((a) => ({ value: a.id, label: a.name }))],
  });
}

/** Cartão de crédito. */
export function cardField(data, cardId = '', { label = 'Cartão', name = 'cardId', none = null } = {}) {
  const list = (data.cards || []).filter((c) => !c.archived || c.id === cardId);
  return selectField({
    label, name, value: cardId || '',
    options: [...(none ? [{ value: '', label: none }] : []), ...list.map((c) => ({ value: c.id, label: c.name }))],
  });
}

/**
 * Divisão de um gasto entre categorias (ex.: o mercado entre essenciais e
 * supérfluos). Começa fechada; "Dividir" abre as linhas.
 */
export function splitsField(data, splits = []) {
  const rows = splits.length ? splits : [{}, {}];
  const opts = [{ value: '', label: 'Sem categoria' }, ...data.categories.map((c) => ({ value: c.id, label: catText(c) }))];
  return html`
    <details class="field field--full splits" ${splits.length ? 'open' : ''}>
      <summary class="splits__toggle">Dividir em várias categorias</summary>
      <p class="field__hint">As partes precisam somar o valor total. Deixe fechado para usar uma categoria só.</p>
      <div class="splits__rows" data-splits>
        ${rows.map((s, i) => splitRow(opts, s, i))}
      </div>
      <div class="splits__foot">
        <button type="button" class="btn btn--ghost btn--sm" data-split-add>${icon('plus', 'icon--xs')} Parte</button>
        <span class="small muted" data-split-left aria-live="polite"></span>
      </div>
    </details>`;
}

function splitRow(opts, s, i) {
  return html`
    <div class="splits__row">
      <label class="sr-only" for="split-cat-${i}">Categoria da parte ${i + 1}</label>
      <select class="input select" id="split-cat-${i}" data-split-cat>${opts.map((o) => html`<option value="${o.value}" ${o.value === (s.categoryId || '') ? 'selected' : ''}>${o.label}</option>`)}</select>
      <label class="sr-only" for="split-val-${i}">Valor da parte ${i + 1}</label>
      <div class="field__control has-prefix"><span class="field__prefix" aria-hidden="true">R$</span><input class="input" id="split-val-${i}" data-split-val data-money="1" inputmode="decimal" value="${s.cents ? maskCents(s.cents) : ''}" placeholder="0,00"></div>
      <button type="button" class="icon-btn icon-btn--sm" data-split-del aria-label="Remover parte">${icon('x')}</button>
    </div>`;
}

/** Liga os botões da divisão e mostra quanto falta. `totalInput`: campo do valor total. */
export function bindSplits(root, data) {
  const box = root.querySelector('[data-splits]');
  if (!box) return;
  const opts = [{ value: '', label: 'Sem categoria' }, ...data.categories.map((c) => ({ value: c.id, label: catText(c) }))];
  const total = () => toCents(root.querySelector('[name="cents"]')?.value || '');
  const update = () => {
    const sum = [...box.querySelectorAll('[data-split-val]')].reduce((a, el) => a + (toCents(el.value) || 0), 0);
    const left = total() - sum;
    const out = root.querySelector('[data-split-left]');
    if (out) out.textContent = Number.isFinite(left) && sum ? (left === 0 ? 'Divisão completa ✓' : `${left > 0 ? 'Faltam' : 'Sobram'} R$ ${maskCents(Math.abs(left))}`) : '';
  };
  root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-split-add]')) {
      box.insertAdjacentHTML('beforeend', String(splitRow(opts, {}, box.children.length + Date.now() % 1000)));
      update();
    }
    const del = ev.target.closest('[data-split-del]');
    if (del && box.children.length > 2) { del.closest('.splits__row').remove(); update(); }
  });
  root.addEventListener('input', update);
  update();
}

/** Lê as partes da divisão (só se o bloco estiver aberto e preenchido). */
export function readSplits(root) {
  const details = root.querySelector('details.splits');
  if (!details?.open) return [];
  return [...root.querySelectorAll('.splits__row')].map((row) => ({
    categoryId: row.querySelector('[data-split-cat]').value || null,
    cents: toCents(row.querySelector('[data-split-val]').value),
  })).filter((s) => Number.isFinite(s.cents) && s.cents > 0);
}

/** Texto curto de categoria para listas sem HTML (selects): emoji antigo + nome, ou só o nome. */
export function catText(c) {
  if (!c) return 'Sem categoria';
  return c.name;
}

export function dateField({ label, name, value = '', required = true, hint = '', min = '', max = '' }) {
  return field({ label, name, type: 'date', value, required, hint, extra: { min: min || false, max: max || false } });
}

export function monthField({ label, name, value = '', required = true, hint = '' }) {
  return field({ label, name, type: 'month', value, required, hint, placeholder: 'AAAA-MM', extra: { pattern: '\\d{4}-\\d{2}' } });
}

export function numberField({ label, name, value = '', min, max, required = true, hint = '' }) {
  return field({ label, name, type: 'number', value, required, hint, extra: { min, max, step: 1, inputmode: 'numeric' } });
}

export function textareaField({ label, name, value = '', hint = '' }) {
  const id = uid(name);
  return html`
    <div class="field field--full">
      <label class="field__label" for="${id}">${label}</label>
      <textarea class="input textarea" id="${id}" name="${name}" rows="2" maxlength="500">${value}</textarea>
      ${hint ? html`<p class="field__hint">${hint}</p>` : ''}
    </div>`;
}

export function selectField({ label, name, options, value = '', hint = '', required = false }) {
  const id = uid(name);
  return html`
    <div class="field">
      <label class="field__label" for="${id}">${label}</label>
      <select class="input select" id="${id}" name="${name}" ${attrs({ required })}>
        ${options.map((o) => html`<option value="${o.value}" ${attrs({ selected: String(o.value) === String(value ?? '') })}>${o.label}</option>`)}
      </select>
      ${hint ? html`<p class="field__hint">${hint}</p>` : ''}
    </div>`;
}

/** Selects de categoria + subcategoria (a subcategoria acompanha a categoria). */
export function categoryFields(data, { categoryId = '', subcategoryId = '' } = {}) {
  const cat = data.categories.find((c) => c.id === categoryId);
  return html`
    ${selectField({
      label: 'Categoria', name: 'categoryId', value: categoryId,
      options: [{ value: '', label: 'Sem categoria' }, ...data.categories.map((c) => ({ value: c.id, label: catText(c) }))],
    })}
    ${selectField({
      label: 'Subcategoria', name: 'subcategoryId', value: subcategoryId,
      options: subOptions(cat),
    })}`;
}

function subOptions(cat) {
  return [{ value: '', label: cat?.subcategories.length ? 'Nenhuma' : '—' },
    ...(cat?.subcategories || []).map((s) => ({ value: s.id, label: s.name }))];
}

/** Liga o select de categoria ao de subcategoria dentro de um formulário. */
export function bindCategorySelects(root, data) {
  const catSel = root.querySelector('[name="categoryId"]');
  const subSel = root.querySelector('[name="subcategoryId"]');
  if (!catSel || !subSel) return;
  catSel.addEventListener('change', () => {
    const cat = data.categories.find((c) => c.id === catSel.value);
    subSel.innerHTML = subOptions(cat).map((o) => html`<option value="${o.value}">${o.label}</option>`).join('');
  });
}

export function creditorField(data, creditorId = '') {
  return selectField({
    label: 'Credor (opcional)', name: 'creditorId', value: creditorId,
    options: [{ value: '', label: 'Nenhum' },
      ...[...data.creditors].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))],
  });
}

/** Interruptor liga/desliga (checkbox estilizado). */
export function switchField({ label, name, checked = false, hint = '' }) {
  const id = uid(name);
  return html`
    <div class="field field--full">
      <label class="switch" for="${id}">
        <input type="checkbox" role="switch" id="${id}" name="${name}" ${attrs({ checked, 'aria-describedby': hint ? `${id}-hint` : false })}>
        <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
        <span class="switch__label">${label}</span>
      </label>
      ${hint ? html`<p class="field__hint switch__hint" id="${id}-hint">${hint}</p>` : ''}
    </div>`;
}

/** Botões de escolha única (rádios com cara de abas). options: [{ value, label }] */
export function segmentedField({ label, name, options, value }) {
  return html`
    <fieldset class="field">
      <legend class="field__label">${label}</legend>
      <div class="segmented segmented--field">
        ${options.map((o) => html`
          <label class="segmented__opt">
            <input type="radio" name="${name}" value="${o.value}" ${attrs({ checked: String(o.value) === String(value) })}>
            <span>${o.label}</span>
          </label>`)}
      </div>
    </fieldset>`;
}

/** Lê o formulário como objeto { nome: valor }. Checkboxes viram boolean. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'radio' && !el.checked) continue; // só o rádio marcado
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}
