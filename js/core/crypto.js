// @ts-check
// =============================================================
// crypto.js — Criptografia dos dados (Web Crypto, nativo)
// -------------------------------------------------------------
// • Chave: PBKDF2-SHA256 a partir do PIN/senha + sal aleatório.
//   600 mil iterações (recomendação OWASP 2023). Envelopes antigos
//   (250 mil) continuam abrindo e são regravados no desbloqueio.
//   O número de iterações vai junto no envelope (`it`).
// • Cifra: AES-GCM 256 bits (confidencialidade + integridade).
// • Sem o PIN, os dados salvos no navegador são ilegíveis.
//   ATENÇÃO: não existe "recuperar PIN". Esqueceu = só restaurando
//   um backup. Por isso o app insiste no backup.
// • Um PIN de 4 a 6 números tem poucas combinações: quem copiar o
//   banco do navegador pode testar todas. Para proteção de verdade,
//   use uma SENHA com letras e números (Ajustes → Segurança).
// =============================================================

export const LEGACY_ITERATIONS = 250_000;
/** Frase secreta da nuvem em contas antigas (antes do `it` no envelope). */
export const LEGACY_PASS_ITERATIONS = 310_000;
export const PIN_KDF = { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 };

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toB64 = (buf) => {
  // Em blocos: o spread de um array grande estoura a pilha
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const randomSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

/**
 * Deriva a chave AES a partir do segredo.
 * `extractable` = true só quando a chave precisa ser guardada cifrada
 * (ex.: chave da nuvem protegida pelo PIN ou pela biometria).
 */
export async function deriveKey(secret, saltB64, iterations = PIN_KDF.iterations, { extractable = false } = {}) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/** Chave AES a partir de bytes crus (ex.: guardados cifrados). */
export function importRawKey(bytes, extractable = false) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

export async function exportRawKey(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/**
 * Objeto → envelope { enc: 1, salt, iv, data, ...extra } (base64).
 * `aad` (opcional): texto "amarrado" ao envelope sem ir junto (ex.:
 * "usuário|parte|rev"). Quem abrir precisa informar o MESMO texto —
 * assim um envelope não pode ser trocado de lugar por outro válido.
 * Envelopes com AAD levam `a: 1`.
 * @param {{ aad?: string }} [opts]
 */
export async function encryptJSON(obj, key, salt, extra = {}, opts = {}) {
  const { aad } = opts;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = aad == null ? { name: 'AES-GCM', iv } : { name: 'AES-GCM', iv, additionalData: enc.encode(String(aad)) };
  const data = await crypto.subtle.encrypt(params, key, enc.encode(JSON.stringify(obj)));
  return { enc: 1, salt, iv: toB64(iv), data: toB64(data), ...extra, ...(aad == null ? {} : { a: 1 }) };
}

/**
 * Envelope → objeto. Lança erro se o PIN (chave) estiver errado, se o
 * conteúdo foi adulterado ou se o `aad` não for o usado ao cifrar.
 * Envelope sem `a` (formato antigo) abre sem AAD.
 * @param {{ aad?: string }} [opts]
 */
export async function decryptJSON(envelope, key, opts = {}) {
  const { aad } = opts;
  if (envelope.a && aad == null) throw new Error('Envelope amarrado: falta o contexto (AAD).');
  const params = envelope.a
    ? { name: 'AES-GCM', iv: fromB64(envelope.iv), additionalData: enc.encode(String(aad)) }
    : { name: 'AES-GCM', iv: fromB64(envelope.iv) };
  const plain = await crypto.subtle.decrypt(params, key, fromB64(envelope.data));
  return JSON.parse(dec.decode(plain));
}

/** Bytes → { iv, data } cifrados (anexos, chaves). */
export async function encryptBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, data };
}

export async function decryptBytes({ iv, data }, key) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
}

export const isEnvelope = (v) => Boolean(v && v.enc === 1 && v.iv && v.data && v.salt);

// ---------- Backup com senha ----------

/**
 * Cifra um texto (o JSON do backup) com uma senha.
 * → { app: 'Dhenors', format: 'dhenors-backup-enc', v: 1, kdf, salt, iv, data }
 */
export async function encryptWithPassword(text, password) {
  const salt = randomSalt();
  const key = await deriveKey(password, salt, PIN_KDF.iterations);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { app: 'Dhenors', format: 'dhenors-backup-enc', v: 1, kdf: { name: 'PBKDF2-SHA256', iterations: PIN_KDF.iterations }, salt, iv: toB64(iv), data: toB64(data) };
}

export async function decryptWithPassword(file, password) {
  const key = await deriveKey(password, file.salt, file.kdf?.iterations || PIN_KDF.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data));
    return dec.decode(plain);
  } catch {
    throw new Error('Senha do backup incorreta.');
  }
}

export const isEncryptedBackup = (v) => Boolean(v && v.format === 'dhenors-backup-enc' && v.salt && v.iv && v.data);

/** Força de uma senha (0–4) e dica, sem bibliotecas. */
export function passwordStrength(pw) {
  const s = String(pw || '');
  let classes = 0;
  if (/[a-z]/.test(s)) classes++;
  if (/[A-Z]/.test(s)) classes++;
  if (/\d/.test(s)) classes++;
  if (/[^a-zA-Z0-9]/.test(s)) classes++;
  const pool = [26, 26, 10, 33].slice(0, classes).reduce((a, n) => a + n, 0) || 10;
  const bits = s.length * Math.log2(pool);
  const score = bits >= 70 ? 4 : bits >= 55 ? 3 : bits >= 40 ? 2 : bits >= 28 ? 1 : 0;
  const label = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'][score];
  return { score, bits: Math.round(bits), label };
}
