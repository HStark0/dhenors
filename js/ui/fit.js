// =============================================================
// fit.js — Números grandes que cabem no card
// -------------------------------------------------------------
// Valores de destaque (indicadores, resumo do mês) não quebram linha.
// Depois de desenhar, cada um é medido: se não couber na largura do
// card, a fonte diminui de 1 em 1 px até caber (mínimo de 13 px). Só
// o número que não cabe muda; os outros ficam no tamanho do design.
// Se nem assim couber, ele pode quebrar depois do "R$" (CSS: .is-tight).
// =============================================================

const BIG = '.kpi__value, .summary__big, .big-number, .hero__value, .sfig__value, .entity__value';
const MIN = 13;

export function fitValues(root = document) {
  for (const el of root.querySelectorAll(BIG)) {
    el.style.fontSize = '';
    el.classList.remove('is-tight');
    if (!el.clientWidth || el.scrollWidth <= el.clientWidth + 1) continue;
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > MIN) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add('is-tight');
  }
}
