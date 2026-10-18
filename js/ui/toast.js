// =============================================================
// toast.js — Avisos rápidos (com botão "Desfazer" opcional)
// -------------------------------------------------------------
// Anunciados por leitores de tela (aria-live). `persist: true`
// deixa o aviso aberto até a pessoa agir. announce() fala sem
// mostrar nada.
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';

const ICONS = { success: 'circle-check', error: 'triangle-alert', info: 'info', update: 'rocket' };

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
  // Com uma janela aberta, os avisos precisam ficar DENTRO dela (camada
  // superior do <dialog>): fora, ficam atrás do fundo escuro e o "Desfazer"
  // não pode ser tocado. dialog.js devolve a região ao <body> ao fechar.
  const top = [...document.querySelectorAll('dialog[open]:not(.is-closing)')].pop();
  const host = top || document.body;
  if (el.parentElement !== host) host.append(el);
  return el;
}

/**
 * toast('Salvo!')
 * toast('Conta paga', { type: 'success', action: { label: 'Desfazer', run: fn } })
 */
export function toast(message, { type = 'success', action = null, duration = 4500, persist = false, id = null } = {}) {
  if (id) document.querySelector(`.toast[data-id="${id}"]`)?.remove();
  const el = fragment(html`
    <div class="toast toast--${type}" ${id ? html`data-id="${id}"` : ''}>
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
    el.querySelector('.toast__action').addEventListener('click', () => {
      try { action.run(); } catch (err) { toastError(err.message || 'Não foi possível.'); }
      close();
    });
  }

  const container = region();
  container.append(el);
  while (container.children.length > 3) container.firstElementChild.remove();

  if (!persist) {
    // Com "Desfazer" o aviso fica mais tempo (dá tempo de ler e agir).
    // Pausa enquanto o mouse está em cima, o foco está dentro (teclado/
    // leitor de tela) ou o dedo encostou; volta a contar ao sair.
    let timer = setTimeout(close, action ? Math.max(duration, 4500) + 5500 : duration);
    let hover = false;
    const pause = () => clearTimeout(timer);
    const resume = () => {
      clearTimeout(timer);
      if (hover || el.contains(document.activeElement)) return;
      timer = setTimeout(close, action ? 4000 : 2000);
    };
    el.addEventListener('mouseenter', () => { hover = true; pause(); });
    el.addEventListener('mouseleave', () => { hover = false; resume(); });
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', () => setTimeout(resume, 0));
    el.addEventListener('pointerdown', pause);
    el.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') resume(); });
  }
  return close;
}

export const toastError = (message) => toast(message, { type: 'error', duration: 6000 });

/** Fala uma frase para leitores de tela, sem aviso visual (ex.: "Conta marcada como paga"). */
export function announce(message) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  // limpa e escreve em seguida: leitores de tela repetem a mesma frase
  setTimeout(() => { el.textContent = message; }, 30);
}
