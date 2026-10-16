// =============================================================
// motion.js — Animações da interface
// -------------------------------------------------------------
// • Entrada de tela: ao trocar de tela (ou abrir o app), o <body>
//   ganha .route-enter por ~1,4s. O CSS (brand.css) usa essa classe
//   para a cascata dos cards, o desenho dos gráficos e o
//   preenchimento das barras — e só nessa hora, para que mudanças
//   pequenas (pagar uma conta, digitar num filtro) não "pisquem".
// • Números que contam: valores em R$ dos destaques sobem do zero
//   ao entrar na tela e deslizam do valor antigo ao novo quando mudam.
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
export function afterViewRender(root, route, { entering = false, tabOnly = false } = {}) {
  if (tabOnly) {
    // Troca de aba: só o conteúdo abaixo das abas aparece suave (sem cascata)
    document.body.classList.remove('route-enter', 'tab-enter');
    void document.body.offsetWidth;
    document.body.classList.add('tab-enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => document.body.classList.remove('tab-enter'), 400);
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

function tween(node, from, to, format, original, duration) {
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  const step = (now) => {
    if (!node.isConnected) return;
    // o horário do quadro pode vir um pouco antes de "start": limita entre 0 e 1
    const t = Math.max(0, Math.min(1, (now - start) / duration));
    node.data = t < 1 ? format(Math.round(from + (to - from) * ease(t))) : original;
    if (t < 1) requestAnimationFrame(step);
  };
  node.data = format(from);
  requestAnimationFrame(step);
}
