// =============================================================
// tabs.js — Abas dentro de uma tela (ex.: Contas → Mês · Recorrentes…)
// -------------------------------------------------------------
// A aba fica no endereço (#/contas?aba=recorrentes): dá para voltar,
// favoritar e abrir direto. Teclado: ← → trocam de aba (padrão ARIA).
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';

/** Parâmetros do endereço atual: #/rota?aba=x&novo=1 */
export function routeParams() {
  const q = location.hash.split('?')[1] || '';
  return new URLSearchParams(q);
}

export const currentTab = (tabs, fallback = tabs[0]?.id) => {
  const t = routeParams().get('aba');
  return tabs.some((x) => x.id === t) ? t : fallback;
};

/**
 * tabsNav('contas', [{ id, label, icon, badge }], ativa)
 */
export function tabsNav(route, tabs, active) {
  return html`
    <nav class="tabs" role="tablist" aria-label="Seções" data-tabs>
      ${tabs.map((t) => html`
        <a class="tabs__tab" role="tab" href="#/${route}?aba=${t.id}" aria-selected="${t.id === active}" ${t.id === active ? html`aria-current="page"` : ''} tabindex="${t.id === active ? 0 : -1}">
          ${t.icon ? icon(t.icon, 'icon--xs') : ''}<span>${t.label}</span>${t.badge ? html`<span class="tabs__badge">${t.badge}</span>` : ''}
        </a>`)}
    </nav>`;
}

// Setas trocam de aba
globalThis.document?.addEventListener('keydown', (ev) => {
  const tab = ev.target.closest?.('[data-tabs] .tabs__tab');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
  const list = [...tab.closest('[data-tabs]').querySelectorAll('.tabs__tab')];
  const i = list.indexOf(tab);
  const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
  ev.preventDefault();
  // Sem rolar a página; ao redesenhar, main.js devolve o foco à aba ativa
  list[next].focus({ preventScroll: true });
  list[next].click();
});
