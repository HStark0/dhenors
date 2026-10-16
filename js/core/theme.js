// @ts-check
// =============================================================
// theme.js — Tema, cor de destaque, densidade e efeitos
// -------------------------------------------------------------
// FONTE ÚNICA das cores da barra do navegador/tela de abertura.
// index.html (script inicial) e manifest.webmanifest usam os
// mesmos valores; tests/version.test.mjs confere se batem.
//
// Aparência (settings):
//   theme   'auto' | 'light' | 'dark' | 'oled' (preto puro)
//   accent  'azul' | 'verde' | 'roxo' | 'laranja' | 'rosa'
//   motion  'full' | 'calm' (só transições curtas) | 'off'
//   density 'comfortable' | 'compact'
// O modo discreto (valores escondidos) é deste aparelho e fica no
// localStorage: em público você esconde aqui sem mudar nos outros.
// =============================================================

/** Cor da barra do navegador e do fundo da tela de abertura, por tema. */
export const THEME_COLORS = { light: '#F5F5F7', dark: '#0B0B0D', oled: '#000000' };

/** Cores de destaque: [principal, hover, texto no tema claro, texto no escuro, suave claro, suave escuro]. */
export const ACCENTS = {
  azul: { label: 'Azul', primary: '#0071E3', hover: '#0062C4', text: '#0066CC', textDark: '#4DA3FF', soft: '#E8F1FC', softDark: '#0F2740' },
  verde: { label: 'Verde', primary: '#1E7A34', hover: '#17652A', text: '#1E7A34', textDark: '#30D158', soft: '#E6F4EA', softDark: '#10291A' },
  roxo: { label: 'Roxo', primary: '#8944AB', hover: '#753A93', text: '#8944AB', textDark: '#BF5AF2', soft: '#F4ECF8', softDark: '#2A1734' },
  laranja: { label: 'Laranja', primary: '#B93E00', hover: '#9A3400', text: '#B93E00', textDark: '#FF9F0A', soft: '#FFF0E5', softDark: '#33220A' },
  rosa: { label: 'Rosa', primary: '#C8102E', hover: '#A80D27', text: '#C8102E', textDark: '#FF375F', soft: '#FDEBEE', softDark: '#36121A' },
};

export const THEMES = ['auto', 'light', 'dark', 'oled'];
export const MOTIONS = ['full', 'calm', 'off'];
export const DENSITIES = ['comfortable', 'compact'];

const LS = { theme: 'dhenors:theme', color: 'dhenors:theme-color', discreet: 'dhenors:discreet' };

const prefersDark = () => Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);

/** 'auto' vira 'light' ou 'dark' conforme o sistema. */
export function resolveTheme(theme) {
  if (theme === 'oled' || theme === 'dark' || theme === 'light') return theme;
  return prefersDark() ? 'dark' : 'light';
}

/** Aplica tema, destaque, densidade e efeitos no <html>. */
export function applyAppearance(settings = {}) {
  const doc = globalThis.document?.documentElement;
  if (!doc) return;
  const mode = resolveTheme(settings.theme || 'auto');
  doc.dataset.theme = mode === 'light' ? 'light' : 'dark';
  doc.toggleAttribute('data-oled', mode === 'oled');
  doc.dataset.density = DENSITIES.includes(settings.density) ? settings.density : 'comfortable';
  doc.dataset.motion = MOTIONS.includes(settings.motion) ? settings.motion : 'full';

  const a = ACCENTS[settings.accent] || ACCENTS.azul;
  const dark = mode !== 'light';
  const set = (k, v) => doc.style.setProperty(k, v);
  if (settings.accent && settings.accent !== 'azul') {
    set('--primary', a.primary);
    set('--primary-hover', a.hover);
    set('--primary-text', dark ? a.textDark : a.text);
    set('--primary-soft', dark ? a.softDark : a.soft);
    set('--btn-grad', a.primary);
  } else {
    for (const k of ['--primary', '--primary-hover', '--primary-text', '--primary-soft', '--btn-grad']) doc.style.removeProperty(k);
  }

  const color = THEME_COLORS[mode];
  for (const meta of globalThis.document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', color);
  try {
    localStorage.setItem(LS.theme, settings.theme || 'auto');
    localStorage.setItem(LS.color, color);
  } catch { /* sem acesso ao armazenamento */ }
}

// ---------- Modo discreto (esconde valores) ----------

export function isDiscreet() {
  try { return localStorage.getItem(LS.discreet) === '1'; } catch { return false; }
}

export function setDiscreet(on) {
  try { localStorage.setItem(LS.discreet, on ? '1' : '0'); } catch { /* ignora */ }
  globalThis.document?.documentElement.toggleAttribute('data-discreet', Boolean(on));
}

/** Efeitos desligados (no app) ou "reduzir movimento" do sistema. */
export function motionReduced() {
  const doc = globalThis.document?.documentElement;
  return doc?.dataset.motion === 'off' || Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
