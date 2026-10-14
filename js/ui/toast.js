// =============================================================
// toast.js — Avisos rápidos (com botão "Desfazer" opcional)
// Anunciados por leitores de tela (aria-live).
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';

const ICONS = { success: 'circle-check', error: 'triangle-alert', info: 'info' };

function region() {
  let el = document.getElementById('toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toasts';
    el.className = 'toasts';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  return el;
}

/**
 * toast('Salvo!')
 * toast('Conta paga', { type: 'success', action: { label: 'Desfazer', run: fn } })
 */
export function toast(message, { type = 'success', action = null, duration = 4500 } = {}) {
  const el = fragment(html`
    <div class="toast toast--${type}">
      ${icon(ICONS[type] || 'info')}
      <span class="toast__msg">${message}</span>
      ${action ? html`<button type="button" class="toast__action">${action.label}</button>` : ''}
      <button type="button" class="toast__close" aria-label="Fechar aviso">${icon('x')}</button>
    </div>`);

  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('.toast__close').addEventListener('click', close);
  if (action) {
    el.querySelector('.toast__action').addEventListener('click', () => { action.run(); close(); });
  }

  const container = region();
  container.append(el);
  while (container.children.length > 3) container.firstElementChild.remove();

  let timer = setTimeout(close, action ? duration + 2500 : duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2000); });
  return close;
}

export const toastError = (message) => toast(message, { type: 'error', duration: 6000 });
