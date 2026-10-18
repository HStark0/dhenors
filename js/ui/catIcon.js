// =============================================================
// catIcon.js — Ícone de categoria: ícone próprio num círculo da cor
// -------------------------------------------------------------
// Antes: um ponto colorido + um emoji (repetiam a mesma informação e
// o emoji muda de cara no Windows, Android e iPhone). Agora: o ícone
// do sprite, branco, dentro de um círculo da cor da categoria.
// Emojis de cadastros antigos viram o ícone equivalente quando existe
// (domain/defaults.js → EMOJI_ICONS); senão aparecem no círculo.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { EMOJI_ICONS } from '../domain/defaults.js';

/** Nome do ícone do sprite para a categoria (ou null se for um emoji sem equivalente). */
export function catIconName(cat) {
  const v = String(cat?.icon || '');
  if (v.startsWith('i:')) return v.slice(2);
  return EMOJI_ICONS[v] || (cat ? null : 'tag');
}

/**
 * Círculo com o ícone. size: 'sm' (listas), 'md' (cards), 'lg'.
 * `label` vira texto para leitores de tela (o círculo é decorativo por padrão).
 */
export function catIcon(cat, { size = 'sm', label = '' } = {}) {
  const color = cat?.color || '#64748B';
  const name = catIconName(cat);
  return html`<span class="cat-icon cat-icon--${size}" style="--cat:${color}" ${label ? html`role="img" aria-label="${label}"` : html`aria-hidden="true"`}>${name ? icon(name) : html`<span class="cat-icon__emoji">${cat?.icon || '🏷️'}</span>`}</span>`;
}
