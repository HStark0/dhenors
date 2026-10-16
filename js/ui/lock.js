// =============================================================
// lock.js — Tela de bloqueio (PIN, senha ou biometria)
// -------------------------------------------------------------
// • Com PIN/senha ativo, os dados ficam CRIPTOGRAFADOS no navegador
//   e o app abre nesta tela.
// • PIN: teclado na tela (no celular, o teclado do aparelho não abre).
//   Senha (letras e números): campo de texto comum.
// • Digital/Face ID: atalho para o PIN (core/biometric.js).
// • Erros seguidos: a partir do 3º, espera crescente (30 s, 1 min,
//   2 min… até 1 h). Opcional: apagar os dados DESTE aparelho depois
//   de N tentativas (Ajustes → Segurança). A nuvem e os backups
//   continuam intactos.
// • Bloqueia de novo depois de X minutos fora do app (Ajustes).
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';
import { pinPad, bindPinPad } from './pinpad.js';
import { store } from '../core/store.js';
import { clearState } from '../core/storage.js';
import { biometricEnabled, unlockWithBiometric } from '../core/biometric.js';

const AUTO_KEY = 'dhenors:autolock';
const FAILS_KEY = 'dhenors:lock-fails';
const WIPE_KEY = 'dhenors:lock-wipe';
let hiddenAt = 0;

const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
};

export const autoLockMinutes = () => Number(ls.get(AUTO_KEY, 5));
export const setAutoLockMinutes = (m) => ls.set(AUTO_KEY, m);

/** Apagar os dados após N tentativas erradas (0 = desligado). */
export const wipeAfter = () => Number(ls.get(WIPE_KEY, 0)) || 0;
export const setWipeAfter = (n) => ls.set(WIPE_KEY, Math.max(0, Math.min(50, Number(n) || 0)));

/** Tempo de espera depois de `count` erros (ms). */
export function lockoutDelay(count) {
  if (count < 3) return 0;
  return Math.min(3_600_000, 30_000 * 2 ** (count - 3));
}

const fails = () => ls.get(FAILS_KEY, { count: 0, until: 0 });

function registerFail() {
  const f = fails();
  const count = f.count + 1;
  const delay = lockoutDelay(count);
  ls.set(FAILS_KEY, { count, until: delay ? Date.now() + delay : 0 });
  return { count, delay };
}

const resetFails = () => ls.set(FAILS_KEY, { count: 0, until: 0 });

const fmtWait = (ms) => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`);

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
    const isPassword = store.lockKind === 'password';
    // Reaproveita o logo da página (no arquivo único ele já vem embutido)
    const logo = document.querySelector('img[src*="logo-64"], img[src^="data:image"]')?.src || 'assets/icons/logo-64.png';
    const el = fragment(html`
      <div class="lock" role="dialog" aria-modal="true" aria-labelledby="lock-title">
        <div class="lock__card">
          <img src="${logo}" alt="" width="56" height="56" class="lock__logo">
          <h1 id="lock-title" class="lock__title">${name ? `Olá, ${name}` : 'Dhenors bloqueado'}</h1>
          <p class="lock__text">${icon('lock-keyhole', 'icon--xs')} ${isPassword ? 'Digite sua senha para abrir' : 'Digite seu PIN para abrir'}</p>
          ${isPassword ? html`
            <form class="lock__form" data-pass-form>
              <label class="sr-only" for="lock-pass">Senha</label>
              <input class="input" id="lock-pass" type="password" autocomplete="current-password" required>
              <p class="pinpad__error" role="alert"></p>
              <button type="submit" class="btn btn--primary">${icon('lock-open', 'icon--xs')} Abrir</button>
            </form>` : pinPad()}
          <button type="button" class="btn btn--ghost btn--sm lock__bio" data-bio hidden>${icon('fingerprint', 'icon--xs')} Usar digital ou Face ID</button>
          <p class="lock__wait" aria-live="polite" data-wait></p>
          <p class="lock__hint">Esqueceu? Os dados deste aparelho só podem ser recuperados por um backup ou pela nuvem.${wipeAfter() ? ` Após ${wipeAfter()} tentativas erradas, os dados deste aparelho são apagados.` : ''}</p>
        </div>
      </div>`);
    document.body.append(el);
    document.body.classList.add('is-locked');

    let busy = false;
    let pad = null;
    const errorEl = el.querySelector('.pinpad__error');
    const waitEl = el.querySelector('[data-wait]');
    let waitTimer = 0;

    const done = () => {
      pad?.destroy();
      clearInterval(waitTimer);
      el.remove();
      document.body.classList.remove('is-locked');
      resetFails();
      resolve();
    };

    const showError = (msg) => { if (pad) pad.error(msg); else errorEl.textContent = msg; };

    const tickWait = () => {
      const left = fails().until - Date.now();
      el.classList.toggle('is-waiting', left > 0);
      waitEl.textContent = left > 0 ? `Muitas tentativas. Aguarde ${fmtWait(left)} para tentar de novo.` : '';
      if (left <= 0) clearInterval(waitTimer);
    };
    const startWait = () => { clearInterval(waitTimer); tickWait(); waitTimer = setInterval(tickWait, 1000); };
    if (fails().until > Date.now()) startWait();

    const attempt = async (secret) => {
      if (busy) return;
      if (fails().until > Date.now()) { startWait(); return; }
      if (!isPassword && secret.length < 4) { showError('O PIN tem de 4 a 8 números.'); return; }
      if (isPassword && secret.length < 1) return;
      busy = true;
      el.classList.add('is-busy');
      try {
        if (mode === 'unlock') await store.unlock(secret);
        else if (!(await store.checkPin(secret))) throw new Error(isPassword ? 'Senha incorreta.' : 'PIN incorreto.');
        done();
      } catch (err) {
        pad?.clear();
        const f = registerFail();
        const limit = wipeAfter();
        if (limit && f.count >= limit) {
          await clearState();
          localStorage.removeItem(FAILS_KEY);
          showError('Dados deste aparelho apagados após tentativas demais. Restaure um backup ou entre na nuvem.');
          setTimeout(() => location.reload(), 3500);
          return;
        }
        showError(`${err.message || 'Incorreto.'}${limit ? ` (${limit - f.count} tentativa${limit - f.count === 1 ? '' : 's'} até apagar)` : ''}`);
        if (f.delay) startWait();
      } finally {
        busy = false;
        el.classList.remove('is-busy');
      }
    };

    if (isPassword) {
      const form = el.querySelector('[data-pass-form]');
      form.addEventListener('submit', (ev) => { ev.preventDefault(); attempt(form.querySelector('input').value); });
      setTimeout(() => form.querySelector('input').focus(), 50);
    } else {
      pad = bindPinPad(el, { keyTarget: document, onEnter: attempt });
      // Foco no teclado (não num campo: no celular, isso abriria o teclado do aparelho)
      document.activeElement?.blur?.();
      pad.focus();
    }

    // Biometria
    biometricEnabled().then((on) => {
      const btn = el.querySelector('[data-bio]');
      if (!on || mode !== 'unlock') return;
      btn.hidden = false;
      const go = async () => {
        if (fails().until > Date.now()) return startWait();
        try { await unlockWithBiometric(); done(); } catch (err) { if (err.name !== 'NotAllowedError') showError(err.message); }
      };
      btn.addEventListener('click', go);
      go(); // oferece a digital assim que abre
    });
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
