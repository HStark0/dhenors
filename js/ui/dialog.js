// =============================================================
// dialog.js — Janelas modais usando o <dialog> nativo
// -------------------------------------------------------------
// O <dialog> nativo já resolve: foco preso dentro da janela,
// tecla Esc, fundo escurecido e devolução do foco ao fechar.
// Cada janela é criada na hora e removida ao fechar, então
// nunca acumula listeners.
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';
import { toastError } from './toast.js';

let counter = 0;

/**
 * Abre uma janela.
 * @param {object} o
 * @param {string} o.title
 * @param {*}      o.body        HTML (html``) do conteúdo
 * @param {string} [o.submitLabel] se informado, a janela vira um formulário
 * @param {Function} [o.onSubmit]  (form, dialog) => void | Promise. Lance ValidationError para mostrar erro no campo.
 * @param {Function} [o.onMount]   (dialog) => void, para ligar comportamentos extras
 * @param {'sm'|'md'|'lg'} [o.size]
 * @param {boolean} [o.danger]     botão principal vermelho
 */
export function openDialog({ title, body, submitLabel = null, onSubmit = null, onMount = null, size = 'md', danger = false, footer = null }) {
  const id = `dlg-${++counter}`;
  const isForm = Boolean(submitLabel);

  const dialog = fragment(html`
    <dialog class="dialog dialog--${size}" aria-labelledby="${id}-title">
      <form class="dialog__form" method="dialog" novalidate>
        <header class="dialog__header">
          <h2 id="${id}-title" class="dialog__title">${title}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>
        </header>
        <div class="dialog__body">${body}</div>
        ${isForm || footer ? html`
          <footer class="dialog__footer">
            ${footer || ''}
            ${isForm ? html`
              <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
              <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}">${submitLabel}</button>` : ''}
          </footer>` : ''}
      </form>
    </dialog>`);

  document.body.append(dialog);
  const form = dialog.querySelector('form');

  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) { ev.preventDefault(); close(); }
  });
  // Só fecha pelos botões (X, Cancelar, Confirmar) ou com 2 cliques no fundo
  // escurecido — um clique ou Esc sem querer não perde o que foi digitado.
  closeOnDoubleClickOutside(dialog, close);
  dialog.addEventListener('cancel', (ev) => ev.preventDefault());
  dialog.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') ev.preventDefault(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!onSubmit) return close();
    const button = form.querySelector('[type="submit"]');
    clearErrors(form);
    button.disabled = true; // evita clique duplo = registro duplicado
    try {
      const keepOpen = await onSubmit(form, dialog);
      if (keepOpen !== true) close();
    } catch (err) {
      showError(form, err);
    } finally {
      button.disabled = false;
    }
  });

  dialog.showModal();
  onMount?.(dialog);
  fillGridGaps(dialog);
  // foca o primeiro campo, não o botão de fechar
  const first = dialog.querySelector('.dialog__body input:not([type=hidden]), .dialog__body select, .dialog__body textarea, .dialog__body button');
  first?.focus();
  return { dialog, close };
}

/**
 * Fecha a janela com 2 cliques seguidos no fundo escurecido (fora da
 * caixa); um clique só não faz nada. Feito à mão, e não com "dblclick",
 * para funcionar também no toque do celular.
 */
export function closeOnDoubleClickOutside(dialog, close, interval = 450) {
  let last = 0;
  dialog.addEventListener('click', (ev) => {
    // ev.detail === 0: clique gerado pelo teclado, não pelo mouse
    if (ev.target !== dialog || ev.detail === 0) return;
    const r = dialog.getBoundingClientRect();
    if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return;
    const now = performance.now();
    if (now - last <= interval) { last = 0; close(); } else last = now;
  });
}

/**
 * Grades de campos sem buracos: quando uma linha fica incompleta
 * (ex.: 3 campos numa grade de 2 colunas, ou um campo que aparece e
 * some), o último campo da linha se estica até o fim dela.
 * Refaz a conta quando algo aparece/some ou a janela muda de largura.
 */
function fillGridGaps(dialog) {
  const visible = (el) => !el.hidden && el.tagName !== 'DATALIST' && getComputedStyle(el).display !== 'none';
  const layout = () => {
    for (const grid of dialog.querySelectorAll('.form-grid')) {
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const items = [...grid.children];
      items.forEach((el) => el.style.removeProperty('grid-column'));
      if (cols < 2) continue;
      let col = 0;
      let last = null;
      for (const el of items) {
        if (!visible(el)) continue;
        const full = getComputedStyle(el).gridColumnEnd === '-1';
        if (full) {
          if (col && last) last.style.gridColumn = `span ${cols - col + 1}`;
          col = 0; last = null;
          continue;
        }
        col = (col + 1) % cols;
        last = col ? el : null;
      }
      if (col && last) last.style.gridColumn = `span ${cols - col + 1}`;
    }
  };
  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  layout();
  new MutationObserver(schedule).observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(schedule).observe(dialog);
}

function clearErrors(form) {
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const el of form.querySelectorAll('.field__error')) el.remove();
  form.querySelector('.form-error')?.remove();
}

/** Mostra o erro ao lado do campo (err.field) ou no topo da janela. */
export function showError(form, err) {
  const field = err?.field && form.querySelector(`[name="${err.field}"]`);
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    const msg = fragment(html`<p class="field__error" id="${field.id}-err">${err.message}</p>`);
    field.closest('.field')?.append(msg);
    field.setAttribute('aria-describedby', `${field.id}-err`);
    field.focus();
  } else {
    const body = form.querySelector('.dialog__body');
    body.prepend(fragment(html`<p class="form-error" role="alert">${err?.message || 'Algo deu errado.'}</p>`));
    if (!err?.field) console.error(err);
  }
  if (!form.closest('dialog')) toastError(err?.message || 'Algo deu errado.');
}

/**
 * Confirmação. Retorna Promise<boolean>.
 * Com `typed`, o usuário precisa digitar a palavra para confirmar.
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, typed = null }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const { dialog } = openDialog({
      title,
      size: 'sm',
      danger,
      submitLabel: confirmLabel,
      body: html`
        <p class="dialog__text">${message}</p>
        ${typed ? html`
          <div class="field">
            <label class="field__label" for="confirm-typed">Digite <strong>${typed}</strong> para confirmar</label>
            <input class="input" id="confirm-typed" name="typed" autocomplete="off" required>
          </div>` : ''}`,
      onSubmit: (form) => {
        if (typed && form.typed.value.trim().toUpperCase() !== typed.toUpperCase()) {
          const err = new Error(`Digite ${typed} para confirmar.`);
          err.field = 'typed';
          throw err;
        }
        confirmed = true;
      },
    });
    dialog.addEventListener('close', () => resolve(confirmed));
  });
}

/**
 * Menu de ações (vira uma "folha" no celular).
 * actions: [{ label, icon, run, danger, hint }]
 */
export function actionSheet({ title, subtitle = '', actions }) {
  const { dialog, close } = openDialog({
    title,
    size: 'sm',
    body: html`
      ${subtitle ? html`<p class="dialog__text muted">${subtitle}</p>` : ''}
      <ul class="sheet-list">
        ${actions.map((a, i) => html`
          <li>
            <button type="button" class="sheet-item ${a.danger ? 'is-danger' : ''}" data-index="${i}">
              ${icon(a.icon || 'arrow-right')}
              <span>${a.label}${a.hint ? html`<small>${a.hint}</small>` : ''}</span>
            </button>
          </li>`)}
      </ul>`,
  });
  dialog.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.sheet-item');
    if (!btn) return;
    close();
    actions[+btn.dataset.index].run();
  });
}
