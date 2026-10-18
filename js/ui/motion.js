// =============================================================
// motion.js — Animações da interface
// -------------------------------------------------------------
// • Entrada de tela: ao trocar de tela (ou abrir o app), o <body>
//   ganha .route-enter por ~1,4s. O CSS (brand.css) usa essa classe
//   para a cascata dos cards, o desenho dos gráficos e o
//   preenchimento das barras — e só nessa hora, para que mudanças
//   pequenas (pagar uma conta, digitar num filtro) não "pisquem".
// • Troca de aba ou de mês (.tab-enter + data-dir): só o conteúdo
//   desliza, do lado para onde se andou; a pílula das abas desliza
//   junto (ui/indicator.js). Mudar de mês não refaz a cascata da tela.
// • Números que contam: valores em R$ dos destaques sobem do zero
//   ao entrar na tela e deslizam do valor antigo ao novo quando mudam.
// • Reordenar cards (flipLayout): cada card desliza até o novo lugar.
// Quem pede "reduzir movimento" no sistema não vê nada disso.
// =============================================================

import { motionReduced } from '../core/theme.js';

// Sistema pedindo menos movimento, ou Ajustes → Efeitos "Desligados"/"Calmos"
const reduced = () => motionReduced() || globalThis.document?.documentElement.dataset.motion === 'calm';

const NUMBERS = '.hero__value, .kpi__value, .big-number, .stats dd, .entity__value, .score__num strong, .chip dd, .kv strong';
const MONEY = /(R\$\s?)(\d{1,3}(?:\.\d{3})*,\d{2})/;
const INT = /^(\s*)(\d{1,3})(\s*)$/;

let memory = new Map();
let lastRoute = '';
let enterTimer = 0;

/** Chame depois de cada render da tela. */
export function afterViewRender(root, route, { entering = false, tabOnly = false, dir = 0 } = {}) {
  if (tabOnly) {
    // Troca de aba ou de mês: só o conteúdo abaixo das abas desliza, vindo
    // do lado para onde se andou (aba à direita / mês seguinte → da direita)
    document.body.classList.remove('route-enter', 'tab-enter');
    if (dir) document.body.dataset.dir = dir > 0 ? 'next' : 'prev';
    else delete document.body.dataset.dir;
    void document.body.offsetWidth;
    document.body.classList.add('tab-enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { document.body.classList.remove('tab-enter'); delete document.body.dataset.dir; }, 450);
  } else if (entering) {
    document.body.classList.remove('route-enter', 'tab-enter');
    // força o navegador a "esquecer" a animação anterior antes de reiniciar
    void document.body.offsetWidth;
    document.body.classList.add('route-enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => document.body.classList.remove('route-enter'), 1600);
    root.querySelectorAll('.card').forEach((card, i) => card.style.setProperty('--i', Math.min(i, 14)));
  }
  countNumbers(root, route, entering);
}

function countNumbers(root, route, entering) {
  const next = new Map();
  const skip = reduced();
  // Outra tela: os números sobem do zero. Mesmo tela (ex.: outro mês): deslizam do valor antigo.
  const fromZero = entering && route !== lastRoute;
  root.querySelectorAll(NUMBERS).forEach((el, i) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && (MONEY.test(n.data) || INT.test(n.data)));
    if (!node) return;
    const original = node.data;
    const money = original.match(MONEY);
    const value = money ? Number(money[2].replace(/\./g, '').replace(',', '')) : Number(original.match(INT)[2]);
    const key = `${route}|${i}`;
    next.set(key, value);
    if (skip) return;
    const from = fromZero ? 0 : memory.get(key);
    if (from == null || from === value) return;
    const format = money
      ? (n) => original.replace(MONEY, (_, cur) => cur + (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : (n) => original.replace(INT, (_, a, _n, b) => a + Math.round(n) + b);
    tween(node, from, value, format, original, fromZero ? 1000 : 550);
  });
  memory = route === lastRoute ? new Map([...memory, ...next]) : next;
  lastRoute = route;
}

/**
 * Anima uma mudança de layout (técnica FLIP): guarda onde cada elemento
 * `selector` estava, roda `change()` e, depois do próximo desenho, faz
 * cada um deslizar da posição antiga até a nova.
 */
export function flipLayout(selector, change) {
  if (reduced() || motionOff()) { change(); return; }
  const before = new Map();
  for (const el of document.querySelectorAll(selector)) {
    const key = el.getAttribute('data-key');
    if (key) before.set(key, el.getBoundingClientRect());
  }
  change();
  // o redesenho da tela também vem num requestAnimationFrame (main.js), registrado antes deste
  requestAnimationFrame(() => {
    for (const el of document.querySelectorAll(selector)) {
      const old = before.get(el.getAttribute('data-key'));
      if (!old) continue;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.32, .72, 0, 1)' });
    }
  });
}

const motionOff = () => globalThis.document?.documentElement.dataset.motion === 'off';

/** Animação em curso por nó de texto: uma nova (ou um redesenho) cancela a anterior. */
const running = new WeakMap();

function tween(node, from, to, format, original, duration) {
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  const token = {};
  running.set(node, token);
  let written = format(from);
  const step = (now) => {
    // Parou: nó saiu da tela, outra animação começou nele, ou o redesenho
    // trocou o texto (senão o fim desta escreveria o número antigo)
    if (!node.isConnected || running.get(node) !== token || node.data !== written) return;
    // o horário do quadro pode vir um pouco antes de "start": limita entre 0 e 1
    const t = Math.max(0, Math.min(1, (now - start) / duration));
    written = t < 1 ? format(Math.round(from + (to - from) * ease(t))) : original;
    node.data = written;
    if (t < 1) requestAnimationFrame(step);
    else running.delete(node);
  };
  node.data = written;
  requestAnimationFrame(step);
}
