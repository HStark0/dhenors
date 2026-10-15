// =============================================================
// cloud.js — Sincronização com a nuvem (Supabase), sem bibliotecas
// -------------------------------------------------------------
// • O app continua "local primeiro": tudo é salvo no aparelho na
//   hora e funciona offline. A nuvem recebe uma cópia logo depois.
// • Antes de sair do aparelho, os dados são CRIPTOGRAFADOS com a
//   sua frase secreta (AES-GCM, chave PBKDF2). O Supabase só guarda
//   um envelope ilegível.
// • Cada gravação aumenta a `version` da linha. Se outro aparelho
//   salvou antes, o envio é recusado, o app baixa a versão nova e
//   resolve (fica a mais recente; a outra vira cópia de segurança).
//
// API REST usada (documentação pública do Supabase):
//   Auth:  POST /auth/v1/signup · /auth/v1/token?grant_type=password|refresh_token · /auth/v1/logout
//          POST /auth/v1/recover (e-mail de nova senha) · PUT /auth/v1/user (grava a nova senha)
//   Dados: GET/POST/PATCH /rest/v1/dhenors_state
// =============================================================

import { store } from './store.js';
import { getItem, setItem } from './storage.js';
import { deriveKey, encryptJSON, decryptJSON, randomSalt, isEnvelope } from './crypto.js';
import { CLOUD_CONFIG } from '../config.js';
import { mergeStates } from '../domain/merge.js';

const TABLE = 'dhenors_state';
const CONFIG_KEY = 'dhenors:cloud-config';
const PUSH_DELAY = 1500;
const POLL_MS = 60_000;
const IGNORE = new Set(['ui', 'remote', 'external', 'unlock', 'security']);

const listeners = new Set();
let session = null;   // { access_token, refresh_token, expires_at, user: { id, email } }
let key = null;       // CryptoKey (frase secreta)
let meta = { salt: null, version: null, dirty: false, lastSync: null, userId: null, linked: false };
let pushTimer = null;
let busy = Promise.resolve();
let wired = false;

export class CloudError extends Error {}

const device = () => {
  const ua = globalThis.navigator?.userAgent || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Navegador';
  return os;
};

// ---------- Configuração ----------

function readConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { /* ignora */ }
  const url = (saved.url || CLOUD_CONFIG.url || '').trim().replace(/\/+$/, '');
  const anonKey = (saved.anonKey || CLOUD_CONFIG.anonKey || '').trim();
  return { url, anonKey, fromFile: Boolean(CLOUD_CONFIG.url && CLOUD_CONFIG.anonKey && !saved.url) };
}

// ---------- HTTP ----------

async function http(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const { url, anonKey } = readConfig();
  if (!url || !anonKey) throw new CloudError('A nuvem ainda não foi configurada.');
  if (auth) await ensureFreshToken();
  let res;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
        ...(auth && session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch {
    const err = new CloudError('Sem conexão com a nuvem.');
    err.offline = true;
    throw err;
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = json?.msg || json?.error_description || json?.message || json?.error || `Erro ${res.status}`;
    const err = new CloudError(translate(msg));
    err.status = res.status;
    err.code = json?.code || json?.error_code;
    throw err;
  }
  return json;
}

function translate(msg) {
  const m = String(msg);
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme o e-mail (veja sua caixa de entrada) e entre de novo.';
  if (/User already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (/only request this after|security purposes/i.test(m)) return 'Por segurança, espere alguns segundos antes de pedir outro e-mail.';
  if (/Error sending recovery email|Error sending .*email/i.test(m)) return 'O Supabase não conseguiu enviar o e-mail. Confira o limite de envios ou o SMTP no painel do Supabase.';
  if (/should be different from the old password/i.test(m)) return 'A nova senha precisa ser diferente da anterior.';
  if (/relation .* does not exist|Could not find the table/i.test(m)) return 'A tabela da nuvem não existe. Rode o arquivo supabase/schema.sql no Supabase.';
  if (/JWT expired/i.test(m)) return 'Sessão expirada. Entre de novo.';
  if (/Invalid API key/i.test(m)) return 'Chave do Supabase inválida. Confira em Ajustes → Nuvem.';
  return m;
}

// ---------- Sessão ----------

function saveSession(s) {
  session = s ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id || session?.user?.id, email: s.user?.email || session?.user?.email },
  } : null;
  return setItem('cloud:session', session || undefined);
}

let refreshing = null;
async function ensureFreshToken() {
  if (!session) throw new CloudError('Entre na sua conta da nuvem.');
  if (session.expires_at - 60 > Date.now() / 1000) return;
  refreshing ||= (async () => {
    try {
      const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
      await saveSession(s);
    } catch (err) {
      if (!err.offline) { await saveSession(null); setStatus('signedout'); }
      throw err;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// ---------- Estado / eventos ----------

const state = { status: 'off', error: '', lastSync: null };

function setStatus(status, error = '') {
  state.status = status;
  state.error = error;
  state.lastSync = meta.lastSync;
  for (const fn of listeners) { try { fn(state); } catch { /* ignora */ } }
}

const saveMeta = () => setItem('cloud:meta', { ...meta });

// ---------- Linha remota ----------

async function fetchRow() {
  const rows = await http(`/rest/v1/${TABLE}?select=version,data,updated_at,device&user_id=eq.${session.user.id}`);
  return rows?.[0] || null;
}

/** Última versão em comum com a nuvem (base do merge de 3 vias). */
const saveBase = (data) => setItem('cloud:base', structuredClone(data));

async function decryptRow(row) {
  if (!isEnvelope(row.data)) throw new CloudError('Os dados da nuvem não estão no formato do Dhenors.');
  try { return await decryptJSON(row.data, key); } catch { throw new CloudError('Frase secreta incorreta para os dados desta conta.'); }
}

/** Deixa só uma operação de rede por vez. */
const serial = (fn) => { busy = busy.then(fn, fn); return busy; };

// ---------- Enviar / receber ----------

async function push() {
  if (!ready()) return;
  setStatus('syncing');
  const snapshot = structuredClone(store.data);
  const env = await encryptJSON(snapshot, key, meta.salt);
  const now = new Date().toISOString();
  if (meta.version == null) {
    try {
      const rows = await http(`/rest/v1/${TABLE}`, {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: { user_id: session.user.id, data: env, version: 1, device: device(), updated_at: now },
      });
      meta.version = rows?.[0]?.version ?? 1;
    } catch (err) {
      if (err.status === 409 || err.code === '23505') return pull(); // já existe: baixa e resolve
      throw err;
    }
  } else {
    const rows = await http(`/rest/v1/${TABLE}?user_id=eq.${session.user.id}&version=eq.${meta.version}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: { data: env, version: meta.version + 1, device: device(), updated_at: now },
    });
    if (!rows?.length) return pull(); // outro aparelho salvou antes
    meta.version = rows[0].version;
  }
  meta.dirty = false;
  meta.lastSync = Date.now();
  await saveBase(snapshot);
  await saveMeta();
  setStatus('idle');
}

/**
 * Baixa a versão da nuvem, se for mais nova.
 * Com mudanças locais ainda não enviadas, fica a versão salva por último
 * (data de alteração) e a outra é guardada como cópia de segurança.
 */
async function pull() {
  if (!ready()) return;
  setStatus('syncing');
  const row = await fetchRow();
  if (!row) {
    meta.version = null;
    await saveMeta();
    return push();
  }
  if (row.version === meta.version) {
    if (meta.dirty) return push();
    meta.lastSync = Date.now();
    await saveMeta();
    return setStatus('idle');
  }
  const remote = await decryptRow(row);
  if (meta.dirty) {
    // Mudanças dos dois lados: junta item a item usando a última versão em comum
    const base = await getItem('cloud:base');
    if (base) {
      const merged = mergeStates(base, store.data, remote);
      await saveBase(remote);
      await store.applyRemote(merged);
      meta.version = row.version;
      return push(); // envia o resultado juntado
    }
    const localTime = Date.parse(store.data.updatedAt || 0) || 0;
    const remoteTime = Date.parse(remote.updatedAt || row.updated_at || 0) || 0;
    if (localTime > remoteTime) {
      keepBackup(remote, 'nuvem');
      meta.version = row.version;
      return push(); // as mudanças deste aparelho ganham
    }
    keepBackup(store.data, 'este aparelho');
    notify(`Havia mudanças em dois aparelhos ao mesmo tempo. Ficou a mais recente (${row.device || 'outro aparelho'}); a outra foi guardada em Ajustes → Nuvem.`);
  }
  await store.applyRemote(remote);
  meta.version = row.version;
  meta.dirty = false;
  meta.lastSync = Date.now();
  await saveBase(remote);
  await saveMeta();
  setStatus('idle');
}

function keepBackup(data, origin) {
  setItem('cloud:conflict', { at: Date.now(), origin, data });
}

function notify(text) {
  globalThis.document?.dispatchEvent(new CustomEvent('dhenors:cloud-notice', { detail: text }));
}

const ready = () => Boolean(session && key && meta.linked && readConfig().url);

function run(fn) {
  return serial(async () => {
    try { await fn(); } catch (err) {
      if (err.offline) setStatus('offline', err.message);
      else setStatus(session ? 'error' : 'signedout', err.message);
    }
  });
}

function schedulePush() {
  meta.dirty = true;
  saveMeta();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run(push), PUSH_DELAY);
}

// ---------- API pública ----------

export const cloud = {
  get state() { return { ...state }; },
  get user() { return session?.user || null; },
  get linked() { return ready(); },
  get hasKey() { return Boolean(key); },
  get config() { return readConfig(); },
  get configured() { const c = readConfig(); return Boolean(c.url && c.anonKey); },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setConfig({ url, anonKey }) {
    const clean = { url: String(url || '').trim().replace(/\/+$/, ''), anonKey: String(anonKey || '').trim() };
    if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(clean.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean.url)) throw new CloudError('URL inválida. Exemplo: https://abcdefgh.supabase.co');
    if (clean.anonKey.length < 20) throw new CloudError('Chave inválida. Copie a chave "anon"/"publishable" inteira.');
    localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
    setStatus(session ? state.status : 'signedout');
  },

  /** Carrega sessão/chave salvas e começa a sincronizar. */
  async init() {
    session = (await getItem('cloud:session')) || null;
    key = (await getItem('cloud:key')) || null;
    meta = { ...meta, ...((await getItem('cloud:meta')) || {}) };
    if (!this.configured) return setStatus('off');
    if (!session) return setStatus('signedout');
    if (!key || !meta.linked) return setStatus('locked');

    if (!wired) {
      wired = true;
      store.subscribe((reason) => { if (!IGNORE.has(reason) && ready()) schedulePush(); });
      const sync = () => { if (ready() && document.visibilityState === 'visible') run(() => pull()); };
      document.addEventListener('visibilitychange', sync);
      addEventListener('online', sync);
      addEventListener('focus', sync);
      setInterval(sync, POLL_MS);
      // tenta enviar antes de fechar
      addEventListener('pagehide', () => { if (ready() && meta.dirty) run(push); });
    }
    setStatus('idle');
    return run(() => pull());
  },

  async signIn(email, password) {
    const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
    await saveSession(s);
    if (meta.userId && meta.userId !== s.user?.id) { // outra conta: começa do zero
      key = null; meta = { salt: null, version: null, dirty: false, lastSync: null, userId: null, linked: false };
      await setItem('cloud:key', undefined);
    }
    meta.userId = s.user?.id;
    await saveMeta();
    setStatus('locked');
  },

  /** → { needsConfirm } */
  async signUp(email, password) {
    const back = encodeURIComponent(`${location.origin}${location.pathname}`);
    const s = await http(`/auth/v1/signup?redirect_to=${back}`, { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
    if (!s?.access_token) return { needsConfirm: true };
    await saveSession(s);
    meta.userId = s.user?.id;
    await saveMeta();
    setStatus('locked');
    return { needsConfirm: false };
  },

  /**
   * "Esqueci minha senha": o Supabase envia um e-mail com um link que
   * volta para o app (#access_token=…&type=recovery). Por segurança, a
   * resposta é a mesma exista ou não uma conta com esse e-mail.
   */
  async requestPasswordReset(email) {
    const back = encodeURIComponent(`${location.origin}${location.pathname}`);
    await http(`/auth/v1/recover?redirect_to=${back}`, { method: 'POST', auth: false, body: { email: String(email).trim() } });
  },

  /**
   * Conclui a recuperação: troca a senha usando o acesso temporário que
   * veio no link e, se der certo, entra na conta com ele.
   * recovery = { access_token, refresh_token, expires_in }
   * A FRASE SECRETA não muda (e não tem como ser recuperada).
   */
  async completePasswordReset(recovery, newPassword) {
    const auth = { Authorization: `Bearer ${recovery.access_token}` };
    let user;
    try {
      user = await http('/auth/v1/user', { method: 'PUT', auth: false, headers: auth, body: { password: newPassword } });
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw new CloudError('O link de recuperação expirou ou já foi usado. Peça outro em "Esqueci minha senha".');
      throw err;
    }
    await saveSession({ ...recovery, expires_in: Number(recovery.expires_in) || 3600, user });
    if (meta.userId && meta.userId !== user?.id) { // outra conta: começa do zero
      key = null; meta = { salt: null, version: null, dirty: false, lastSync: null, userId: null, linked: false };
      await setItem('cloud:key', undefined);
    }
    meta.userId = user?.id;
    await saveMeta();
    await this.init();
  },

  /** Há dados desta conta na nuvem? → { exists, updatedAt, device } */
  async remoteInfo() {
    const row = await fetchRow();
    return row ? { exists: true, updatedAt: row.updated_at, device: row.device, salt: row.data?.salt } : { exists: false };
  },

  /**
   * Define (1º aparelho) ou confere (outros aparelhos) a frase secreta.
   * → { remote: dadosDaNuvem | null }
   */
  async unlock(passphrase) {
    if (String(passphrase).length < 8) throw new CloudError('A frase secreta precisa ter pelo menos 8 caracteres.');
    const row = await fetchRow();
    const salt = row?.data?.salt || meta.salt || randomSalt();
    const k = await deriveKey(passphrase, salt, 310_000);
    let remote = null;
    if (row) {
      try { remote = await decryptJSON(row.data, k); } catch { throw new CloudError('Frase secreta incorreta. É a mesma que você criou no primeiro aparelho.'); }
    }
    key = k;
    meta.salt = salt;
    await setItem('cloud:key', k);
    await saveMeta();
    return { remote, version: row?.version ?? null };
  },

  /**
   * Liga este aparelho à conta.
   * choice: 'cloud' (usa os dados da nuvem) | 'local' (envia os deste aparelho)
   */
  async link(choice, remote, version) {
    meta.linked = true;
    if (choice === 'cloud' && remote) {
      await store.applyRemote(remote);
      await saveBase(remote);
      meta.version = version;
      meta.dirty = false;
      meta.lastSync = Date.now();
    } else {
      meta.version = version; // sobrescreve a versão atual da nuvem
      meta.dirty = true;
    }
    await saveMeta();
    await this.init();
  },

  syncNow() { return run(() => (meta.dirty ? push() : pull())); },

  async signOut() {
    clearTimeout(pushTimer);
    try { if (session) await http('/auth/v1/logout', { method: 'POST' }); } catch { /* ignora */ }
    await saveSession(null);
    key = null;
    meta = { salt: null, version: null, dirty: false, lastSync: null, userId: null, linked: false };
    await setItem('cloud:key', undefined);
    await setItem('cloud:base', undefined);
    await saveMeta();
    setStatus(this.configured ? 'signedout' : 'off');
  },

  async conflictBackup() { return getItem('cloud:conflict'); },
  async clearConflict() { return setItem('cloud:conflict', undefined); },
};
