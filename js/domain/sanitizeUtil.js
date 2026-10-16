// @ts-check
// =============================================================
// sanitizeUtil.js — Validadores básicos usados na limpeza do backup
// -------------------------------------------------------------
// Parte de domain/schema.js. Funções pequenas e puras.
// =============================================================

export const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const isInt = (v) => Number.isInteger(v);
export const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
export const optId = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
export const arr = (v) => (Array.isArray(v) ? v : []);
export const cents = (v, { zero = false, neg = false } = {}) => isInt(v) && (neg || (zero ? v >= 0 : v > 0)) && Math.abs(v) <= 10_000_000_000;
export const day = (v, def = 1) => (isInt(v) && v >= 1 && v <= 31 ? v : def);
export const color = (v, def) => (/^#[0-9a-f]{6}$/i.test(v) ? v : def);
export const tags = (v) => [...new Set(arr(v).filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 30)).filter(Boolean))].slice(0, 12);
export const pick = (v, list, def) => (list.includes(v) ? v : def);
