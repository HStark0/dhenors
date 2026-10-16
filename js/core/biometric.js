// =============================================================
// biometric.js — Desbloquear com digital ou Face ID (WebAuthn + PRF)
// -------------------------------------------------------------
// Como funciona (nada da biometria sai do aparelho):
//  1. Com o app aberto pelo PIN, criamos uma "chave de acesso"
//     (passkey) presa a este aparelho, pedindo a extensão PRF.
//  2. A PRF devolve 32 bytes secretos que só saem quando a digital/
//     rosto é confirmada. Deles derivamos (HKDF) uma chave AES que
//     CIFRA a chave do PIN. Guardamos só o resultado cifrado.
//  3. Para abrir: a digital libera os 32 bytes → decifra a chave do
//     PIN → abre os dados. O PIN continua funcionando sempre.
// Requer navegador com PRF (Chrome/Edge recentes, Safari 18+ no
// iPhone/Mac, Android com Google Password Manager).
// =============================================================

import { getItem, setItem } from './storage.js';
import { store } from './store.js';
import { exportRawKey, importRawKey, encryptBytes, decryptBytes, toB64, fromB64 } from './crypto.js';

const META = 'biometric:meta';
const RP_NAME = 'Dhenors';
const enc = new TextEncoder();

export const biometricSupported = () => Boolean(globalThis.PublicKeyCredential && navigator.credentials?.create);

export async function biometricAvailable() {
  if (!biometricSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

/** Está ligado neste aparelho? */
export const biometricEnabled = async () => Boolean(await getItem(META));

async function aesFromPrf(prfBytes, saltB64) {
  const base = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: fromB64(saltB64), info: enc.encode('dhenors-biometric-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Liga a biometria (o app precisa estar aberto com o PIN). */
export async function enableBiometric() {
  const pinKey = store.currentKey;
  if (!pinKey) throw new Error('Ative o PIN antes: a biometria é um atalho para ele.');
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: RP_NAME, id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'dhenors', displayName: store.data?.settings.profileName || 'Dhenors' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const ext = cred.getClientExtensionResults?.() || {};
  if (!ext.prf?.enabled && !ext.prf?.results) throw new Error('Este aparelho/navegador não oferece a proteção necessária (PRF) para guardar a chave com segurança.');
  // Alguns autenticadores só devolvem o segredo no "get": pede uma vez agora
  const secret = ext.prf?.results?.first || await assertPrf(cred.rawId, prfSalt);
  const hkdfSalt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const aes = await aesFromPrf(new Uint8Array(secret), hkdfSalt);
  const raw = await exportRawKey(pinKey);
  const { iv, data } = await encryptBytes(raw, aes);
  await setItem(META, {
    credId: toB64(new Uint8Array(cred.rawId)), prfSalt: toB64(prfSalt), hkdfSalt,
    iv: toB64(iv), data: toB64(data), salt: store.currentSalt, iterations: store.kdfIterations, createdAt: new Date().toISOString(),
  });
}

async function assertPrf(credId, prfSalt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const secret = a.getClientExtensionResults?.().prf?.results?.first;
  if (!secret) throw new Error('A biometria não liberou a chave.');
  return secret;
}

/** Abre os dados com a digital/rosto. */
export async function unlockWithBiometric() {
  const meta = await getItem(META);
  if (!meta) throw new Error('Biometria não configurada neste aparelho.');
  if (store.envelope && meta.salt && store.envelope.salt !== meta.salt) {
    await setItem(META, undefined);
    throw new Error('O PIN foi trocado: entre com o PIN e ligue a biometria de novo.');
  }
  const secret = await assertPrf(fromB64(meta.credId), fromB64(meta.prfSalt));
  const aes = await aesFromPrf(new Uint8Array(secret), meta.hkdfSalt);
  let raw;
  try { raw = await decryptBytes({ iv: fromB64(meta.iv), data: fromB64(meta.data) }, aes); } catch { throw new Error('Não foi possível abrir com a biometria. Use o PIN.'); }
  const key = await importRawKey(raw, true);
  await store.unlockWithKey(key, meta);
}

export const disableBiometric = () => setItem(META, undefined);

// Trocar ou remover o PIN invalida a chave guardada
store.onRekey(async () => { await setItem(META, undefined); });
