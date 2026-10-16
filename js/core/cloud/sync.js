// =============================================================
// cloud/sync.js — Envelopes da nuvem e regras puras da sincronização
// -------------------------------------------------------------
// • Cada parte vai cifrada com AAD "usuário|nome|rev" e o índice com
//   "usuário|manifest|versão": um envelope válido não pode ser trocado
//   de lugar (outra parte, outra conta, versão antiga) sem dar erro.
// • Depois de abrir uma parte, o app confere o hash que está no índice.
// • Envelopes antigos (sem AAD, sem `a: 1`) ainda abrem; as partes
//   antigas são recifradas com AAD no próximo envio.
// Funções sem rede: testadas em tests/cloud-persistence.test.mjs.
// =============================================================

import { encryptJSON, decryptJSON, isEnvelope } from '../crypto.js';
import { hashChunks } from '../../domain/chunks.js';
import { SCHEMA_VERSION } from '../../domain/schema.js';
import { CloudError } from './http.js';

export const partAAD = (userId, name, rev) => `${userId}|${name}|${rev}`;
export const manifestAAD = (userId, version) => `${userId}|manifest|${version}`;

/** Cifra uma parte do estado, amarrada a usuário, nome e rev. */
export function sealPart(value, key, { salt, it, userId, name, rev }) {
  return encryptJSON(value, key, salt, { it }, { aad: partAAD(userId, name, rev) });
}

/** Cifra o índice, amarrado a usuário e à versão em que será gravado. */
export function sealManifest(man, key, { salt, it, userId, version }) {
  return encryptJSON({ ...man, version }, key, salt, { it }, { aad: manifestAAD(userId, version) });
}

/**
 * Abre o índice (ou o estado inteiro, formato antigo).
 * Erro aqui quase sempre é frase errada → err.badKey.
 */
export async function openManifest(env, key, { userId, version }) {
  if (!isEnvelope(env)) throw new CloudError('Os dados da nuvem não estão no formato do Dhenors.');
  let value;
  try { value = await decryptJSON(env, key, { aad: manifestAAD(userId, version) }); } catch {
    const err = new CloudError('A frase secreta não abre os dados da nuvem. Ela foi trocada em outro aparelho? Digite a frase nova.');
    err.badKey = true;
    throw err;
  }
  // Índice novo diz em que versão foi gravado: não aceita um índice velho com número novo
  if (value?.version != null && version != null && value.version !== version) throw integrityError();
  return value;
}

/**
 * Abre uma parte e confere o hash do índice.
 * → { value, legacy } (legacy = sem AAD: será recifrada no próximo envio)
 */
export async function openPart(env, key, { userId, name, rev, hash }) {
  if (!isEnvelope(env)) throw integrityError();
  let value;
  try { value = await decryptJSON(env, key, { aad: partAAD(userId, name, rev) }); } catch { throw integrityError(); }
  if (hash) {
    const got = (await hashChunks({ [name]: value }))[name];
    if (got !== hash) throw integrityError();
  }
  return { value, legacy: !env.a };
}

function integrityError() {
  const err = new CloudError('Os dados da nuvem não conferem (alterados ou corrompidos). Nada foi aplicado neste aparelho; tente sincronizar de novo ou restaure uma versão.');
  err.integrity = true;
  return err;
}

/** Recusa voltar no tempo: a nuvem não pode devolver uma versão mais velha que a já conhecida. */
export function assertNotRollback(knownVersion, remoteVersion) {
  if (knownVersion != null && remoteVersion != null && remoteVersion < knownVersion) {
    const err = new CloudError('A nuvem devolveu uma versão mais antiga do que a que este aparelho já tinha. Por segurança, nada foi aplicado.');
    err.integrity = true;
    throw err;
  }
}

/** Dados de uma versão MAIS NOVA do app: não aplica nem envia. */
export function assertSchema(state) {
  if (state && Number(state.schema) > SCHEMA_VERSION) {
    const err = new CloudError('Atualize o app para sincronizar: os dados da nuvem foram salvos por uma versão mais nova do Dhenors.');
    err.tooNew = true;
    throw err;
  }
}

/**
 * Fim de um envio: só zera "pendente" se nada mudou DURANTE o envio.
 * `gen` = meta.pending no começo do envio. → true se ficou tudo enviado.
 */
export function settlePending(meta, gen) {
  if ((meta.pending || 0) === gen) {
    meta.dirty = false;
    meta.pending = 0;
    return true;
  }
  meta.dirty = true;
  meta.pending = Math.max(1, (meta.pending || 0) - gen);
  return false;
}

// ---------- Dados do aparelho ----------

const SKIP_TOP = new Set(['schema', 'createdAt', 'updatedAt', 'lastBackupAt', 'onboarded', 'settings', 'categories']);
const SETTINGS_LISTS = ['salaryHistory', 'payrollLoans', 'payrollVariable', 'vacations', 'absences', 'benefits', 'jobs', 'rules', 'envelopes', 'scenarios'];

/**
 * Quantos itens a pessoa cadastrou (todas as coleções, não só contas):
 * cartões, contas bancárias, investimentos, plantões, salário…
 * Categorias padrão não contam.
 */
export function countItems(state) {
  if (!state || typeof state !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(state)) {
    if (SKIP_TOP.has(k)) continue;
    if (Array.isArray(v)) n += v.length;
    else if (v && typeof v === 'object') n += Object.keys(v).length;
  }
  for (const k of SETTINGS_LISTS) if (Array.isArray(state.settings?.[k])) n += state.settings[k].length;
  return n;
}

export const hasUserData = (state) => countItems(state) > 0;

// ---------- Cópias completas guardadas em conflitos ----------

export const KEEP_CONFLICT_COPIES = 3;

/** Valor salvo → lista (aceita o formato antigo: uma cópia só). */
export const conflictCopies = (saved) => (Array.isArray(saved) ? saved : saved?.data ? [saved] : []);

/** Junta uma cópia nova e mantém só as últimas N (mais nova primeiro). */
export function addConflictCopy(saved, copy, max = KEEP_CONFLICT_COPIES) {
  return [copy, ...conflictCopies(saved)].sort((a, b) => b.at - a.at).slice(0, max);
}
