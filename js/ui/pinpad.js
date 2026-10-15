// =============================================================
// pinpad.js — Teclado numérico do PIN (tela de bloqueio e janela
// de criar/trocar PIN)
// -------------------------------------------------------------
// • Não usa <input>: no celular, um campo com foco abriria o
//   teclado do aparelho por cima do teclado da tela.
// • No computador, aceita o teclado físico: números, Backspace e
//   Enter (Espaço aperta o botão em foco).
// • As bolinhas crescem de 4 até 8 conforme se digita.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';

const MIN_DOTS = 4;

/** Marcação do teclado. `ok: false` deixa a confirmação para o rodapé da janela. */
export function pinPad({ ok = true, max = 8 } = {}) {
  return html`
    <div class="pinpad" tabindex="-1" data-max="${max}">
      <div class="pinpad__dots" aria-hidden="true"></div>
      <p class="sr-only" aria-live="polite" data-pin-status></p>
      <p class="pinpad__error" role="alert"></p>
      <div class="pinpad__keys">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" class="pinpad__key" data-pin-key="${n}">${n}</button>`)}
        <button type="button" class="pinpad__key pinpad__key--fn" data-pin-key="del" aria-label="Apagar">${icon('undo-2')}</button>
        <button type="button" class="pinpad__key" data-pin-key="0">0</button>
        ${ok ? html`<button type="button" class="pinpad__key pinpad__key--ok" data-pin-key="ok" aria-label="Confirmar">${icon('arrow-right')}</button>`
          : html`<span aria-hidden="true"></span>`}
      </div>
    </div>`;
}

/**
 * Liga o teclado. `keyTarget` recebe o teclado físico (document na
 * tela de bloqueio; a própria janela no diálogo).
 * → { value, clear(), error(msg), focus(), destroy() }
 */
export function bindPinPad(root, { keyTarget = root, onEnter = () => {}, onChange = () => {} } = {}) {
  const pad = root.querySelector('.pinpad');
  const dots = pad.querySelector('.pinpad__dots');
  const status = pad.querySelector('[data-pin-status]');
  const errorEl = pad.querySelector('.pinpad__error');
  const max = Number(pad.dataset.max) || 8;
  let value = '';

  const paint = () => {
    // Ajusta só as bolinhas que mudaram (assim só a nova "pula")
    const count = Math.min(max, Math.max(MIN_DOTS, value.length));
    while (dots.children.length < count) dots.append(document.createElement('span'));
    while (dots.children.length > count) dots.lastElementChild.remove();
    [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i < value.length));
    status.textContent = value.length ? `${value.length} ${value.length === 1 ? 'dígito' : 'dígitos'}` : '';
  };
  const press = (key) => {
    if (key === 'ok') return onEnter(value);
    const next = key === 'del' ? value.slice(0, -1) : (value + key).slice(0, max);
    if (next === value) return;
    value = next;
    errorEl.textContent = '';
    paint();
    onChange(value);
  };

  const onClick = (ev) => {
    const k = ev.target.closest('[data-pin-key]');
    if (k && pad.contains(k)) press(k.dataset.pinKey);
  };
  const onKey = (ev) => {
    if (!pad.isConnected || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^\d$/.test(ev.key)) { ev.preventDefault(); press(ev.key); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); press('del'); }
    // Enter confirma quando o foco está no teclado (fora dele, ex.: "Cancelar", vale o botão)
    else if (ev.key === 'Enter' && (ev.target === pad || pad.contains(ev.target) || ev.target === document.body || ev.target === keyTarget || ev.target.matches?.('form, .lock__card'))) {
      ev.preventDefault();
      onEnter(value);
    }
  };
  pad.addEventListener('click', onClick);
  keyTarget.addEventListener('keydown', onKey);
  paint();

  return {
    get value() { return value; },
    clear() { value = ''; paint(); },
    error(msg) {
      errorEl.textContent = msg;
      pad.animate?.([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 240 });
    },
    focus() { pad.focus({ preventScroll: true }); },
    destroy() { keyTarget.removeEventListener('keydown', onKey); pad.removeEventListener('click', onClick); },
  };
}
