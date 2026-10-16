// =============================================================
// pwa.js — Instalação, atualização e ajustes de celular
// -------------------------------------------------------------
// • Atualização: o service worker baixa a versão nova e ESPERA. O app
//   mostra "Nova versão disponível · Atualizar"; ao tocar, a nova
//   versão assume e a página recarrega uma vez (sem misturar módulos
//   antigos e novos no meio do uso).
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
          <li>Toque em <strong>Adicionar</strong>. O app abre em tela cheia e funciona sem internet.</li>
        </ol>
        <p class="field__hint">Dica: instalado, o iPhone guarda os dados com mais segurança (o Safari pode apagar dados de sites não usados por 7 dias).</p>`,
    });
    return;
  }
  openDialog({
    title: 'Instalar o app',
    size: 'sm',
    body: html`<p class="dialog__text">No menu do navegador (⋮ ou ⋯), procure <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</p>`,
  });
}

// ---------- Atualização (service worker) ----------

export function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    const offer = (worker) => {
      if (!worker || !navigator.serviceWorker.controller) return; // 1ª instalação: nada a avisar
      toast('Nova versão do Dhenors disponível.', {
        type: 'update', persist: true, id: 'sw-update',
        action: { label: 'Atualizar', run: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
      });
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // Procura versão nova ao voltar para o app e a cada 30 min
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60_000);
  }).catch((err) => console.warn('Service worker não registrado', err));
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
