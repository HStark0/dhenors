// @ts-check
// =============================================================
// chunks.js — Divide o estado em partes para a nuvem
// -------------------------------------------------------------
// Em vez de mandar o estado inteiro a cada mudança, a nuvem guarda
// uma parte por coleção ("expenses", "goals", "settings"…) e as
// listas que crescem com o tempo são separadas POR ANO
// ("expenses:2026"). Cada envio leva só as partes que mudaram.
// Assim anos de dados não chegam no limite de 5 MB por linha.
//
// Funções puras (testadas em tests/cloud.test.mjs).
// =============================================================

/** Coleções em lista que são separadas por ano: chave → função que devolve o ano do item. */
const BY_YEAR_LIST = {
  expenses: (x) => String(x.dueDate || '').slice(0, 4),
  extraIncomes: (x) => String(x.ym || x.date || '').slice(0, 4),
  cardPurchases: (x) => String(x.date || '').slice(0, 4),
  transfers: (x) => String(x.date || '').slice(0, 4),
  shifts: (x) => String(x.date || '').slice(0, 4),
  incomes: (x) => String(x.date || '').slice(0, 4),
};

/** Coleções em objeto { chave: valor } separadas pelo ano que está na chave. */
const BY_YEAR_OBJECT = {
  closedMonths: (k) => k.slice(0, 4),
  recurringEntries: (k) => k.split('|')[1]?.slice(0, 4) || '0000',
};

/** Campos simples do topo do estado (vão juntos numa parte "meta"). */
const META_KEYS = ['schema', 'createdAt', 'updatedAt', 'lastBackupAt', 'onboarded'];

const year = (y) => (/^\d{4}$/.test(y) ? y : '0000');

/** Estado → { nomeDaParte: valor } */
export function splitChunks(state) {
  const out = { meta: {} };
  for (const [key, value] of Object.entries(state)) {
    if (META_KEYS.includes(key)) { out.meta[key] = value; continue; }
    if (BY_YEAR_LIST[key] && Array.isArray(value)) {
      out[key] = []; // a parte vazia marca que a coleção existe
      for (const item of value) {
        const name = `${key}:${year(BY_YEAR_LIST[key](item))}`;
        (out[name] ||= []).push(item);
      }
      continue;
    }
    if (BY_YEAR_OBJECT[key] && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = {};
      for (const [k, v] of Object.entries(value)) {
        const name = `${key}:${year(BY_YEAR_OBJECT[key](k))}`;
        (out[name] ||= {})[k] = v;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** { nomeDaParte: valor } → estado */
export function joinChunks(parts) {
  const state = { ...(parts.meta || {}) };
  const names = Object.keys(parts).filter((n) => n !== 'meta').sort();
  for (const name of names) {
    const [key, part] = name.split(':');
    const value = parts[name];
    if (part === undefined) {
      if (BY_YEAR_LIST[key]) state[key] = [...(state[key] || []), ...(value || [])];
      else if (BY_YEAR_OBJECT[key]) state[key] = { ...(state[key] || {}), ...(value || {}) };
      else state[key] = value;
      continue;
    }
    if (BY_YEAR_LIST[key]) state[key] = [...(state[key] || []), ...(value || [])];
    else state[key] = { ...(state[key] || {}), ...(value || {}) };
  }
  return state;
}

/** JSON com chaves em ordem (o mesmo conteúdo sempre gera o mesmo texto). */
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Impressão digital de cada parte (SHA-256). */
export async function hashChunks(parts) {
  const enc = new TextEncoder();
  const out = {};
  for (const [name, value] of Object.entries(parts)) {
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(stableJSON(value)));
    out[name] = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  return out;
}

/** Quais partes mudaram (inclui as novas) e quais sumiram. */
export function diffChunks(hashes, previous = {}) {
  const changed = Object.keys(hashes).filter((n) => previous[n]?.hash !== hashes[n]);
  const removed = Object.keys(previous).filter((n) => !(n in hashes));
  return { changed, removed };
}

/** Tamanho aproximado (bytes) de uma parte depois de virar JSON. */
export const chunkSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export const isManifest = (v) => Boolean(v && v.format === 'dhenors-manifest' && v.chunks);
