// =============================================================
// indicator.js — Indicador deslizante das abas e opções
// -------------------------------------------------------------
// Como o controle segmentado do iOS: em vez de cada opção ganhar o
// fundo branco ao ser escolhida, UMA "pílula" (.seg-thumb) desliza
// até a opção ativa. Vale para todas as abas (.tabs) e grupos de
// opções (.segmented: botões com aria-pressed ou rádios).
// • A pílula é marcada com data-persist: o morph (dom.js) não a apaga
//   ao redesenhar a tela, então ela anda da posição antiga à nova.
// • Nas abas que rolam de lado (celular), a aba ativa vem para o centro.
// • syncIndicators() devolve a direção da troca de aba (+1 direita,
//   −1 esquerda) para o conteúdo entrar do mesmo lado (motion.js).
// Sem animação para quem pede menos movimento (CSS em design.css).
// =============================================================

import { motionReduced } from '../core/theme.js';

const CONTAINERS = '.tabs, .segmented';

/** Opção ativa do grupo (aba selecionada, botão pressionado ou rádio marcado). */
function activeOf(container) {
  const direct = container.querySelector(':scope > [aria-selected="true"], :scope > [aria-pressed="true"]');
  if (direct) return direct;
  const radio = container.querySelector(':scope > .segmented__opt > input:checked');
  return radio ? radio.parentElement : null; // o rótulo (filho direto do grupo)
}

/**
 * Posiciona a pílula do grupo. → direção da troca (−1, 0, +1)
 * animate=false: só posiciona (primeiro desenho, mudança de tamanho).
 */
function place(container, animate = true) {
  let thumb = container.querySelector(':scope > .seg-thumb');
  if (!thumb) {
    thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    thumb.setAttribute('data-persist', '');
    thumb.setAttribute('aria-hidden', 'true');
    container.prepend(thumb);
    animate = false;
  }
  container.classList.add('has-thumb');
  const active = activeOf(container);
  if (!active || !active.offsetWidth) {
    thumb.style.opacity = '0';
    delete thumb.dataset.x;
    return 0;
  }
  const box = active;
  const shape = box.matches('.segmented__opt') ? box.querySelector('span') || box : box;
  const x = box.offsetLeft;
  const y = box.offsetTop;
  const prevX = thumb.dataset.x != null ? Number(thumb.dataset.x) : null;
  const prevY = thumb.dataset.y != null ? Number(thumb.dataset.y) : null;
  if (!animate || prevX == null) thumb.classList.add('no-anim');
  thumb.style.width = `${box.offsetWidth}px`;
  thumb.style.height = `${box.offsetHeight}px`;
  thumb.style.transform = `translate(${x}px, ${y}px)`;
  thumb.style.borderRadius = getComputedStyle(shape).borderTopLeftRadius;
  thumb.style.opacity = '1';
  if (thumb.classList.contains('no-anim')) {
    void thumb.offsetWidth; // aplica a posição sem transição antes de religar
    thumb.classList.remove('no-anim');
  }
  thumb.dataset.x = String(x);
  thumb.dataset.y = String(y);

  // Abas que rolam de lado: traz a ativa para o centro
  if (container.classList.contains('tabs') && container.scrollWidth > container.clientWidth + 1) {
    const left = x - (container.clientWidth - box.offsetWidth) / 2;
    const smooth = animate && prevX != null && !motionReduced() && document.documentElement.dataset.motion !== 'off';
    container.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
  }
  if (prevX == null) return 0;
  // mesma linha: compara na horizontal; grupos que quebram linha usam a vertical
  return y === prevY ? Math.sign(x - prevX) : Math.sign(y - prevY);
}

/**
 * Atualiza todas as pílulas dentro de `root`.
 * → { tabs: direção da troca nas abas da tela (−1, 0, +1) }
 */
export function syncIndicators(root = document, { animate = true } = {}) {
  // O morph não apaga a pílula (data-persist); se o elemento foi reaproveitado
  // como outra coisa que não um grupo de opções, ela sobraria na tela
  for (const t of root.querySelectorAll('.seg-thumb')) if (!t.parentElement?.matches(CONTAINERS)) t.remove();
  let tabs = 0;
  for (const c of root.querySelectorAll(CONTAINERS)) {
    const dir = place(c, animate);
    if (c.classList.contains('tabs') && dir) tabs = dir;
  }
  return { tabs };
}

// Rádios (formulários nas janelas) mudam sem redesenhar a tela
globalThis.document?.addEventListener('change', (ev) => {
  const c = ev.target.closest?.('.segmented');
  if (c && ev.target.matches('input[type="radio"]')) place(c, true);
});

// Mudou o tamanho da janela ou carregou a fonte: reposiciona sem animar
let resizeTimer = 0;
globalThis.addEventListener?.('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => syncIndicators(document, { animate: false }), 120);
});
globalThis.document?.fonts?.ready?.then(() => syncIndicators(document, { animate: false }));
