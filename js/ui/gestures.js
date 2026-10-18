// =============================================================
// gestures.js — Gestos e teclado nas listas de contas
// -------------------------------------------------------------
// • Deslizar (celular): conta para a DIREITA marca como paga (ou
//   desfaz); para a ESQUERDA abre as opções.
// • Puxar para atualizar: no topo da página, puxe para baixo para
//   redesenhar e sincronizar com a nuvem.
// • Teclado nas listas: ↑ ↓ andam entre as contas, Enter abre
//   "Pagar…", Espaço marca/desmarca como pago hoje, M abre o menu,
//   Home/End vão para a primeira/última.
// =============================================================

import { itemByKey, openItemMenu } from './items.js';
import { quickToggle, payDialog, buzz } from './pay.js';
import { motionReduced } from '../core/theme.js';
import { toastError } from './toast.js';

/** Ação pelo teclado: erro (ex.: mês fechado) vira aviso, como nos cliques (main.js). */
const safely = (fn) => { try { fn(); } catch (err) { if (err?.name !== 'GuestError') toastError(err?.message || 'Não foi possível.'); } };

const THRESHOLD = 84;

// ---------- Deslizar ----------

export function initSwipe() {
  let start = null;
  let row = null;
  let locked = null; // 'x' (deslizando) | 'y' (rolando)

  document.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    const li = ev.target.closest('.item[data-swipe]');
    if (!li || ev.target.closest('button, input, a, select')) return;
    start = { x: ev.clientX, y: ev.clientY };
    row = li;
    locked = null;
  }, { passive: true });

  document.addEventListener('pointermove', (ev) => {
    if (!row || !start) return;
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      locked = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
    }
    if (locked !== 'x') return;
    const shift = Math.max(-140, Math.min(140, dx));
    row.style.transform = `translateX(${shift}px)`;
    row.dataset.swiping = shift > 0 ? 'pay' : 'menu';
    row.classList.toggle('is-armed', Math.abs(shift) >= THRESHOLD);
  }, { passive: true });

  const end = (ev) => {
    if (!row) return;
    const li = row;
    const dx = start ? ev.clientX - start.x : 0;
    row = null;
    start = null;
    li.style.transition = motionReduced() ? '' : 'transform 200ms ease';
    li.style.transform = '';
    setTimeout(() => { li.style.transition = ''; delete li.dataset.swiping; li.classList.remove('is-armed'); }, 220);
    if (locked !== 'x' || Math.abs(dx) < THRESHOLD) return;
    const item = itemByKey(li.dataset.key);
    if (!item) return;
    buzz(10);
    if (dx > 0) safely(() => quickToggle(item)); else safely(() => openItemMenu(item));
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

// ---------- Teclado nas listas ----------

export function initListKeys() {
  document.addEventListener('keydown', (ev) => {
    const li = ev.target.closest?.('[data-listnav] > .item');
    if (!li || ev.target !== li) return;
    const all = [...document.querySelectorAll('#view [data-listnav] > .item, dialog[open] [data-listnav] > .item')];
    const i = all.indexOf(li);
    const move = (n) => {
      const next = all[Math.max(0, Math.min(all.length - 1, n))];
      if (!next) return;
      li.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    };
    const item = itemByKey(li.dataset.key);
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); move(i + 1); break;
      case 'ArrowUp': ev.preventDefault(); move(i - 1); break;
      case 'Home': ev.preventDefault(); move(0); break;
      case 'End': ev.preventDefault(); move(all.length - 1); break;
      case 'Enter': ev.preventDefault(); if (item) safely(() => (item.status === 'paid' ? openItemMenu(item) : payDialog(item))); break;
      case ' ': ev.preventDefault(); if (item) safely(() => quickToggle(item)); break;
      case 'm': case 'M': ev.preventDefault(); if (item) safely(() => openItemMenu(item)); break;
      default: break;
    }
  });
  // Ao focar uma linha com o mouse/tab, ela vira a "linha ativa" (roving tabindex)
  document.addEventListener('focusin', (ev) => {
    const li = ev.target.closest?.('[data-listnav] > .item');
    if (!li || ev.target !== li) return;
    for (const other of li.closest('[data-listnav]').children) if (other !== li) other.tabIndex = -1;
  });
}

// ---------- Puxar para atualizar ----------

/** onRefresh: () => Promise (redesenha e sincroniza). */
export function initPullToRefresh(onRefresh) {
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  let startY = null;
  let pulled = 0;
  document.addEventListener('touchstart', (ev) => {
    if (scrollY > 0 || document.querySelector('dialog[open]') || ev.touches.length !== 1) { startY = null; return; }
    startY = ev.touches[0].clientY;
    pulled = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (startY == null) return;
    pulled = Math.max(0, ev.touches[0].clientY - startY);
    if (pulled <= 0) return;
    const h = Math.min(90, pulled * 0.5);
    ptr.style.height = `${h}px`;
    ptr.classList.toggle('is-armed', h >= 60);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (startY == null) return;
    const armed = ptr.classList.contains('is-armed');
    startY = null;
    if (!armed) { ptr.style.height = '0'; return; }
    ptr.classList.add('is-loading');
    buzz(10);
    try { await onRefresh(); } finally {
      ptr.classList.remove('is-loading', 'is-armed');
      ptr.style.height = '0';
    }
  });
}
