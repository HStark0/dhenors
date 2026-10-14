// =============================================================
// lock.js — Tela de bloqueio por PIN
// -------------------------------------------------------------
// • Com PIN ativo, os dados ficam CRIPTOGRAFADOS no navegador e o
//   app abre nesta tela.
// • Bloqueia de novo depois de X minutos fora do app (Ajustes).
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';
import { store } from '../core/store.js';

const AUTO_KEY = 'dhenors:autolock';
let hiddenAt = 0;

export const autoLockMinutes = () => {
  try { return Number(localStorage.getItem(AUTO_KEY) ?? 5); } catch { return 5; }
};
export const setAutoLockMinutes = (m) => { try { localStorage.setItem(AUTO_KEY, String(m)); } catch { /* ignora */ } };

/**
 * Mostra a tela de bloqueio. `mode`:
 *  'unlock' → dados ainda criptografados (abertura do app)
 *  'relock' → dados já abertos, só confere o PIN
 * Resolve quando o PIN estiver certo.
 */
export function showLock(mode = 'unlock') {
  return new Promise((resolve) => {
    document.querySelector('.lock')?.remove();
    const name = store.data?.settings.profileName;
    // Reaproveita o logo da página (no arquivo único ele já vem embutido)
    const logo = document.querySelector('img[src*="logo-64"], img[src^="data:image"]')?.src || 'assets/icons/logo-64.png';
    const el = fragment(html`
      <div class="lock" role="dialog" aria-modal="true" aria-labelledby="lock-title">
        <form class="lock__card" autocomplete="off">
          <img src="${logo}" alt="" width="56" height="56" class="lock__logo">
          <h1 id="lock-title" class="lock__title">${name ? `Olá, ${name}` : 'Dhenors bloqueado'}</h1>
          <p class="lock__text">${icon('lock-keyhole', 'icon--xs')} Digite seu PIN para abrir</p>
          <div class="lock__dots" aria-hidden="true">${Array.from({ length: 6 }, () => html`<span></span>`)}</div>
          <label class="sr-only" for="lock-pin">PIN</label>
          <input id="lock-pin" class="lock__input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="current-password" required>
          <p class="lock__error" role="alert"></p>
          <div class="lock__pad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" class="lock__key" data-key="${n}">${n}</button>`)}
            <button type="button" class="lock__key lock__key--fn" data-key="del" aria-label="Apagar">${icon('undo-2')}</button>
            <button type="button" class="lock__key" data-key="0">0</button>
            <button type="submit" class="lock__key lock__key--ok" aria-label="Entrar">${icon('arrow-right')}</button>
          </div>
          <p class="lock__hint">Esqueceu o PIN? Os dados só podem ser recuperados restaurando um backup.</p>
        </form>
      </div>`);
    document.body.append(el);
    document.body.classList.add('is-locked');
    const form = el.querySelector('form');
    const input = el.querySelector('input');
    const error = el.querySelector('.lock__error');
    const dots = [...el.querySelectorAll('.lock__dots span')];
    const paint = () => dots.forEach((d, i) => d.classList.toggle('is-on', i < input.value.length));

    el.addEventListener('click', (ev) => {
      const k = ev.target.closest('[data-key]');
      if (!k) return;
      input.value = k.dataset.key === 'del' ? input.value.slice(0, -1) : (input.value + k.dataset.key).slice(0, 8);
      paint();
      input.focus();
    });
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); paint(); });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (input.value.length < 4) { error.textContent = 'O PIN tem de 4 a 8 números.'; return; }
      el.classList.add('is-busy');
      try {
        if (mode === 'unlock') await store.unlock(input.value);
        else if (!(await store.checkPin(input.value))) throw new Error('PIN incorreto.');
        el.remove();
        document.body.classList.remove('is-locked');
        resolve();
      } catch (err) {
        error.textContent = err.message || 'PIN incorreto.';
        input.value = '';
        paint();
        el.querySelector('.lock__card').animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 240 });
      } finally {
        el.classList.remove('is-busy');
      }
    });
    input.focus();
  });
}

/** Bloqueia de novo ao voltar depois de X minutos fora (se houver PIN). */
export function bindAutoLock() {
  document.addEventListener('visibilitychange', () => {
    if (!store.pinEnabled) return;
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const minutes = autoLockMinutes();
    if (hiddenAt && minutes >= 0 && Date.now() - hiddenAt >= minutes * 60_000) showLock('relock');
  });
}
