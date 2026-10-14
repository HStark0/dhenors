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
    // clique no fundo escurecido fecha
    if (ev.target === dialog) close();
  });

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
  // foca o primeiro campo, não o botão de fechar
  const first = dialog.querySelector('.dialog__body input:not([type=hidden]), .dialog__body select, .dialog__body textarea, .dialog__body button');
  first?.focus();
  return { dialog, close };
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
