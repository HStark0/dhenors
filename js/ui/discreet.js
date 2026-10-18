// =============================================================
// discreet.js — Modo discreto: nenhum valor em R$ à mostra
// -------------------------------------------------------------
// Os valores de destaque já vêm marcados (.money, .kpi__value…). Mas
// muita frase leva valor no meio ("Bruto R$ 6.924,20 · descontos…",
// "faltam R$ 224,71", avisos, janelas). Com o modo ligado, este módulo
// envolve cada "R$ 1.234,56" de texto solto num <span class="money">:
// o CSS (outlook.css) troca o valor por um olho cortado + "••••" no
// mesmo lugar, e tocar nele mostra o valor por 3 s (main.js).
// Observa a página: telas redesenhadas, janelas e avisos novos também
// são cobertos. Desligado, não mexe em nada.
// =============================================================

/** "R$ 1.234,56", "−R$ 80", "+R$ 3,5 mil", "R$ 12 mil" */
const BRL = /[−+-]?R\$\s?\d[\d.]*(?:,\d+)?(?:\s?mil)?/g; // o espaço antes do R$ fica fora
/** Valores escondidos no modo discreto (o mesmo seletor do CSS em outlook.css). */
export const DISCREET_VALUES = '.money, .kpi__value, .big-number, .hero__value, .sfig__value, .summary__big, .mdetail__balance, .mstrip__value, .weight-bars__v, .cal__chip';
/** Onde não mexer: já marcado, campos, scripts e gráficos (têm regra própria). */
const SKIP = `${DISCREET_VALUES}, input, textarea, select, script, style, svg, [contenteditable], .sr-only, title`;

const on = () => document.documentElement.hasAttribute('data-discreet');

function wrapIn(root) {
  if (!on() || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      BRL.lastIndex = 0;
      if (!n.data.includes('R$') || !BRL.test(n.data)) return NodeFilter.FILTER_REJECT;
      return n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0;
    BRL.lastIndex = 0;
    for (const m of node.data.matchAll(BRL)) {
      if (m.index > last) frag.append(node.data.slice(last, m.index));
      const span = document.createElement('span');
      span.className = 'money money--inline';
      span.textContent = m[0];
      frag.append(span);
      last = m.index + m[0].length;
    }
    if (last < node.data.length) frag.append(node.data.slice(last));
    node.replaceWith(frag);
  }
}

let frame = 0;
const pending = new Set();
function schedule(node) {
  pending.add(node);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const list = [...pending];
    pending.clear();
    for (const n of list) if (n.isConnected) wrapIn(n.nodeType === 1 ? n : n.parentElement);
  });
}

/** Liga a observação da página (uma vez, na abertura do app). */
export function initDiscreet() {
  new MutationObserver((records) => {
    if (!on()) return;
    for (const r of records) {
      if (r.type === 'characterData') schedule(r.target);
      else for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) schedule(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  // Ligar o modo: cobre o que já está na tela
  new MutationObserver(() => { if (on()) schedule(document.body); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-discreet'] });
  schedule(document.body);
}
