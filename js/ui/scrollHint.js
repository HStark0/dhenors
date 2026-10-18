// =============================================================
// scrollHint.js — Indica que há mais conteúdo para rolar
// -------------------------------------------------------------
// No toque as barras de rolagem ficam escondidas. Para não esconder
// conteúdo "sem aviso", as áreas internas que rolam (janelas, listas,
// menu lateral) ganham o atributo data-scroll-more enquanto houver
// conteúdo abaixo: o CSS esmaece a borda de baixo do próprio conteúdo
// (máscara, como as listas do iOS), sem pintar faixa, sombra ou seta
// por cima. A página em si não precisa de aviso: rolar é o gesto
// natural, e com mouse as barras finas aparecem.
// =============================================================

const SCROLLERS = '.dialog__body, .palette__list, .listbox, .sidebar__nav';
const SLACK = 8; // px de folga para não piscar no fim da rolagem

const hasMore = (el) => el.scrollHeight - el.scrollTop - el.clientHeight > SLACK;

function setMore(el, more) {
  if (el.hasAttribute('data-scroll-more') !== more) el.toggleAttribute('data-scroll-more', more);
}

function updateAll() {
  for (const el of document.querySelectorAll(SCROLLERS)) setMore(el, hasMore(el));
}

let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateAll(); }); };

export function initScrollHints() {
  // "scroll" não borbulha, mas é capturado no document (pega todas as áreas)
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['open', 'hidden', 'class', 'style'],
  });
  schedule();
}
