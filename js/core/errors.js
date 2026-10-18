// @ts-check
// =============================================================
// errors.js — Registro de erros (para depurar)
// -------------------------------------------------------------
// Erros não tratados (window.onerror, promessas rejeitadas) e os
// registrados pelo app ficam na MEMÓRIA enquanto o app está aberto
// (últimos 100), sem valores dos seus dados — nada vai para o
// navegador. Em Ajustes → Dados você exporta o registro para mandar
// junto de uma issue.
// =============================================================

import { APP_VERSION } from '../version.js';

const MAX = 100;
let buffer = [];

/** Registra um erro: { at, message, stack, where, route, version }. */
export function logError(err, where = '') {
  const e = err instanceof Error ? err : new Error(String(err?.message || err));
  buffer.push({
    at: new Date().toISOString(),
    message: String(e.message).slice(0, 300),
    stack: String(e.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 1200),
    where: String(where).slice(0, 80),
    route: (globalThis.location?.hash || '').split('?')[0].slice(0, 40),
    version: APP_VERSION,
    ua: (globalThis.navigator?.userAgent || '').slice(0, 160),
  });
  if (buffer.length > MAX) buffer = buffer.slice(-MAX);
}

export function initErrorLog() {
  addEventListener('error', (ev) => logError(ev.error || ev.message, `${ev.filename || ''}:${ev.lineno || ''}`));
  addEventListener('unhandledrejection', (ev) => logError(ev.reason, 'promise'));
}

export async function errorLog() {
  return [...buffer];
}

export async function clearErrorLog() {
  buffer = [];
}
