// =============================================================
// crypto.js — Criptografia dos dados com PIN (Web Crypto, nativo)
// -------------------------------------------------------------
// • Chave: PBKDF2 (SHA-256, 250 mil iterações) a partir do PIN + sal.
// • Cifra: AES-GCM 256 bits (confidencialidade + integridade).
// • Sem o PIN, os dados salvos no navegador são ilegíveis.
//   ATENÇÃO: não existe "recuperar PIN". Esqueceu = só restaurando
//   um backup. Por isso o app insiste no backup.
// =============================================================

const ITERATIONS = 250_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => {
  // Em blocos: o spread de um array grande estoura a pilha
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const randomSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(pin, saltB64, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Objeto → envelope { enc: 1, salt, iv, data } (base64). */
export async function encryptJSON(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { enc: 1, salt, iv: toB64(iv), data: toB64(data) };
}

/** Envelope → objeto. Lança erro se o PIN (chave) estiver errado. */
export async function decryptJSON(envelope, key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
  return JSON.parse(dec.decode(plain));
}

export const isEnvelope = (v) => Boolean(v && v.enc === 1 && v.iv && v.data && v.salt);
