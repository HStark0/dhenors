// =============================================================
// storage.js — Persistência no navegador
// -------------------------------------------------------------
// Usa IndexedDB (grande, assíncrono, aguenta anos de dados).
// Se IndexedDB não estiver disponível (ex.: janela anônima de
// alguns navegadores), cai para localStorage.
// =============================================================

const DB_NAME = 'dhenors';
const STORE = 'kv';
const FILES = 'files'; // anexos (fotos de comprovantes, boletos) — só neste aparelho
const KEY = 'state';
const LS_KEY = 'dhenors:state';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Banco bloqueado por outra aba'));
  });
  return dbPromise;
}

function idbRequest(mode, fn, storeName = STORE) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  }));
}

/** Lê o estado salvo (ou null se não houver). */
export async function loadState() {
  try {
    const value = await idbRequest('readonly', (s) => s.get(KEY));
    if (value) return value;
  } catch (err) {
    console.warn('[storage] IndexedDB falhou, usando localStorage.', err);
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Salva o estado inteiro. */
export async function saveState(state) {
  try {
    await idbRequest('readwrite', (s) => s.put(state, KEY));
    try { localStorage.removeItem(LS_KEY); } catch { /* sem acesso */ }
    return true;
  } catch (err) {
    if (!globalThis.localStorage) throw err;
    console.warn('[storage] IndexedDB falhou ao salvar, usando localStorage.', err);
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  }
}

/** Guarda um valor auxiliar (sessão da nuvem, chave de criptografia…). */
export async function getItem(key) {
  try { return await idbRequest('readonly', (s) => s.get(key)); } catch {
    try { const raw = localStorage.getItem(`dhenors:${key}`); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
  }
}

export async function setItem(key, value) {
  try {
    await idbRequest('readwrite', (s) => (value === undefined ? s.delete(key) : s.put(value, key)));
  } catch {
    // Sem IndexedDB: só valores simples (uma CryptoKey não vai para o localStorage)
    try {
      if (value === undefined || value instanceof CryptoKey) localStorage.removeItem(`dhenors:${key}`);
      else localStorage.setItem(`dhenors:${key}`, JSON.stringify(value));
    } catch { /* sem acesso */ }
  }
}

/**
 * Grava de uma vez (UMA transação do IndexedDB) o estado, itens
 * auxiliares e anexos. Usado na troca do PIN: ou tudo passa para a
 * chave nova, ou nada muda — nunca metade cifrada com cada chave.
 *   items: { nome: valor | undefined (apaga) } · files: [[id, registro]]
 */
export async function saveAtomic({ state, items = {}, files = [] }) {
  let db;
  try { db = await openDB(); } catch {
    // Sem IndexedDB: não há anexos; grava em sequência no localStorage
    if (state !== undefined) await saveState(state);
    for (const [k, v] of Object.entries(items)) await setItem(k, v);
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, FILES], 'readwrite');
    const kv = tx.objectStore(STORE);
    const fs = tx.objectStore(FILES);
    if (state !== undefined) kv.put(state, KEY);
    for (const [k, v] of Object.entries(items)) { if (v === undefined) kv.delete(k); else kv.put(v, k); }
    for (const [id, rec] of files) fs.put(rec, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  });
  try { localStorage.removeItem(LS_KEY); } catch { /* sem acesso */ }
}

/** Apaga tudo deste aparelho (inclusive anexos). */
export async function clearState() {
  try { await idbRequest('readwrite', (s) => s.delete(KEY)); } catch { /* ignora */ }
  try { await idbRequest('readwrite', (s) => s.clear(), FILES); } catch { /* ignora */ }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignora */ }
}

/** Apaga itens auxiliares (IndexedDB e a cópia no localStorage, se houver). */
export async function removeItems(keys) {
  for (const k of keys) {
    await setItem(k, undefined);
    try { localStorage.removeItem(`dhenors:${k}`); } catch { /* sem acesso */ }
  }
}

// ---------- Anexos (arquivos) ----------
// Guardados como { type, name, size, iv?, data } — `data` é um Blob ou,
// com PIN, bytes cifrados. Nunca vão para a nuvem nem para o backup.

export const putFile = (id, record) => idbRequest('readwrite', (s) => s.put(record, id), FILES);
export const getFile = (id) => idbRequest('readonly', (s) => s.get(id), FILES);
export const deleteFile = (id) => idbRequest('readwrite', (s) => s.delete(id), FILES);
export const listFileIds = () => idbRequest('readonly', (s) => s.getAllKeys(), FILES);

/**
 * Pede ao navegador para não apagar os dados quando faltar espaço.
 * Retorna true se o armazenamento ficou "persistente".
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageInfo() {
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage?.estimate?.() ?? {},
      navigator.storage?.persisted?.() ?? false,
    ]);
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null, persisted };
  } catch {
    return { usage: null, quota: null, persisted: false };
  }
}
