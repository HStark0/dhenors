// =============================================================
// pwa.js — Instalação e ajustes de celular
// -------------------------------------------------------------
// • Atualização: nada a fazer. O app não fica guardado no navegador
//   (o service worker não tem cache), então cada abertura já vem na
//   versão mais nova. As Novidades aparecem depois, como sempre.
// • Instalar: guarda o evento "beforeinstallprompt" e oferece um botão
//   "Instalar app". No iPhone (que não tem esse evento) mostra o passo
//   a passo do "Adicionar à Tela de Início".
// • Teclado do celular: ao focar um campo num diálogo, rola para ele
//   não ficar escondido; a altura visível vira a variável --vvh.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';

let deferredPrompt = null;
const listeners = new Set();

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Pode mostrar o botão "Instalar"? */
export const canInstall = () => !isStandalone() && (Boolean(deferredPrompt) || isIOS());
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((fn) => fn());

export function initInstall() {
  addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredPrompt = ev;
    changed();
  });
  addEventListener('appinstalled', () => {
    deferredPrompt = null;
    changed();
    toast('Dhenors instalado! Abra pelo ícone na tela inicial.');
  });
}

export async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    changed();
    if (outcome === 'accepted') toast('Instalando…', { type: 'info' });
    return;
  }
  if (isIOS()) {
    openDialog({
      title: 'Instalar no iPhone',
      size: 'sm',
      body: html`
        <ol class="steps">
          <li>Abra o Dhenors no <strong>Safari</strong> (no Chrome do iPhone não dá).</li>
          <li>Toque no botão <strong>Compartilhar</strong> ${icon('share-2', 'icon--xs')} na barra de baixo.</li>
          <li>Role e toque em <strong>Adicionar à Tela de Início</strong>.</li>
          <li>Toque em <strong>Adicionar</strong>. O app abre em tela cheia, com ícone próprio.</li>
        </ol>
        <p class="field__hint">No iPhone, os lembretes com o app fechado (push) só funcionam com o app instalado.</p>`,
    });
    return;
  }
  openDialog({
    title: 'Instalar o app',
    size: 'sm',
    body: html`<p class="dialog__text">No menu do navegador (⋮ ou ⋯), procure <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</p>`,
  });
}

// ---------- Service worker (só push e instalação) ----------

export function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .catch((err) => console.warn('Service worker não registrado', err));
}

// ---------- Teclado do celular e área segura ----------

export function initViewport() {
  const vv = globalThis.visualViewport;
  const set = () => {
    const h = vv ? vv.height : innerHeight;
    document.documentElement.style.setProperty('--vvh', `${h / 100}px`); // 1% da altura visível (como 1vh)
    document.documentElement.classList.toggle('kb-open', vv ? innerHeight - vv.height > 150 : false);
  };
  vv?.addEventListener('resize', set);
  addEventListener('resize', set);
  set();
  // Campo focado dentro de um diálogo: garante que fica visível acima do teclado
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!el.matches?.('input, textarea, select') || !el.closest('dialog')) return;
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260);
  });
}
