// =============================================================
// lock.js — Tela de bloqueio por PIN
// -------------------------------------------------------------
// • Com PIN ativo, os dados ficam CRIPTOGRAFADOS no navegador e o
//   app abre nesta tela.
// • Bloqueia de novo depois de X minutos fora do app (Ajustes).
// • O PIN é digitado só no teclado da tela (ui/pinpad.js): no
//   celular, o teclado do aparelho não é acionado.
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';
import { pinPad, bindPinPad } from './pinpad.js';
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
        <div class="lock__card">
          <img src="${logo}" alt="" width="56" height="56" class="lock__logo">
          <h1 id="lock-title" class="lock__title">${name ? `Olá, ${name}` : 'Dhenors bloqueado'}</h1>
          <p class="lock__text">${icon('lock-keyhole', 'icon--xs')} Digite seu PIN para abrir</p>
          ${pinPad()}
          <p class="lock__hint">Esqueceu o PIN? Os dados só podem ser recuperados restaurando um backup.</p>
        </div>
      </div>`);
    document.body.append(el);
    document.body.classList.add('is-locked');

    let busy = false;
    const pad = bindPinPad(el, {
      keyTarget: document,
      onEnter: async (pin) => {
        if (busy) return;
        if (pin.length < 4) { pad.error('O PIN tem de 4 a 8 números.'); return; }
        busy = true;
        el.classList.add('is-busy');
        try {
          if (mode === 'unlock') await store.unlock(pin);
          else if (!(await store.checkPin(pin))) throw new Error('PIN incorreto.');
          pad.destroy();
          el.remove();
          document.body.classList.remove('is-locked');
          resolve();
        } catch (err) {
          pad.clear();
          pad.error(err.message || 'PIN incorreto.');
        } finally {
          busy = false;
          el.classList.remove('is-busy');
        }
      },
    });
    // Foco no teclado (não num campo: no celular, isso abriria o teclado do aparelho)
    document.activeElement?.blur?.();
    pad.focus();
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
