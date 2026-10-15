// =============================================================
// scrollHint.js — Indica que há mais conteúdo para rolar
// -------------------------------------------------------------
// As barras de rolagem ficam invisíveis em todo o app. Para não
// esconder conteúdo "sem aviso":
//   • áreas internas (janelas, listas, menu lateral) ganham o
//     atributo data-scroll-more enquanto houver conteúdo abaixo —
//     o CSS desenha um esmaecido com uma seta no rodapé da área;
//   • a página ganha um botão flutuante com seta que rola para baixo.
// =============================================================

import { html, fragment } from './dom.js';
import { icon } from './icons.js';

const SCROLLERS = '.dialog__body, .palette__list, .listbox, .sidebar__nav';
const SLACK = 8; // px de folga para não piscar no fim da rolagem

const hasMore = (el) => el.scrollHeight - el.scrollTop - el.clientHeight > SLACK;

function setMore(el, more) {
  if (el.hasAttribute('data-scroll-more') !== more) el.toggleAttribute('data-scroll-more', more);
}

let cue = null;

function updatePage() {
  const doc = document.documentElement;
  const more = doc.scrollHeight - window.scrollY - window.innerHeight > SLACK * 5;
  cue.classList.toggle('is-visible', more && !document.body.classList.contains('is-locked'));
}

function updateAll() {
  for (const el of document.querySelectorAll(SCROLLERS)) setMore(el, hasMore(el));
  updatePage();
}

let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateAll(); }); };

export function initScrollHints() {
  cue = fragment(html`
    <button type="button" class="page-cue" aria-label="Rolar para ver mais" tabindex="-1">${icon('chevron-down')}</button>`);
  document.body.append(cue);
  cue.addEventListener('click', () => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));

  // "scroll" não borbulha, mas é capturado no document (pega todas as áreas)
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['open', 'hidden', 'class', 'style'],
  });
  schedule();
}
