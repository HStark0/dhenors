// =============================================================
// prefs.js — Preferências só deste aparelho (localStorage)
// -------------------------------------------------------------
// Coisas da tela que não precisam ir para o backup/nuvem.
// • Atalhos de uma tecla (N, /, D): dá para desligar (WCAG 2.1.4),
//   para quem usa comando de voz ou esbarra no teclado. Ctrl+K e
//   Ctrl+Z continuam funcionando.
// =============================================================

const KEYS_OFF = 'dhenors:single-keys-off';

/** true = atalhos de uma tecla ligados (padrão). */
export function singleKeyShortcuts() {
  try { return localStorage.getItem(KEYS_OFF) !== '1'; } catch { return true; }
}

export function setSingleKeyShortcuts(on) {
  try {
    if (on) localStorage.removeItem(KEYS_OFF); else localStorage.setItem(KEYS_OFF, '1');
  } catch { /* sem acesso ao armazenamento: vale só nesta sessão */ }
}
