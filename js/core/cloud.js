// =============================================================
// cloud.js — Sincronização com a nuvem (Supabase), sem bibliotecas
// -------------------------------------------------------------
// • O app continua "local primeiro": tudo é salvo no aparelho na
//   hora e funciona offline. A nuvem recebe uma cópia logo depois.
// • Antes de sair do aparelho, os dados são CRIPTOGRAFADOS com a
//   sua frase secreta (AES-GCM, chave PBKDF2). O Supabase só guarda
//   envelopes ilegíveis.
// • Formato: o estado é dividido em PARTES (domain/chunks.js).
//   Cada parte vai cifrada para `dhenors_chunks` com um id único
//   (rev). A linha de `dhenors_state` guarda o ÍNDICE cifrado
//   (qual rev vale para cada parte) e a `version`. Um envio:
//     1. sobe só as partes que mudaram;
//     2. troca o índice com "version = a que eu conhecia" (atômico).
//   Se outro aparelho salvou antes, o passo 2 é recusado, o app baixa
//   a versão nova, junta item a item (domain/merge.js) e tenta de novo.
//   Conflitos (mesmo item alterado nos dois) ficam guardados para
//   você escolher — nada some sem aviso.
// • Histórico: cada índice enviado vira uma versão em
//   `dhenors_versions` (as últimas 30), que pode ser restaurada.
// • Tempo real: um WebSocket avisa quando outro aparelho salva
//   (core/realtime.js); a consulta periódica fica como reserva.
// • Aparelhos: cada aparelho se registra em `dhenors_devices`; dá para
//   ver a lista e desconectar um aparelho remotamente.
//
// API REST usada (documentação pública do Supabase):
//   Auth:  POST /auth/v1/signup · /auth/v1/token?grant_type=password|refresh_token · /auth/v1/logout
//          POST /auth/v1/recover (e-mail de nova senha) · PUT /auth/v1/user (grava a nova senha)
//   Dados: /rest/v1/dhenors_state · dhenors_chunks · dhenors_versions · dhenors_devices
// =============================================================

import { store } from './store.js';
import { getItem, setItem } from './storage.js';
import { deriveKey, encryptJSON, decryptJSON, randomSalt, isEnvelope, exportRawKey, importRawKey, toB64, fromB64, PIN_KDF } from './crypto.js';
import { CLOUD_CONFIG } from '../config.js';
import { APP_VERSION } from '../version.js';
import { mergeWithConflicts, setAtPath } from '../domain/merge.js';
import { splitChunks, joinChunks, hashChunks, diffChunks, isManifest, chunkSize } from '../domain/chunks.js';
import { RealtimeClient } from './realtime.js';

const T = { state: 'dhenors_state', chunks: 'dhenors_chunks', versions: 'dhenors_versions', devices: 'dhenors_devices' };
const CONFIG_KEY = 'dhenors:cloud-config';
const DEVICE_KEY = 'dhenors:device-id';
const PUSH_DELAY = 1500;
const POLL_MS = 60_000;          // sem tempo real
const POLL_LIVE_MS = 5 * 60_000; // com tempo real (só reserva)
const LEGACY_PASS_ITERATIONS = 310_000;
const KEEP_VERSIONS = 30;
const MAX_CHUNK = 4.5 * 1024 * 1024;
const PAUSE_DAYS = 7;            // projeto gratuito do Supabase pausa após 7 dias sem uso
const IGNORE = new Set(['ui', 'remote', 'external', 'unlock', 'security', 'silent']);

const listeners = new Set();
let session = null;   // { access_token, refresh_token, expires_at, user: { id, email } }
let key = null;       // CryptoKey (frase secreta)
const EMPTY_META = { salt: null, iterations: null, version: null, dirty: false, pending: 0, lastSync: null, lastContact: null, userId: null, linked: false, remember: 'always', rememberUntil: null, pushes: 0, deviceCheck: 0 };
let meta = { ...EMPTY_META };
let manifest = null;  // índice da última versão em comum { chunks: { nome: { rev, hash } } }
let pushTimer = null;
let busy = Promise.resolve();
let wired = false;
let realtime = null;
let pollTimer = 0;

export class CloudError extends Error {}

const device = () => {
  const ua = globalThis.navigator?.userAgent || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Navegador';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
};

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return 'sem-id'; }
}

const randomRev = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20);

// ---------- Configuração ----------

function readConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { /* ignora */ }
  const url = (saved.url || CLOUD_CONFIG.url || '').trim().replace(/\/+$/, '');
  const anonKey = (saved.anonKey || CLOUD_CONFIG.anonKey || '').trim();
  return { url, anonKey, fromFile: Boolean(CLOUD_CONFIG.url && CLOUD_CONFIG.anonKey && !saved.url), vapidKey: CLOUD_CONFIG.vapidPublicKey || '' };
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
    const err = new CloudError(globalThis.navigator?.onLine === false ? 'Sem conexão com a nuvem.' : 'Não foi possível falar com o Supabase. Se o projeto estiver pausado, abra o painel do Supabase e clique em "Restore".');
    err.offline = true;
    throw err;
  }
  meta.lastContact = Date.now();
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = json?.msg || json?.error_description || json?.message || json?.error || `Erro ${res.status}`;
    const err = new CloudError(translate(msg, res.status));
    err.status = res.status;
    err.code = json?.code || json?.error_code;
    err.paused = res.status === 540 || /paused|inactive/i.test(String(msg));
    throw err;
  }
  return json;
}

function translate(msg, status) {
  const m = String(msg);
  if (status === 540 || /project.*paused|paused/i.test(m)) return 'O projeto do Supabase está pausado por falta de uso. Abra supabase.com → seu projeto → "Restore project" (os dados continuam lá).';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme o e-mail (veja sua caixa de entrada) e entre de novo.';
  if (/User already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (/only request this after|security purposes/i.test(m)) return 'Por segurança, espere alguns segundos antes de pedir outro e-mail.';
  if (/Error sending recovery email|Error sending .*email/i.test(m)) return 'O Supabase não conseguiu enviar o e-mail. Confira o limite de envios ou o SMTP no painel do Supabase.';
  if (/should be different from the old password/i.test(m)) return 'A nova senha precisa ser diferente da anterior.';
  if (/relation .* does not exist|Could not find the table/i.test(m)) return 'Faltam tabelas na nuvem. Rode de novo o arquivo supabase/schema.sql no SQL Editor do Supabase (veja docs/NUVEM.md).';
  if (/JWT expired/i.test(m)) return 'Sessão expirada. Entre de novo.';
  if (/Invalid API key/i.test(m)) return 'Chave do Supabase inválida. Confira em Ajustes → Nuvem.';
  if (/dhenors_chunks_size|dhenors_state_size/i.test(m)) return 'Uma parte dos dados passou do limite de 5 MB da nuvem.';
  return m;
}

// ---------- Sessão (cifrada com o PIN, se houver) ----------

function saveSession(s) {
  session = s ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id || session?.user?.id, email: s.user?.email || session?.user?.email },
  } : null;
  return store.setSecure('cloud:session', session || undefined);
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

const state = { status: 'off', error: '', lastSync: null, pending: 0, live: false, conflicts: 0, paused: false };

function setStatus(status, error = '') {
  state.status = status;
  state.error = error;
  state.lastSync = meta.lastSync;
  state.pending = meta.pending || 0;
  state.live = Boolean(realtime?.live);
  state.paused = status === 'paused';
  for (const fn of listeners) { try { fn(state); } catch { /* ignora */ } }
}

const saveMeta = () => setItem('cloud:meta', { ...meta });

// ---------- Chave da frase secreta ("lembrar neste aparelho") ----------
// remember: 'session' (só enquanto o app estiver aberto) | '30d' | 'always'
//  • com PIN: a chave vai cifrada pelo PIN ('cloud:keyraw')
//  • sem PIN: a chave fica como CryptoKey no IndexedDB ('cloud:key')

async function persistKey() {
  await setItem('cloud:key', undefined);
  await store.setSecure('cloud:keyraw', undefined);
  if (!key || meta.remember === 'session') return;
  if (store.pinEnabled) {
    try { await store.setSecure('cloud:keyraw', toB64(await exportRawKey(key))); return; } catch { /* chave antiga não exportável */ }
  }
  await setItem('cloud:key', key);
}

async function loadKey() {
  if (meta.rememberUntil && Date.now() > meta.rememberUntil) {
    await setItem('cloud:key', undefined);
    await store.setSecure('cloud:keyraw', undefined);
    meta.rememberUntil = null;
    return null;
  }
  const raw = await store.getSecure('cloud:keyraw');
  if (raw) { try { return await importRawKey(fromB64(raw), true); } catch { /* corrompido */ } }
  return (await getItem('cloud:key')) || null;
}

// ---------- Linhas remotas ----------

async function fetchRow() {
  const rows = await http(`/rest/v1/${T.state}?select=version,data,updated_at,device&user_id=eq.${session.user.id}`);
  return rows?.[0] || null;
}

/** Última versão em comum com a nuvem (base do merge de 3 vias) — cifrada com o PIN. */
const saveBase = (data) => store.setSecure('cloud:base', structuredClone(data));

async function decryptEnvelope(env) {
  if (!isEnvelope(env)) throw new CloudError('Os dados da nuvem não estão no formato do Dhenors.');
  try { return await decryptJSON(env, key); } catch {
    const err = new CloudError('A frase secreta não abre os dados da nuvem. Ela foi trocada em outro aparelho? Digite a frase nova.');
    err.badKey = true;
    throw err;
  }
}

/** Baixa as partes listadas no índice que ainda não temos e monta o estado. */
async function loadManifest(man, baseState = null) {
  const parts = {};
  const need = [];
  const baseParts = baseState ? splitChunks(baseState) : {};
  const baseHashes = baseState ? await hashChunks(baseParts) : {};
  for (const [name, info] of Object.entries(man.chunks)) {
    if (baseHashes[name] && baseHashes[name] === info.hash) parts[name] = baseParts[name];
    else need.push([name, info.rev]);
  }
  for (let i = 0; i < need.length; i += 40) {
    const slice = need.slice(i, i + 40);
    const rows = await http(`/rest/v1/${T.chunks}?select=name,rev,data&user_id=eq.${session.user.id}&rev=in.(${slice.map(([, r]) => r).join(',')})`);
    const byRev = new Map((rows || []).map((r) => [r.rev, r]));
    for (const [name, rev] of slice) {
      const row = byRev.get(rev);
      if (!row) throw new CloudError('Uma parte dos dados da nuvem não foi encontrada. Tente sincronizar de novo.');
      parts[name] = await decryptEnvelope(row.data);
    }
  }
  return joinChunks(parts);
}

/** Linha remota → { state, manifest|null } (aceita o formato antigo: estado inteiro). */
async function readRemote(row, baseState) {
  const dec = await decryptEnvelope(row.data);
  if (isManifest(dec)) return { remote: await loadManifest(dec, baseState), man: dec };
  return { remote: dec, man: null };
}

/** Deixa só uma operação de rede por vez. */
const serial = (fn) => { busy = busy.then(fn, fn); return busy; };

// ---------- Enviar / receber ----------

async function push() {
  if (!ready()) return;
  setStatus('syncing');
  const snapshot = structuredClone(store.data);
  const parts = splitChunks(snapshot);
  const hashes = await hashChunks(parts);
  const prev = manifest?.chunks || {};
  const { changed } = diffChunks(hashes, prev);
  const uploaded = [];
  const chunks = {};
  try {
    for (const name of Object.keys(parts)) {
      if (!changed.includes(name)) { chunks[name] = prev[name]; continue; }
      if (chunkSize(parts[name]) > MAX_CHUNK) throw new CloudError(`A parte "${name}" passou de 4,5 MB. Faça um backup e apague dados antigos.`);
      const rev = randomRev();
      const env = await encryptJSON(parts[name], key, meta.salt, { it: meta.iterations });
      await http(`/rest/v1/${T.chunks}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { user_id: session.user.id, name, rev, data: env } });
      uploaded.push(rev);
      chunks[name] = { rev, hash: hashes[name] };
    }
  } catch (err) {
    await dropRevs(uploaded);
    throw err;
  }

  const newManifest = { format: 'dhenors-manifest', v: 2, chunks, updatedAt: snapshot.updatedAt, device: device(), app: APP_VERSION };
  const envM = await encryptJSON(newManifest, key, meta.salt, { it: meta.iterations });
  const now = new Date().toISOString();
  let version;
  if (meta.version == null) {
    try {
      const rows = await http(`/rest/v1/${T.state}`, {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: { user_id: session.user.id, data: envM, version: 1, device: device(), updated_at: now },
      });
      version = rows?.[0]?.version ?? 1;
    } catch (err) {
      await dropRevs(uploaded);
      if (err.status === 409 || err.code === '23505') return pull(); // já existe: baixa e resolve
      throw err;
    }
  } else {
    const rows = await http(`/rest/v1/${T.state}?user_id=eq.${session.user.id}&version=eq.${meta.version}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: { data: envM, version: meta.version + 1, device: device(), updated_at: now },
    });
    if (!rows?.length) { await dropRevs(uploaded); return pull(); } // outro aparelho salvou antes
    version = rows[0].version;
  }

  meta.version = version;
  manifest = newManifest;
  meta.dirty = false;
  meta.pending = 0;
  meta.lastSync = Date.now();
  meta.pushes = (meta.pushes || 0) + 1;
  await store.setSecure('cloud:manifest', manifest);
  await saveBase(snapshot);
  await saveMeta();
  setStatus('idle');
  // Histórico de versões (falhar aqui não atrapalha a sincronização)
  try {
    await http(`/rest/v1/${T.versions}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { user_id: session.user.id, version, manifest: envM, device: device() } });
  } catch { /* tabela antiga: sem histórico */ }
  if (meta.pushes % 10 === 1) collectGarbage().catch(() => {});
}

/** Apaga partes enviadas por um envio que não foi aceito. */
async function dropRevs(revs) {
  if (!revs.length) return;
  try { await http(`/rest/v1/${T.chunks}?user_id=eq.${session.user.id}&rev=in.(${revs.join(',')})`, { method: 'DELETE' }); } catch { /* fica para a limpeza */ }
}

/**
 * Limpeza: mantém as últimas KEEP_VERSIONS versões e só as partes
 * usadas por elas. O resto é apagado.
 */
async function collectGarbage() {
  const versions = await http(`/rest/v1/${T.versions}?select=version,manifest&user_id=eq.${session.user.id}&order=version.desc`);
  const keep = (versions || []).slice(0, KEEP_VERSIONS);
  const drop = (versions || []).slice(KEEP_VERSIONS);
  if (drop.length) await http(`/rest/v1/${T.versions}?user_id=eq.${session.user.id}&version=lt.${keep[keep.length - 1].version}`, { method: 'DELETE' });
  const used = new Set(Object.values(manifest?.chunks || {}).map((c) => c.rev));
  for (const v of keep) {
    try { const m = await decryptJSON(v.manifest, key); for (const c of Object.values(m.chunks || {})) used.add(c.rev); } catch { /* frase antiga */ }
  }
  const all = await http(`/rest/v1/${T.chunks}?select=rev&user_id=eq.${session.user.id}`);
  const orphan = (all || []).map((r) => r.rev).filter((r) => !used.has(r));
  for (let i = 0; i < orphan.length; i += 50) await dropRevs(orphan.slice(i, i + 50));
}

/**
 * Baixa a versão da nuvem, se for mais nova.
 * Com mudanças locais ainda não enviadas, junta item a item com a
 * última versão em comum e registra os conflitos.
 */
async function pull() {
  if (!ready()) return;
  setStatus('syncing');
  await checkDevice();
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
  const base = await store.getSecure('cloud:base');
  const { remote, man } = await readRemote(row, base);
  if (meta.dirty) {
    if (base) {
      // Mudanças dos dois lados: junta item a item usando a última versão em comum
      const { state: merged, conflicts } = mergeWithConflicts(base, store.data, remote);
      if (conflicts.length) await addConflicts(conflicts, row.device);
      await saveBase(remote);
      manifest = man;
      await store.applyRemote(merged);
      meta.version = row.version;
      return push(); // envia o resultado juntado
    }
    const localTime = Date.parse(store.data.updatedAt || 0) || 0;
    const remoteTime = Date.parse(remote.updatedAt || row.updated_at || 0) || 0;
    if (localTime > remoteTime) {
      keepBackup(remote, 'nuvem');
      meta.version = row.version;
      manifest = man;
      return push(); // as mudanças deste aparelho ganham
    }
    keepBackup(store.data, 'este aparelho');
    notify(`Havia mudanças em dois aparelhos ao mesmo tempo. Ficou a mais recente (${row.device || 'outro aparelho'}); a outra foi guardada em Nuvem → Conflitos.`);
  }
  await store.applyRemote(remote);
  manifest = man;
  meta.version = row.version;
  meta.dirty = false;
  meta.pending = 0;
  meta.lastSync = Date.now();
  if (man) await store.setSecure('cloud:manifest', man);
  await saveBase(remote);
  await saveMeta();
  setStatus('idle');
}

function keepBackup(data, origin) {
  store.setSecure('cloud:conflict', { at: Date.now(), origin, data });
}

// ---------- Conflitos ----------

const COLLECTION_LABEL = {
  expenses: 'Conta', recurring: 'Recorrente', installments: 'Parcelamento', goals: 'Meta', investments: 'Investimento',
  creditors: 'Credor', categories: 'Categoria', extraIncomes: 'Renda extra', settings: 'Ajuste', cards: 'Cartão',
  accounts: 'Conta/carteira', cardPurchases: 'Compra no cartão', transfers: 'Transferência', shifts: 'Plantão',
  debts: 'Dívida', subscriptions: 'Assinatura', receivables: 'A receber', envelopes: 'Envelope', wishlist: 'Desejo',
  recurringEntries: 'Pagamento de recorrente', closedMonths: 'Mês fechado', incomes: 'Receita', jobs: 'Vínculo',
};

async function addConflicts(list, from) {
  const current = (await store.getSecure('cloud:conflicts')) || [];
  const at = Date.now();
  for (const c of list) {
    const label = c.local?.description || c.local?.name || c.remote?.description || c.remote?.name || c.key || c.collection;
    const entry = { ...c, at, from: from || 'outro aparelho', label: `${COLLECTION_LABEL[c.collection] || c.collection}: ${label}` };
    const i = current.findIndex((x) => x.id === c.id);
    if (i >= 0) current[i] = entry; else current.push(entry);
  }
  await store.setSecure('cloud:conflicts', current.slice(-100));
  state.conflicts = current.length;
  notify(`${list.length === 1 ? 'Um item foi alterado' : `${list.length} itens foram alterados`} neste e em outro aparelho ao mesmo tempo. Ficou a versão da nuvem; toque em Nuvem → Conflitos para escolher.`, { action: 'conflicts' });
}

function notify(text, extra = {}) {
  globalThis.document?.dispatchEvent(new CustomEvent('dhenors:cloud-notice', { detail: typeof text === 'string' ? { text, ...extra } : text }));
}

// ---------- Aparelhos ----------

async function checkDevice(force = false) {
  if (!force && Date.now() - (meta.deviceCheck || 0) < 30 * 60_000) return;
  meta.deviceCheck = Date.now();
  try {
    const id = deviceId();
    const rows = await http(`/rest/v1/${T.devices}?select=revoked&user_id=eq.${session.user.id}&device_id=eq.${id}`);
    if (rows?.[0]?.revoked) {
      await cloud.signOut({ remote: false });
      notify('Este aparelho foi desconectado da nuvem por outro aparelho. Os dados continuam aqui; para voltar, entre de novo.');
      throw new CloudError('Aparelho desconectado da nuvem.');
    }
    await http(`/rest/v1/${T.devices}?on_conflict=user_id,device_id`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: session.user.id, device_id: id, name: localDeviceName(), app_version: APP_VERSION, last_seen: new Date().toISOString(), revoked: false },
    });
  } catch (err) {
    if (err.message === 'Aparelho desconectado da nuvem.') throw err;
    /* tabela antiga: segue sem a lista de aparelhos */
  }
}

function localDeviceName() {
  try { return localStorage.getItem('dhenors:device-name') || device(); } catch { return device(); }
}

/** Modo exemplo (ui/onboarding.js): dados de mentira nunca vão para a nuvem. */
const demoMode = () => { try { return localStorage.getItem('dhenors:demo') === '1'; } catch { return false; } };

const ready = () => Boolean(session && key && meta.linked && readConfig().url && !demoMode());

function run(fn) {
  return serial(async () => {
    try { await fn(); } catch (err) {
      if (err.paused) setStatus('paused', err.message);
      else if (err.offline) setStatus('offline', err.message);
      else if (err.badKey) { key = null; await persistKey(); setStatus('locked', err.message); } else setStatus(session ? 'error' : 'signedout', err.message);
    }
  });
}

function schedulePush() {
  meta.dirty = true;
  meta.pending = (meta.pending || 0) + 1;
  saveMeta();
  setStatus(state.status === 'idle' ? 'pending' : state.status, state.error);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run(push), PUSH_DELAY);
}

function startRealtime() {
  const { url, anonKey } = readConfig();
  realtime?.stop();
  realtime = new RealtimeClient({
    url, apiKey: anonKey, userId: session.user.id,
    token: () => session?.access_token || anonKey,
    onChange: () => { clearTimeout(startRealtime.t); startRealtime.t = setTimeout(() => run(() => pull()), 400); },
    onStatus: () => { setStatus(state.status, state.error); schedulePoll(); },
  });
  realtime.start();
}

function schedulePoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (ready() && document.visibilityState === 'visible') run(() => pull()); }, realtime?.live ? POLL_LIVE_MS : POLL_MS);
}

// ---------- API pública ----------

export const cloud = {
  get state() { return { ...state }; },
  get user() { return session?.user || null; },
  get linked() { return ready(); },
  get hasKey() { return Boolean(key); },
  get config() { return readConfig(); },
  get configured() { const c = readConfig(); return Boolean(c.url && c.anonKey); },
  get meta() { return { ...meta }; },
  get deviceId() { return deviceId(); },
  get deviceName() { return localDeviceName(); },
  get remember() { return meta.remember || 'always'; },

  /** Requisição autenticada (usada por push.js, aparelhos etc.). */
  request: (path, opts) => http(path, opts),

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setConfig({ url, anonKey }) {
    const clean = { url: String(url || '').trim().replace(/\/+$/, ''), anonKey: String(anonKey || '').trim() };
    if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(clean.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean.url)) throw new CloudError('URL inválida. Exemplo: https://abcdefgh.supabase.co');
    if (clean.anonKey.length < 20) throw new CloudError('Chave inválida. Copie a chave "anon"/"publishable" inteira.');
    localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
    setStatus(session ? state.status : 'signedout');
  },

  setDeviceName(name) {
    try { localStorage.setItem('dhenors:device-name', String(name).trim().slice(0, 40)); } catch { /* ignora */ }
    meta.deviceCheck = 0;
    if (ready()) run(() => checkDevice(true));
  },

  /** Carrega sessão/chave salvas e começa a sincronizar. */
  async init() {
    session = (await store.getSecure('cloud:session')) || null;
    meta = { ...EMPTY_META, ...((await getItem('cloud:meta')) || {}) };
    key = await loadKey();
    manifest = (await store.getSecure('cloud:manifest')) || null;
    state.conflicts = ((await store.getSecure('cloud:conflicts')) || []).length;
    if (!this.configured) return setStatus('off');
    if (!session) return setStatus('signedout');
    if (!key || !meta.linked) return setStatus('locked');

    if (!wired) {
      wired = true;
      store.subscribe((reason) => {
        if (reason === 'security') persistKey();
        if (!IGNORE.has(reason) && ready()) schedulePush();
      });
      const sync = () => { if (ready() && document.visibilityState === 'visible') run(() => pull()); };
      document.addEventListener('visibilitychange', sync);
      addEventListener('online', sync);
      addEventListener('focus', sync);
      // tenta enviar antes de fechar
      addEventListener('pagehide', () => { if (ready() && meta.dirty) run(push); });
    }
    startRealtime();
    schedulePoll();
    setStatus(meta.dirty ? 'pending' : 'idle');
    return run(() => pull());
  },

  async signIn(email, password) {
    const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
    await saveSession(s);
    if (meta.userId && meta.userId !== s.user?.id) await this.forgetLink(); // outra conta: começa do zero
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
    if (meta.userId && meta.userId !== user?.id) await this.forgetLink();
    meta.userId = user?.id;
    await saveMeta();
    await this.init();
  },

  async forgetLink() {
    key = null; manifest = null;
    meta = { ...EMPTY_META, remember: meta.remember };
    await persistKey();
    await store.setSecure('cloud:manifest', undefined);
    await store.setSecure('cloud:base', undefined);
  },

  /** Há dados desta conta na nuvem? → { exists, updatedAt, device } */
  async remoteInfo() {
    const row = await fetchRow();
    return row ? { exists: true, updatedAt: row.updated_at, device: row.device, salt: row.data?.salt } : { exists: false };
  },

  /**
   * Define (1º aparelho) ou confere (outros aparelhos) a frase secreta.
   * remember: 'session' | '30d' | 'always'
   * → { remote: dadosDaNuvem | null, version }
   */
  async unlock(passphrase, { remember = 'always' } = {}) {
    if (String(passphrase).length < 8) throw new CloudError('A frase secreta precisa ter pelo menos 8 caracteres.');
    const row = await fetchRow();
    const salt = row?.data?.salt || meta.salt || randomSalt();
    const iterations = row ? (row.data?.it || LEGACY_PASS_ITERATIONS) : PIN_KDF.iterations;
    const k = await deriveKey(passphrase, salt, iterations, { extractable: true });
    let remote = null;
    let man = null;
    if (row) {
      key = k;
      try {
        ({ remote, man } = await readRemote(row, null));
      } catch (err) {
        key = null;
        if (err.badKey) throw new CloudError('Frase secreta incorreta. É a mesma que você criou no primeiro aparelho.');
        throw err;
      }
    }
    key = k;
    meta.salt = salt;
    meta.iterations = iterations;
    meta.remember = ['session', '30d', 'always'].includes(remember) ? remember : 'always';
    meta.rememberUntil = meta.remember === '30d' ? Date.now() + 30 * 86_400_000 : null;
    manifest = man;
    await persistKey();
    await saveMeta();
    return { remote, version: row?.version ?? null };
  },

  /** Muda por quanto tempo a frase fica lembrada neste aparelho. */
  async setRemember(remember) {
    meta.remember = ['session', '30d', 'always'].includes(remember) ? remember : 'always';
    meta.rememberUntil = meta.remember === '30d' ? Date.now() + 30 * 86_400_000 : null;
    await persistKey();
    await saveMeta();
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
      manifest = null; // reenvia todas as partes
    }
    await saveMeta();
    await this.init();
  },

  syncNow() { return run(() => (meta.dirty ? push() : pull())); },

  /**
   * Troca a frase secreta: deriva uma chave nova, recriptografa TODAS as
   * partes e o índice e envia. Os outros aparelhos vão pedir a frase nova.
   * As versões antigas do histórico (cifradas com a frase antiga) são apagadas.
   */
  async changePassphrase(current, next) {
    if (String(next).length < 8) throw new CloudError('A nova frase precisa ter pelo menos 8 caracteres.');
    const check = await deriveKey(current, meta.salt, meta.iterations || LEGACY_PASS_ITERATIONS);
    const row = await fetchRow();
    if (row) {
      try { await decryptJSON(row.data, check); } catch { throw new CloudError('A frase secreta atual está incorreta.'); }
    }
    return serial(async () => {
      // Garante que temos a versão mais recente antes de recriptografar
      await pull();
      const salt = randomSalt();
      key = await deriveKey(next, salt, PIN_KDF.iterations, { extractable: true });
      meta.salt = salt;
      meta.iterations = PIN_KDF.iterations;
      manifest = null; // todas as partes são enviadas de novo, com a chave nova
      meta.dirty = true;
      await push();
      try { await http(`/rest/v1/${T.versions}?user_id=eq.${session.user.id}&version=lt.${meta.version}`, { method: 'DELETE' }); } catch { /* ignora */ }
      await persistKey();
      await saveMeta();
      collectGarbage().catch(() => {});
    });
  },

  // ---------- Histórico de versões ----------

  async listVersions() {
    const rows = await http(`/rest/v1/${T.versions}?select=version,device,created_at&user_id=eq.${session.user.id}&order=version.desc&limit=${KEEP_VERSIONS}`);
    return rows || [];
  },

  /** Estado de uma versão antiga (para pré-visualizar ou restaurar). */
  async loadVersion(version) {
    const rows = await http(`/rest/v1/${T.versions}?select=manifest&user_id=eq.${session.user.id}&version=eq.${version}`);
    if (!rows?.[0]) throw new CloudError('Versão não encontrada.');
    const man = await decryptEnvelope(rows[0].manifest);
    return loadManifest(man, await store.getSecure('cloud:base'));
  },

  /** Restaura uma versão: vira uma alteração nova (as outras versões continuam no histórico). */
  async restoreVersion(version) {
    const old = await this.loadVersion(version);
    await store.replace(old);
    meta.dirty = true;
    await saveMeta();
    return this.syncNow();
  },

  // ---------- Conflitos ----------

  async conflicts() { return (await store.getSecure('cloud:conflicts')) || []; },

  /** choice: 'local' (volta a minha versão) | 'remote' (mantém a da nuvem, que já está valendo) */
  async resolveConflict(id, choice) {
    const list = await this.conflicts();
    const c = list.find((x) => x.id === id);
    if (!c) return;
    if (choice === 'local') {
      store.commit((d) => { setAtPath(d, c.path, c.local == null ? null : structuredClone(c.local)); });
    }
    const rest = list.filter((x) => x.id !== id);
    await store.setSecure('cloud:conflicts', rest);
    state.conflicts = rest.length;
    setStatus(state.status, state.error);
  },

  async clearConflicts() {
    await store.setSecure('cloud:conflicts', []);
    state.conflicts = 0;
    setStatus(state.status, state.error);
  },

  async conflictBackup() { return store.getSecure('cloud:conflict'); },
  async clearConflict() { return store.setSecure('cloud:conflict', undefined); },

  // ---------- Aparelhos ----------

  async listDevices() {
    const rows = await http(`/rest/v1/${T.devices}?select=device_id,name,app_version,last_seen,revoked&user_id=eq.${session.user.id}&order=last_seen.desc`);
    return (rows || []).map((r) => ({ ...r, current: r.device_id === deviceId() }));
  },

  /** Desconecta um aparelho: na próxima sincronização ele sai da nuvem. */
  async revokeDevice(id) {
    await http(`/rest/v1/${T.devices}?user_id=eq.${session.user.id}&device_id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { revoked: true } });
  },

  async forgetDevice(id) {
    await http(`/rest/v1/${T.devices}?user_id=eq.${session.user.id}&device_id=eq.${id}`, { method: 'DELETE' });
  },

  /** Encerra as sessões de TODOS os outros aparelhos (precisarão entrar de novo). */
  async signOutOthers() {
    await http('/auth/v1/logout?scope=others', { method: 'POST' });
  },

  // ---------- Pausa do projeto gratuito ----------

  /** Dias desde o último contato com o Supabase e se está perto de pausar. */
  pauseRisk(now = Date.now()) {
    if (!meta.linked || !meta.lastContact) return null;
    const days = Math.floor((now - meta.lastContact) / 86_400_000);
    return { days, warn: days >= PAUSE_DAYS - 2, paused: state.status === 'paused', left: Math.max(0, PAUSE_DAYS - days) };
  },

  async signOut({ remote = true } = {}) {
    clearTimeout(pushTimer);
    clearInterval(pollTimer);
    realtime?.stop();
    realtime = null;
    try { if (session && remote) await http('/auth/v1/logout', { method: 'POST' }); } catch { /* ignora */ }
    await saveSession(null);
    await this.forgetLink();
    await saveMeta();
    setStatus(this.configured ? 'signedout' : 'off');
  },
};
