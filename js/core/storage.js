// =============================================================
// storage.js — O que fica no navegador: SÓ o acesso à conta
// -------------------------------------------------------------
// Nenhum dado financeiro é guardado no aparelho. Os dados vivem na
// nuvem (criptografados) e, com o app aberto, só na memória.
// Aqui fica apenas o "lembrar o login", conforme a escolha feita ao
// entrar:
//   • 'always' / '30d' → localStorage (continua depois de fechar)
//   • 'session'        → sessionStorage (some ao fechar o app)
// Conteúdo: { session, key, salt, it, userId, remember, until }
//   session  tokens do Supabase (e-mail e id do usuário)
//   key      chave AES derivada da frase secreta (base64), nunca a frase
// Preferências de aparência e o id do aparelho ficam em core/theme.js
// e core/cloud/devices.js (não são dados financeiros). Com "Sempre" ou
// "30 dias", a chave fica no IndexedDB "dhenors-auth" como CryptoKey não
// exportável (saveKey/loadKey, abaixo) — o campo `key` do JSON fica vazio.
// =============================================================

const AUTH_KEY = 'dhenors:auth';

const stores = () => [globalThis.sessionStorage, globalThis.localStorage].filter(Boolean);

/** Acesso salvo (ou null). Vencido ("30 dias") volta null e é apagado. */
export function readAuth(now = Date.now()) {
  for (const s of stores()) {
    try {
      const raw = s.getItem(AUTH_KEY);
      if (!raw) continue;
      const auth = JSON.parse(raw);
      if (auth?.until && now > auth.until) { clearAuth(); return null; }
      return auth;
    } catch { /* sem acesso ou valor inválido */ }
  }
  return null;
}

/** Grava o acesso no lugar certo para a escolha "lembrar" (e tira do outro). */
export function writeAuth(auth) {
  clearAuth();
  if (!auth) return;
  const target = auth.remember === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  try { target?.setItem(AUTH_KEY, JSON.stringify(auth)); } catch { /* armazenamento bloqueado: vale só enquanto aberto */ }
}

export function clearAuth() {
  for (const s of stores()) { try { s.removeItem(AUTH_KEY); } catch { /* sem acesso */ } }
}

// ---------- Chave da frase ("Sempre" / "30 dias") ----------
// Vai como CryptoKey NÃO exportável para o IndexedDB "dhenors-auth": o app
// usa a chave, mas nenhum script (nem quem copiar o perfil do navegador e
// abrir o arquivo) consegue ler os bytes dela. Nada além disso fica aqui.

const KEY_DB = 'dhenors-auth';

function keyDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('bloqueado'));
  });
}

async function keyOp(mode, fn) {
  const db = await keyDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Grava (ou apaga, com null) a chave lembrada. */
export async function saveKey(cryptoKey) {
  try {
    await keyOp('readwrite', (s) => (cryptoKey ? s.put(cryptoKey, 'phrase') : s.delete('phrase')));
  } catch { /* sem IndexedDB: a chave fica só na memória (pede a frase ao reabrir) */ }
}

/** A chave lembrada (ou null). */
export async function loadKey() {
  try { return (await keyOp('readonly', (s) => s.get('phrase'))) || null; } catch { return null; }
}
