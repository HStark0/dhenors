// =============================================================
// forms.js — Campos de formulário reutilizáveis (sempre com <label for>)
// =============================================================

import { html, attrs } from './dom.js';
import { icon } from './icons.js';
import { centsToInput } from '../core/money.js';

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

/** Valor em reais. Aceita "12,50" e "1.234,56" (o teclado do celular mostra números). */
export function moneyField({ label, name, cents = null, required = true, hint = '', full = false }) {
  return field({
    label, name, required, hint, full,
    value: cents != null && cents !== 0 ? centsToInput(cents) : '',
    placeholder: '0,00',
    prefix: 'R$',
    extra: { inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next' },
  });
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
      options: [{ value: '', label: 'Sem categoria' }, ...data.categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))],
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
