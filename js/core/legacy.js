// =============================================================
// legacy.js — Dados que versões anteriores guardavam no aparelho
// -------------------------------------------------------------
// Até a 3.4 o Dhenors salvava tudo no navegador (IndexedDB "dhenors",
// com cópia no localStorage) e, opcionalmente, cifrava com PIN/senha.
// Agora os dados ficam só na nuvem. No primeiro login neste aparelho,
// o que estava guardado aqui (estado e anexos) sobe para a nuvem e
// SÓ ENTÃO é apagado do navegador (purgeLegacy). Este módulo só lê o
// formato antigo; nada novo é gravado nele.
// =============================================================

import { deriveKey, decryptJSON, decryptBytes, isEnvelope, LEGACY_ITERATIONS } from './crypto.js';
import { hasUserData } from './cloud/sync.js';

const DB_NAME = 'dhenors';
const LS_STATE = 'dhenors:state';
/** Chaves antigas do localStorage que saem junto (o resto são preferências de aparência). */
const LS_OLD = [LS_STATE, 'dhenors:demo', 'dhenors:open-demo', 'dhenors:autolock', 'dhenors:lock-wipe', 'dhenors:lock-fails', 'dhenors:openfinance'];

/** Abre o banco antigo SEM criar um novo (→ null se não existir). */
function openOld() {
  return new Promise((resolve) => {
    if (!globalThis.indexedDB) return resolve(null);
    let created = false;
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = (ev) => {
      // Não existia: desiste (não deixa um banco vazio para trás)
      if (ev.oldVersion === 0) { created = true; req.transaction?.abort(); }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (created || !db.objectStoreNames.contains('kv')) { db.close(); resolve(null); return; }
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function read(db, storeName, fn) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve(undefined);
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

/**
 * O que ficou de versões anteriores neste aparelho (ou null se nada):
 *   { state | envelope, meta (nuvem antiga: linked, userId, dirty), files: [ids], kind: 'pin'|'password' }
 */
export async function readLegacy() {
  let state = null;
  try { const raw = globalThis.localStorage?.getItem(LS_STATE); if (raw) state = JSON.parse(raw); } catch { /* ignora */ }
  const db = await openOld();
  let meta = null;
  let files = [];
  let filesKdf = null; // sal do PIN guardado quando só os anexos ficaram (ver purgeLegacy)
  if (db) {
    state = state || (await read(db, 'kv', (s) => s.get('state'))) || null;
    meta = (await read(db, 'kv', (s) => s.get('cloud:meta'))) || null;
    files = (await read(db, 'files', (s) => s.getAllKeys())) || [];
    filesKdf = (await read(db, 'kv', (s) => s.get('files:kdf'))) || null;
    db.close();
  }
  const envelope = isEnvelope(state) ? state : null;
  // Só o estado inicial vazio, sem anexos: não há o que levar
  if (!files.length && !envelope && !(state && hasUserData(state))) return null;
  return {
    state: envelope ? null : state,
    envelope,
    kind: (envelope || filesKdf)?.kind === 'password' ? 'password' : 'pin',
    // como abrir os anexos cifrados com o PIN/senha antigo
    kdf: envelope ? { salt: envelope.salt, it: envelope.it || LEGACY_ITERATIONS, kind: envelope.kind } : filesKdf,
    meta,
    files: files.map(String),
  };
}

/** Abre o estado antigo cifrado com o PIN/senha → { state, key } (lança erro se errado). */
export async function openLegacy(envelope, secret) {
  const key = await deriveKey(secret, envelope.salt, envelope.it || LEGACY_ITERATIONS);
  try {
    return { state: await decryptJSON(envelope, key), key };
  } catch {
    throw new Error(envelope.kind === 'password' ? 'Senha incorreta.' : 'PIN incorreto.');
  }
}

/** Só a chave do PIN/senha, para os anexos que ficaram (sem o estado antigo). */
export async function openLegacyFiles(kdf, secret, ids) {
  const key = await deriveKey(secret, kdf.salt, kdf.it || LEGACY_ITERATIONS);
  // Confere a chave no primeiro anexo cifrado que houver
  for (const id of ids) {
    try { if (await legacyFile(id, key)) return key; } catch { throw new Error(kdf.kind === 'password' ? 'Senha incorreta.' : 'PIN incorreto.'); }
  }
  return key;
}

/**
 * Um anexo antigo → { name, type, bytes }, ou null se ele não existe mais.
 * Anexo cifrado sem a chave certa LANÇA erro (não pode ser dado como "enviado").
 */
export async function legacyFile(id, pinKey = null) {
  const db = await openOld();
  if (!db) return null;
  const rec = await read(db, 'files', (s) => s.get(id));
  db.close();
  if (!rec) return null;
  let bytes;
  if (rec.enc) {
    if (!pinKey) throw new Error('Falta o PIN/senha antigo para abrir este anexo.');
    bytes = await decryptBytes({ iv: rec.iv, data: rec.data }, pinKey);
  } else {
    bytes = new Uint8Array(await rec.data.arrayBuffer());
  }
  return { name: rec.name, type: rec.type, bytes };
}

/**
 * Apaga TUDO o que versões anteriores guardavam no navegador (dados, anexos e caches).
 * keepFiles: mantém só os anexos que ainda não subiram (tenta de novo no próximo login).
 */
export async function purgeLegacy({ keepFiles = false, kdf = null } = {}) {
  for (const k of LS_OLD) { try { globalThis.localStorage?.removeItem(k); } catch { /* ignora */ } }
  try {
    for (const k of Object.keys(globalThis.localStorage || {})) if (/^dhenors:(cloud:|biometric|errors|state)/.test(k) && k !== 'dhenors:cloud-config') globalThis.localStorage.removeItem(k);
  } catch { /* ignora */ }
  if (keepFiles) {
    const db = await openOld();
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').clear();
        // os anexos que ficaram podem estar cifrados com o PIN: guarda só o sal para abri-los depois
        if (kdf) tx.objectStore('kv').put({ salt: kdf.salt, it: kdf.it, kind: kdf.kind }, 'files:kdf');
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
      db.close();
    }
    await purgeCaches();
    return;
  }
  await new Promise((resolve) => {
    if (!globalThis.indexedDB) return resolve();
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  await purgeCaches();
}

/** Caches do antigo modo offline (service worker) e do "Compartilhar". */
export async function purgeCaches() {
  try {
    if (!globalThis.caches) return;
    for (const k of await caches.keys()) if (k.startsWith('dhenors')) await caches.delete(k);
  } catch { /* ignora */ }
}
