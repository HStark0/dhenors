// =============================================================
// cloud.js — Sincronização com a nuvem (Supabase), sem bibliotecas
// -------------------------------------------------------------
// • A nuvem é o ÚNICO lugar onde os dados ficam. Ao entrar, o estado
//   é baixado para a memória; cada alteração sobe logo em seguida. No
//   navegador fica só o acesso à conta ("lembrar o login", ver
//   core/storage.js) — nenhum dado financeiro, nem cópia, nem cache.
// • Antes de sair do aparelho, os dados são CRIPTOGRAFADOS com a
//   sua frase secreta (AES-GCM, chave PBKDF2). O Supabase só guarda
//   envelopes ilegíveis. Cada envelope é amarrado (AAD) ao usuário,
//   à parte e à versão, e o hash de cada parte é conferido ao abrir
//   (cloud/sync.js).
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
//   ver a lista e desconectar um aparelho remotamente (o que também
//   encerra as sessões dos outros aparelhos no Supabase).
// • Anexos: cada arquivo vai cifrado (chave própria, guardada no estado
//   cifrado) para o Supabase Storage, bucket `dhenors-files`.
//
// Módulos:
//   cloud/http.js     configuração, chamadas REST, erros traduzidos
//   cloud/sync.js     envelopes (AAD + hash) e regras puras do envio
//   cloud/devices.js  nome e id deste aparelho
//
// API REST usada (documentação pública do Supabase):
//   Auth:  POST /auth/v1/signup · /auth/v1/token?grant_type=password|refresh_token · /auth/v1/logout
//          POST /auth/v1/recover (e-mail de nova senha) · PUT /auth/v1/user (grava a nova senha)
//   Dados: /rest/v1/dhenors_state · dhenors_chunks · dhenors_versions · dhenors_devices
//   Anexos: /storage/v1/object/dhenors-files/<usuário>/<id>
// =============================================================

import { store } from './store.js';
import { readAuth, writeAuth, saveKey, loadKey } from './storage.js';
import { deriveKey, randomSalt, exportRawKey, importRawKey, toB64, fromB64, PIN_KDF, LEGACY_PASS_ITERATIONS } from './crypto.js';
import { APP_VERSION } from '../version.js';
import { mergeWithConflicts, setAtPath } from '../domain/merge.js';
import { splitChunks, joinChunks, hashChunks, diffChunks, isManifest, chunkSize } from '../domain/chunks.js';
import { RealtimeClient } from './realtime.js';
import { CloudError, CONFIG_KEY, readConfig, request } from './cloud/http.js';
import { device, deviceId, localDeviceName, saveDeviceName } from './cloud/devices.js';
import {
  sealPart, sealManifest, openManifest, openPart, assertNotRollback, assertSchema, settlePending,
  conflictCopies, addConflictCopy,
} from './cloud/sync.js';

export { CloudError };

const T = { state: 'dhenors_state', chunks: 'dhenors_chunks', versions: 'dhenors_versions', devices: 'dhenors_devices' };
const PUSH_DELAY = 600;          // os dados só existem na memória: envia logo
const POLL_MS = 60_000;          // sem tempo real
const POLL_LIVE_MS = 5 * 60_000; // com tempo real (só reserva)
const KEEP_VERSIONS = 30;
const MAX_CHUNK = 4.5 * 1024 * 1024;
const PAUSE_DAYS = 7;            // projeto gratuito do Supabase pausa após 7 dias sem uso
const ORPHAN_GRACE_MS = 86_400_000; // parte sem índice só é apagada depois de 1 dia (outro aparelho pode estar no meio de um envio)
const IGNORE = new Set(['ui', 'remote', 'open', 'close', 'readonly']); // 'silent' sobe também: só não redesenha
const BUCKET = 'dhenors-files';

const listeners = new Set();
let session = null;   // { access_token, refresh_token, expires_at, user: { id, email } }
let key = null;       // CryptoKey (frase secreta)
const EMPTY_META = { salt: null, iterations: null, version: null, dirty: false, pending: 0, lastSync: null, lastContact: null, userId: null, linked: false, remember: 'always', rememberUntil: null, pushes: 0, deviceCheck: 0 };
let meta = { ...EMPTY_META };
let manifest = null;  // índice da última versão em comum { chunks: { nome: { rev, hash, a } } }
let pushTimer = null;
let busy = Promise.resolve();
let wired = false;
let realtime = null;
let pollTimer = 0;
let upgradePass = null; // frase digitada numa conta com PBKDF2 antigo: recifra tudo depois de ligar
let repairOnLink = false; // faltavam partes na nuvem ao desbloquear: reenvia todas ao ligar
let forceLocal = false;   // "Usar os deste aparelho": vale até o primeiro envio aceito
/** Cópias de trabalho da sincronização (base do merge, índice, conflitos): só na memória. */
const mem = new Map();
const memGet = (k) => mem.get(k);
const memSet = (k, v) => { if (v === undefined) mem.delete(k); else mem.set(k, v); };

const randomRev = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20);
const uid = () => {
  if (!session?.user?.id) throw new CloudError('Entre na sua conta.');
  return session.user.id;
};

// ---------- HTTP (com a sessão) ----------

async function http(path, { auth = true, headers = {}, ...opts } = {}, retried = false) {
  if (auth) await ensureFreshToken();
  try {
    const json = await request(path, { ...opts, headers, token: auth ? session?.access_token : null });
    meta.lastContact = Date.now();
    return json;
  } catch (err) {
    if (err.status) meta.lastContact = Date.now(); // o servidor respondeu (com erro)
    // Token recusado (relógio do aparelho errado, renovado em outra aba…): renova e tenta uma vez
    if (auth && !retried && err.status === 401 && session) {
      session.expires_at = 0;
      return http(path, { auth, headers, ...opts }, true);
    }
    throw err;
  }
}

// ---------- Sessão ("lembrar o login") ----------

function saveSession(s) {
  session = s ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    // validade contada no relógio DESTE aparelho (um relógio adiantado ou atrasado
    // renovaria o token a toda hora ou nunca)
    expires_at: Math.floor(Date.now() / 1000) + (Number(s.expires_in) || Math.max(60, (Number(s.expires_at) || 0) - Math.floor(Date.now() / 1000)) || 3600),
    user: { id: s.user?.id || session?.user?.id, email: s.user?.email || session?.user?.email },
  } : null;
  return persistAuth();
}

let refreshing = null;

/** Outra aba deste navegador renovou o token (o de renovação é de uso único): usa o dela. */
function adoptStoredSession() {
  const stored = readAuth()?.session;
  if (!stored || !session || stored.user?.id !== session.user?.id) return false;
  if (stored.refresh_token === session.refresh_token) return false;
  session = stored;
  return true;
}

async function ensureFreshToken() {
  if (!session) throw new CloudError('Entre na sua conta da nuvem.');
  if (session.expires_at - 60 > Date.now() / 1000) return;
  if (adoptStoredSession() && session.expires_at - 60 > Date.now() / 1000) return;
  const renew = async () => {
    try {
      const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
      await saveSession(s);
    } catch (err) {
      // Token de renovação recusado: talvez outra aba tenha acabado de renovar
      if ((err.status === 400 || err.status === 401) && adoptStoredSession()) return;
      // Recusado de vez (400/401): precisa entrar de novo. Outros erros (sem internet,
      // projeto pausado, 5xx, muitas tentativas) são temporários: a sessão continua.
      if (err.status === 400 || err.status === 401) {
        rescuePending();
        await saveSession(null);
        setStatus('signedout', 'A sessão expirou. Entre de novo.');
      }
      throw err;
    }
  };
  // Uma renovação por vez, também entre abas (navigator.locks, quando houver)
  refreshing ||= (async () => {
    try {
      if (globalThis.navigator?.locks) await navigator.locks.request('dhenors-refresh', async () => { if (!adoptStoredSession() || session.expires_at - 60 <= Date.now() / 1000) await renew(); });
      else await renew();
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

const saveMeta = () => persistAuth();

// ---------- O que fica no navegador ----------
// Só o acesso: sessão, chave da frase (nunca a frase), sal e por quanto
// tempo lembrar. remember: 'session' (até fechar o app) | '30d' | 'always'.

//  • "Sempre" / "30 dias": a chave vai como CryptoKey NÃO exportável para o
//    IndexedDB "dhenors-auth" (o script do app usa, mas ninguém lê os bytes).
//  • "Só até fechar o app": vai em base64 no sessionStorage, que some ao fechar.
let storedKey = null; // a chave já gravada (evita regravar a cada envio)

async function persistAuth() {
  const s = session; // fotografia: um signOut no meio de um await não pode regravar a chave
  const k = key;
  if (!s) { writeAuth(null); storedKey = null; await saveKey(null); return; }
  const session_ = meta.remember === 'session';
  let raw = null;
  if (k && session_) { try { raw = toB64(await exportRawKey(k)); } catch { /* chave não exportável: fica só na memória */ } }
  if (session !== s) return; // saiu da conta enquanto isso
  writeAuth({
    session: s, key: raw, salt: meta.salt, it: meta.iterations, userId: meta.userId, lastContact: meta.lastContact || null,
    remember: meta.remember || 'always', until: meta.remember === '30d' ? meta.rememberUntil : null,
  });
  if (session_ || !k) { if (storedKey) { storedKey = null; await saveKey(null); } return; }
  if (storedKey === k) return;
  let locked = k;
  if (k.extractable) { try { locked = await importRawKey(await exportRawKey(k), false); } catch { locked = k; } }
  if (session !== s) return;
  storedKey = k;
  await saveKey(locked);
}

async function loadAuth() {
  const auth = readAuth();
  session = auth?.session || null;
  meta = { ...EMPTY_META, salt: auth?.salt || null, iterations: auth?.it || null, userId: auth?.userId || null, lastContact: auth?.lastContact || null, remember: auth?.remember || 'always', rememberUntil: auth?.until || null };
  key = null;
  if (!session) { await saveKey(null); return; }
  if (auth?.key) { try { key = await importRawKey(fromB64(auth.key), true); } catch { key = null; } }
  else { key = await loadKey(); storedKey = key; }
}

/**
 * A conta vai fechar (frase trocada em outro aparelho, sessão recusada) com
 * alterações ainda não enviadas: guarda uma cópia na memória para juntar com
 * a nuvem quando a pessoa entrar de novo (ver link).
 */
let rescue = null;
function rescuePending() {
  if (meta.dirty && store.data && !store.guest) rescue = { userId: meta.userId, local: structuredClone(store.data), base: memGet('cloud:base') || null };
}

// ---------- Linhas remotas ----------

async function fetchRow() {
  const rows = await http(`/rest/v1/${T.state}?select=version,data,updated_at,device&user_id=eq.${uid()}`);
  return rows?.[0] || null;
}

/** Última versão em comum com a nuvem (base do merge de 3 vias) — só na memória. */
const saveBase = (data) => memSet('cloud:base', structuredClone(data));

const missingPart = () => Object.assign(new CloudError('Uma parte dos dados da nuvem não foi encontrada. Tente sincronizar de novo.'), { missing: true });

/**
 * Baixa as partes listadas no índice que ainda não temos e monta o estado.
 * fill(nome): de onde tirar uma parte que sumiu da nuvem (→ valor ou undefined).
 * → { state, repaired: partes que vieram do fill, lost: partes sem nenhuma cópia }
 */
async function loadManifest(man, baseState = null, fill = null) {
  const parts = {};
  const need = [];
  const repaired = [];
  const lost = [];
  const baseParts = baseState ? splitChunks(baseState) : {};
  const baseHashes = baseState ? await hashChunks(baseParts) : {};
  for (const [name, info] of Object.entries(man.chunks)) {
    if (baseHashes[name] && baseHashes[name] === info.hash) parts[name] = baseParts[name];
    else need.push([name, info]);
  }
  for (let i = 0; i < need.length; i += 40) {
    const slice = need.slice(i, i + 40);
    const rows = await http(`/rest/v1/${T.chunks}?select=name,rev,data&user_id=eq.${uid()}&rev=in.(${slice.map(([, info]) => info.rev).join(',')})`);
    const byRev = new Map((rows || []).map((r) => [r.rev, r]));
    for (const [name, info] of slice) {
      const row = byRev.get(info.rev);
      if (!row) {
        if (!fill) throw missingPart();
        const value = await fill(name);
        if (value === undefined) lost.push(name);
        else { parts[name] = value; repaired.push(name); }
        continue;
      }
      parts[name] = (await openPart(row.data, key, { userId: uid(), name, rev: info.rev, hash: info.hash })).value;
    }
  }
  return { state: joinChunks(parts), repaired, lost };
}

/**
 * Linha remota → { remote, man|null, damaged } (aceita o formato antigo: estado inteiro).
 * Com fill, partes que sumiram da nuvem são completadas (damaged = true, man = null:
 * o próximo envio manda todas as partes de novo). partial: aceita partes sem cópia.
 */
async function readRemote(row, baseState, { fill = null, partial = false } = {}) {
  const dec = await openManifest(row.data, key, { userId: uid(), version: row.version });
  if (!isManifest(dec)) { assertSchema(dec); return { remote: dec, man: null, damaged: false }; }
  const { state, repaired, lost } = await loadManifest(dec, baseState, fill);
  if (lost.length && !partial) throw missingPart();
  assertSchema(state);
  const damaged = repaired.length + lost.length > 0;
  return { remote: state, man: damaged ? null : dec, damaged };
}

/**
 * Procura uma cópia de uma parte que sumiu no histórico de versões,
 * da mais nova para a mais antiga. (Versões anteriores à 3.3.0 apagavam, na
 * limpeza, partes que o índice de outro aparelho ainda usava.)
 */
function historyFill() {
  let list = null;
  return async (name) => {
    if (!list) {
      try { list = (await http(`/rest/v1/${T.versions}?select=version,manifest&user_id=eq.${uid()}&order=version.desc`)) || []; } catch { list = []; }
    }
    for (const v of list) {
      if (v.man === undefined) {
        try { v.man = await openManifest(v.manifest, key, { userId: uid(), version: v.version }); } catch { v.man = null; }
      }
      const info = v.man?.chunks?.[name];
      if (!info) continue;
      const rows = await http(`/rest/v1/${T.chunks}?select=data&user_id=eq.${uid()}&rev=eq.${info.rev}`);
      if (!rows?.[0]) continue;
      try { return (await openPart(rows[0].data, key, { userId: uid(), name, rev: info.rev, hash: info.hash })).value; } catch { /* cópia ilegível: tenta a próxima */ }
    }
    return undefined;
  };
}

/** Primeira fonte que tiver a parte. */
const firstOf = (...fills) => async (name) => {
  for (const f of fills) {
    const value = await f(name);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** readRemote que, se faltar parte na nuvem, completa com o histórico e com os dados deste aparelho. */
async function readRemoteOrRepair(row, baseState) {
  try {
    return await readRemote(row, baseState);
  } catch (err) {
    if (!err.missing) throw err;
    const local = splitChunks(store.data);
    return readRemote(row, baseState, { fill: firstOf(historyFill(), (name) => local[name]), partial: true });
  }
}

const REPAIRED_NOTICE = 'Algumas partes dos dados da nuvem tinham sumido. Foram recompostas com o histórico de versões e com este aparelho, e enviadas de novo.';

/** Deixa só uma operação de rede por vez. */
const serial = (fn) => { busy = busy.then(fn, fn); return busy; };

// ---------- Enviar / receber ----------

async function push() {
  if (!ready()) return;
  setStatus('syncing');
  const gen = meta.pending || 0; // alterações feitas DURANTE o envio continuam pendentes
  const snapshot = structuredClone(store.data);
  const parts = splitChunks(snapshot);
  const hashes = await hashChunks(parts);
  const prev = manifest?.chunks || {};
  const { changed } = diffChunks(hashes, prev);
  const uploaded = [];
  const chunks = {};
  try {
    for (const name of Object.keys(parts)) {
      // partes antigas (sem AAD) são recifradas agora
      if (!changed.includes(name) && prev[name]?.a) { chunks[name] = prev[name]; continue; }
      if (chunkSize(parts[name]) > MAX_CHUNK) throw new CloudError(`A parte "${name}" passou de 4,5 MB. Faça um backup e apague dados antigos.`);
      const rev = randomRev();
      const env = await sealPart(parts[name], key, { salt: meta.salt, it: meta.iterations, userId: uid(), name, rev });
      await http(`/rest/v1/${T.chunks}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { user_id: uid(), name, rev, data: env } });
      uploaded.push(rev);
      chunks[name] = { rev, hash: hashes[name], a: 1 };
    }
  } catch (err) {
    await dropRevs(uploaded);
    throw err;
  }

  const newManifest = { format: 'dhenors-manifest', v: 3, chunks, updatedAt: snapshot.updatedAt, device: device(), app: APP_VERSION };
  const target = meta.version == null ? 1 : meta.version + 1;
  const envM = await sealManifest(newManifest, key, { salt: meta.salt, it: meta.iterations, userId: uid(), version: target });
  const now = new Date().toISOString();
  let version;
  if (meta.version == null) {
    try {
      const rows = await http(`/rest/v1/${T.state}`, {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: { user_id: uid(), data: envM, version: target, device: device(), updated_at: now },
      });
      version = rows?.[0]?.version ?? target;
    } catch (err) {
      await dropRevs(uploaded);
      if (err.status === 409 || err.code === '23505') return pull(); // já existe: baixa e resolve
      throw err;
    }
  } else {
    const rows = await http(`/rest/v1/${T.state}?user_id=eq.${uid()}&version=eq.${meta.version}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: { data: envM, version: target, device: device(), updated_at: now },
    });
    if (!rows?.length) { await dropRevs(uploaded); return pull(); } // outro aparelho salvou antes
    version = rows[0].version;
  }

  meta.version = version;
  manifest = { ...newManifest, version };
  settlePending(meta, gen);
  forceLocal = false;
  meta.lastSync = Date.now();
  meta.pushes = (meta.pushes || 0) + 1;
  memSet('cloud:manifest', manifest);
  await saveBase(snapshot);
  await saveMeta();
  setStatus(meta.dirty ? 'pending' : 'idle');
  // Histórico de versões (falhar aqui não atrapalha a sincronização)
  try {
    await http(`/rest/v1/${T.versions}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { user_id: uid(), version, manifest: envM, device: device() } });
  } catch { /* tabela antiga: sem histórico */ }
  if (meta.pushes % 10 === 1) collectGarbage().catch(() => {});
}

/** Apaga partes enviadas por um envio que não foi aceito. */
async function dropRevs(revs) {
  if (!revs.length) return;
  try { await http(`/rest/v1/${T.chunks}?user_id=eq.${uid()}&rev=in.(${revs.join(',')})`, { method: 'DELETE' }); } catch { /* fica para a limpeza */ }
}

/**
 * Limpeza: mantém as últimas KEEP_VERSIONS versões e só as partes
 * usadas por elas. Partes sem índice só saem depois de 1 dia: podem
 * ser de outro aparelho que ainda está no meio de um envio.
 */
async function collectGarbage() {
  const versions = await http(`/rest/v1/${T.versions}?select=version,manifest&user_id=eq.${uid()}&order=version.desc`);
  const keep = (versions || []).slice(0, KEEP_VERSIONS);
  const drop = (versions || []).slice(KEEP_VERSIONS);
  if (drop.length) await http(`/rest/v1/${T.versions}?user_id=eq.${uid()}&version=lt.${keep[keep.length - 1].version}`, { method: 'DELETE' });
  const used = new Set(Object.values(manifest?.chunks || {}).map((c) => c.rev));
  for (const v of keep) {
    // Versão ilegível: não dá para saber que partes ela usa, então não apaga nada desta vez
    try { const m = await openManifest(v.manifest, key, { userId: uid(), version: v.version }); for (const c of Object.values(m.chunks || {})) used.add(c.rev); } catch { return; }
  }
  const before = new Date(Date.now() - ORPHAN_GRACE_MS).toISOString();
  const old = await http(`/rest/v1/${T.chunks}?select=rev&user_id=eq.${uid()}&created_at=lt.${encodeURIComponent(before)}`);
  const orphan = (old || []).map((r) => r.rev).filter((r) => !used.has(r));
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
    manifest = null; // o índice antigo pode citar partes que não existem mais: envia todas
    await saveMeta();
    return push();
  }
  assertNotRollback(meta.version, row.version);
  if (row.version === meta.version) {
    if (meta.dirty) return push();
    meta.lastSync = Date.now();
    await saveMeta();
    return setStatus('idle');
  }
  const base = memGet('cloud:base');
  const { remote, man, damaged } = await readRemoteOrRepair(row, base);
  if (damaged) notify(REPAIRED_NOTICE);
  if (meta.dirty) {
    if (base) {
      // Mudanças dos dois lados: junta item a item usando a última versão em comum
      const { state: merged, conflicts } = mergeWithConflicts(base, store.data, remote);
      await store.applyRemote(merged); // logo após juntar: nada digitado no meio se perde
      manifest = man;
      meta.version = row.version;
      await saveBase(remote);
      if (conflicts.length) await addConflicts(conflicts, row.device);
      return push(); // envia o resultado juntado
    }
    if (forceLocal) {
      // A pessoa escolheu "Usar os deste aparelho": eles substituem a nuvem
      await keepBackup(remote, 'nuvem');
      meta.version = row.version;
      manifest = null;
      return push();
    }
    const localTime = Date.parse(store.data.updatedAt || 0) || 0;
    const remoteTime = Date.parse(remote.updatedAt || row.updated_at || 0) || 0;
    if (localTime > remoteTime) {
      await keepBackup(remote, 'nuvem');
      meta.version = row.version;
      manifest = man;
      return push(); // as mudanças deste aparelho ganham
    }
    await keepBackup(store.data, 'este aparelho');
    notify(`Havia mudanças em dois aparelhos ao mesmo tempo. Ficou a mais recente (${row.device || 'outro aparelho'}); a outra foi guardada em Nuvem → Conflitos.`);
  }
  await store.applyRemote(remote);
  manifest = man;
  meta.version = row.version;
  meta.dirty = false;
  meta.pending = 0;
  meta.lastSync = Date.now();
  if (man) memSet('cloud:manifest', man);
  await saveBase(remote);
  if (damaged) {
    meta.dirty = true; // manifest = null: reenvia todas as partes e a nuvem volta a ficar inteira
    await saveMeta();
    return push();
  }
  await saveMeta();
  setStatus('idle');
}

/** Guarda uma cópia completa (até 3, as mais recentes). */
async function keepBackup(data, origin) {
  const saved = memGet('cloud:conflict');
  memSet('cloud:conflict', addConflictCopy(saved, { at: Date.now(), origin, data: structuredClone(data) }));
}

// ---------- Conflitos ----------

const COLLECTION_LABEL = {
  expenses: 'Conta', recurring: 'Recorrente', installments: 'Parcelamento', goals: 'Meta', investments: 'Investimento',
  creditors: 'Credor', categories: 'Categoria', extraIncomes: 'Renda extra', recurringIncomes: 'Renda recorrente', settings: 'Ajuste', cards: 'Cartão',
  accounts: 'Conta/carteira', cardPurchases: 'Compra no cartão', transfers: 'Transferência', shifts: 'Plantão',
  debts: 'Dívida', subscriptions: 'Assinatura', receivables: 'A receber', envelopes: 'Envelope', wishlist: 'Desejo',
  recurringEntries: 'Pagamento de recorrente', closedMonths: 'Mês fechado', incomes: 'Receita', jobs: 'Vínculo',
};

async function addConflicts(list, from) {
  const current = (memGet('cloud:conflicts')) || [];
  const at = Date.now();
  for (const c of list) {
    const label = c.local?.description || c.local?.name || c.remote?.description || c.remote?.name || c.key || c.collection;
    const entry = { ...c, at, from: from || 'outro aparelho', label: `${COLLECTION_LABEL[c.collection] || c.collection}: ${label}` };
    const i = current.findIndex((x) => x.id === c.id);
    if (i >= 0) current[i] = entry; else current.push(entry);
  }
  memSet('cloud:conflicts', current.slice(-100));
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
    const rows = await http(`/rest/v1/${T.devices}?select=revoked&user_id=eq.${uid()}&device_id=eq.${encodeURIComponent(id)}`);
    if (rows?.[0]?.revoked) {
      await cloud.signOut({ remote: false });
      notify('Este aparelho foi desconectado da nuvem por outro aparelho. Os dados continuam na nuvem; para voltar, entre de novo.');
      throw new CloudError('Aparelho desconectado da nuvem.');
    }
    // `revoked` não vai no corpo: só o banco (e "Desconectar") mexe nele
    await http(`/rest/v1/${T.devices}?on_conflict=user_id,device_id`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: uid(), device_id: id, name: localDeviceName(), app_version: APP_VERSION, last_seen: new Date().toISOString() },
    });
  } catch (err) {
    if (err.message === 'Aparelho desconectado da nuvem.') throw err;
    /* tabela antiga: segue sem a lista de aparelhos */
  }
}

/**
 * Entrou de novo com e-mail e senha num aparelho que tinha sido
 * desconectado: tira a marca antiga (quem sabe a senha pode entrar).
 */
async function rejoinDevice() {
  try { await http(`/rest/v1/${T.devices}?user_id=eq.${uid()}&device_id=eq.${encodeURIComponent(deviceId())}&revoked=is.true`, { method: 'DELETE' }); } catch { /* tabela antiga */ }
  meta.deviceCheck = 0;
}


/** Pronto para enviar/receber: conta aberta, com a chave da frase. */
const ready = () => Boolean(session && key && meta.linked && readConfig().url && !store.guest && !store.readOnly);

function run(fn) {
  return serial(async () => {
    try { await fn(); } catch (err) {
      if (err.tooNew) {
        // Nuvem com dados de uma versão mais nova: não aplica, não envia
        store.setReadOnly(err.message);
        notify(err.message);
        setStatus('error', err.message);
      } else if (err.paused) setStatus('paused', err.message);
      else if (err.offline) setStatus('offline', err.message);
      else if (err.badKey) {
        // A frase foi trocada em outro aparelho: pede a nova (o que não subiu fica guardado)
        rescuePending();
        key = null;
        meta.linked = false;
        await persistAuth();
        setStatus('locked', err.message);
      } else setStatus(session ? 'error' : 'signedout', err.message);
    }
  });
}

function schedulePush() {
  meta.dirty = true;
  meta.pending = (meta.pending || 0) + 1;
  setStatus(state.status === 'idle' ? 'pending' : state.status, state.error);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run(push), PUSH_DELAY);
}

function startRealtime() {
  const { url, anonKey } = readConfig();
  realtime?.stop();
  realtime = new RealtimeClient({
    url, apiKey: anonKey, userId: uid(),
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

/** Liga os avisos da store e do navegador (uma vez). */
function wire() {
  if (wired) return;
  wired = true;
  store.subscribe((reason) => { if (!IGNORE.has(reason) && ready()) schedulePush(); });
  const sync = () => { if (ready() && document.visibilityState === 'visible') run(() => (meta.dirty ? push() : pull())); };
  document.addEventListener('visibilitychange', sync);
  // Indo para segundo plano (trocou de app, bloqueou a tela): envia já, sem esperar
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ready() && meta.dirty) { clearTimeout(pushTimer); run(push); } });
  // Outra aba renovou o token ou saiu da conta
  addEventListener('storage', (ev) => {
    if (ev.key !== 'dhenors:auth') return;
    if (!ev.newValue && session && ready()) { cloud.signOut({ remote: false }); return; }
    adoptStoredSession();
  });
  addEventListener('online', sync);
  addEventListener('focus', sync);
  // Saindo com algo ainda não enviado: tenta enviar e pede confirmação ao navegador
  addEventListener('pagehide', () => { if (ready() && meta.dirty) run(push); });
  addEventListener('beforeunload', (ev) => {
    if (!ready() || !meta.dirty) return;
    run(push);
    ev.preventDefault();
    ev.returnValue = '';
  });
}

/** Começa a sincronizar a conta aberta. */
async function start() {
  wire();
  startRealtime();
  schedulePoll();
  setStatus(meta.dirty ? 'pending' : 'idle');
  await run(() => (meta.dirty ? push() : pull()));
  if (upgradePass) {
    // Conta antiga (PBKDF2 com menos iterações): recifra tudo com a proteção atual
    const p = upgradePass;
    upgradePass = null;
    await run(() => rekeyCloud(p));
  }
}

/**
 * Abre os dados da nuvem → { remote, man, damaged }.
 * Faltou alguma parte: completa com o histórico de versões (damaged = true,
 * man = null: o próximo envio manda todas as partes de novo).
 */
async function openRemote(row) {
  try {
    return await readRemote(row, null);
  } catch (err) {
    if (!err.missing) throw err;
    const { remote } = await readRemote(row, null, { fill: historyFill(), partial: true });
    return { remote: remote?.schema == null ? null : remote, man: null, damaged: true }; // sem a parte "meta" não há o que aproveitar
  }
}

/**
 * Recifra TUDO com uma frase (nova ou a mesma) num sal novo e com as
 * iterações atuais. Os outros aparelhos vão pedir a frase de novo.
 * (Os anexos têm chave própria, guardada no estado: não precisam mudar.)
 */
async function rekeyCloud(passphrase) {
  await pull(); // garante a versão mais recente antes de recriptografar
  const salt = randomSalt();
  const next = await deriveKey(passphrase, salt, PIN_KDF.iterations, { extractable: true });
  const old = { key, salt: meta.salt, iterations: meta.iterations, manifest, dirty: meta.dirty, version: meta.version };
  key = next;
  meta.salt = salt;
  meta.iterations = PIN_KDF.iterations;
  manifest = null; // todas as partes são enviadas de novo, com a chave nova
  meta.dirty = true;
  try {
    await push();
    // outro aparelho salvou no meio (push caiu no pull): a troca não foi aceita
    if (meta.dirty || meta.version === old.version) throw new CloudError('Outro aparelho salvou ao mesmo tempo. A frase NÃO foi trocada; tente de novo.');
  } catch (err) {
    // Volta tudo para a frase antiga: ela continua valendo
    key = old.key; meta.salt = old.salt; meta.iterations = old.iterations; manifest = old.manifest; meta.dirty = old.dirty;
    throw err;
  }
  try { await http(`/rest/v1/${T.versions}?user_id=eq.${uid()}&version=lt.${meta.version}`, { method: 'DELETE' }); } catch { /* ignora */ }
  await persistAuth();
  collectGarbage().catch(() => {});
}

// ---------- Anexos (Supabase Storage) ----------

const objectPath = (id) => `/storage/v1/object/${BUCKET}/${uid()}/${encodeURIComponent(id)}`;

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
  /** Há alterações ainda não enviadas? (os dados só existem na memória) */
  get unsent() { return Boolean(meta.dirty); },

  /** Requisição autenticada (usada por push.js, aparelhos etc.). */
  request: (path, opts) => http(path, opts),

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setConfig({ url, anonKey }) {
    const clean = { url: String(url || '').trim().replace(/\/+$/, ''), anonKey: String(anonKey || '').trim() };
    // A política de segurança do app (CSP em index.html) só deixa conectar em *.supabase.co
    if (!/^https:\/\/[\w-]+\.supabase\.co$/.test(clean.url)) throw new CloudError('Use o endereço do seu projeto no Supabase. Exemplo: https://abcdefgh.supabase.co');
    if (clean.anonKey.length < 20) throw new CloudError('Chave inválida. Copie a chave "anon"/"publishable" inteira.');
    const changed = clean.url !== readConfig().url;
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(clean)); } catch { throw new CloudError('O navegador não deixou guardar a configuração (armazenamento bloqueado).'); }
    if (changed && session) { this.signOut({ remote: false }); return; } // a sessão era do outro servidor
    setStatus(session ? state.status : 'signedout');
  },

  setDeviceName(name) {
    saveDeviceName(name);
    meta.deviceCheck = 0;
    if (ready()) run(() => checkDevice(true));
  },

  /**
   * Abertura do app: lê o login lembrado e, se houver chave, baixa os
   * dados da nuvem (lança erro se não conseguir — ex.: sem internet).
   * Sem login: status 'signedout'; com login mas sem a frase: 'locked'.
   */
  async init({ open = true } = {}) {
    await loadAuth();
    if (!this.configured) return setStatus('off');
    if (!session) return setStatus('signedout');
    if (!key || !open) return setStatus('locked');
    return this.resume();
  },

  /** Login lembrado: baixa os dados da conta e começa a sincronizar. */
  async resume() {
    setStatus('syncing');
    try {
      const row = await fetchRow();
      if (!row) return await this.link('local', null, null); // conta ainda sem dados
      const { remote, man, damaged } = await openRemote(row);
      if (!remote) throw new CloudError('Os dados da nuvem estão incompletos. Entre de novo com a frase secreta para recuperá-los.');
      manifest = man;
      repairOnLink = damaged;
      if (damaged) notify(REPAIRED_NOTICE);
      return await this.link('cloud', remote, row.version);
    } catch (err) {
      if (err.badKey) {
        key = null;
        await persistAuth();
        return setStatus('locked', 'A frase secreta foi trocada em outro aparelho. Digite a frase nova.');
      }
      setStatus(err.offline ? 'offline' : err.paused ? 'paused' : session ? 'error' : 'signedout', err.message);
      throw err;
    }
  },

  async signIn(email, password) {
    const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
    if (meta.userId && meta.userId !== s.user?.id) await this.forgetLink(); // outra conta: começa do zero
    await saveSession(s);
    meta.userId = s.user?.id;
    await rejoinDevice();
    await saveMeta();
    setStatus('locked');
  },

  /** → { needsConfirm } */
  async signUp(email, password) {
    const back = encodeURIComponent(`${location.origin}${location.pathname}`);
    const s = await http(`/auth/v1/signup?redirect_to=${back}`, { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
    if (!s?.access_token) return { needsConfirm: true };
    if (meta.userId && meta.userId !== s.user?.id) await this.forgetLink();
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
    if (meta.userId && meta.userId !== user?.id) await this.forgetLink();
    await saveSession({ ...recovery, expires_in: Number(recovery.expires_in) || 3600, user });
    meta.userId = user?.id;
    await rejoinDevice();
    await saveMeta();
    setStatus('locked');
  },

  /** Esquece a chave e as cópias de trabalho (a sessão continua). */
  async forgetLink() {
    key = null; manifest = null; upgradePass = null; repairOnLink = false;
    meta = { ...EMPTY_META, remember: meta.remember, userId: meta.userId };
    mem.clear();
    state.conflicts = 0;
    await persistAuth();
  },

  /** Há dados desta conta na nuvem? → { exists, updatedAt, device } */
  async remoteInfo() {
    const row = await fetchRow();
    return row ? { exists: true, updatedAt: row.updated_at, device: row.device, salt: row.data?.salt } : { exists: false };
  },

  /**
   * Define (conta nova) ou confere a frase secreta e abre os dados da nuvem.
   * remember: 'session' | '30d' | 'always' (por quanto tempo lembrar o login)
   * → { remote: dadosDaNuvem | null, version, damaged }
   */
  async unlock(passphrase, { remember = 'always' } = {}) {
    if (String(passphrase).length < 8) throw new CloudError('A frase secreta precisa ter pelo menos 8 caracteres.');
    const row = await fetchRow();
    const salt = row?.data?.salt || randomSalt();
    const iterations = row ? (row.data?.it || LEGACY_PASS_ITERATIONS) : PIN_KDF.iterations;
    const k = await deriveKey(passphrase, salt, iterations, { extractable: true });
    let remote = null;
    let man = null;
    let damaged = false;
    if (row) {
      key = k;
      try {
        ({ remote, man, damaged } = await openRemote(row));
      } catch (err) {
        key = null;
        if (err.badKey) throw new CloudError('Frase secreta incorreta. É a mesma que você criou ao começar a usar a nuvem.');
        throw err;
      }
    }
    key = k;
    meta.salt = salt;
    meta.iterations = iterations;
    meta.remember = ['session', '30d', 'always'].includes(remember) ? remember : 'always';
    meta.rememberUntil = meta.remember === '30d' ? Date.now() + 30 * 86_400_000 : null;
    manifest = man;
    repairOnLink = damaged;
    upgradePass = row && iterations < PIN_KDF.iterations ? String(passphrase) : null;
    await persistAuth();
    return { remote, version: row?.version ?? null, damaged };
  },

  /** Muda por quanto tempo o login fica lembrado neste aparelho. */
  async setRemember(remember) {
    meta.remember = ['session', '30d', 'always'].includes(remember) ? remember : 'always';
    meta.rememberUntil = meta.remember === '30d' ? Date.now() + 30 * 86_400_000 : null;
    await persistAuth();
  },

  /**
   * Abre a conta neste aparelho e começa a sincronizar.
   * choice: 'cloud' (usa os dados da nuvem) | 'local' (envia `data` — ex.:
   * os dados que uma versão anterior guardava no aparelho — ou começa do zero)
   */
  async link(choice, data, version) {
    meta.linked = true;
    setStatus('syncing'); // sai de "falta a frase" antes de abrir os dados
    meta.version = version;
    const saved = rescue && rescue.userId === meta.userId ? rescue : null;
    rescue = null;
    if (choice === 'cloud' && data && saved) {
      // Havia alterações não enviadas quando a conta fechou: junta item a item com a nuvem
      const base = saved.base || data;
      const { state: merged, conflicts } = mergeWithConflicts(base, saved.local, data);
      store.open(merged);
      saveBase(data);
      meta.dirty = true;
      meta.pending = 1;
      if (conflicts.length) await addConflicts(conflicts, 'outro aparelho');
      notify('As alterações que ainda não tinham subido foram juntadas com a nuvem.');
    } else if (choice === 'cloud' && data) {
      store.open(data);
      saveBase(data);
      meta.dirty = repairOnLink; // faltavam partes na nuvem: reenvia todas
      meta.pending = 0;
      meta.lastSync = Date.now();
    } else {
      forceLocal = choice === 'local' && Boolean(data);
      store.open(data || null);
      memSet('cloud:base', undefined);
      meta.dirty = true; // sobrescreve a versão atual da nuvem
      meta.pending = 1;
      manifest = null; // envia todas as partes
    }
    repairOnLink = false;
    await persistAuth();
    await start();
  },

  syncNow() { return run(() => (meta.dirty ? push() : pull())); },

  /** Envia agora o que estiver pendente (antes de sair da conta, por exemplo). */
  async flush() {
    clearTimeout(pushTimer);
    if (ready() && meta.dirty) await run(push);
    return !meta.dirty;
  },

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
      try { await openManifest(row.data, check, { userId: uid(), version: row.version }); } catch { throw new CloudError('A frase secreta atual está incorreta.'); }
    }
    return serial(() => rekeyCloud(next));
  },

  // ---------- Anexos ----------

  /** Envia um arquivo já cifrado (bytes) para o Storage. */
  async putFile(id, bytes) {
    if (!session) throw new CloudError('Entre na sua conta para anexar arquivos.');
    await http(objectPath(id), { method: 'POST', raw: true, body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' } });
  },

  /** Baixa um arquivo (bytes ainda cifrados). */
  async getFile(id) {
    return new Uint8Array(await http(objectPath(id), { raw: true }));
  },

  async deleteFile(id) {
    await http(objectPath(id), { method: 'DELETE' });
  },

  // ---------- Histórico de versões ----------

  async listVersions() {
    const rows = await http(`/rest/v1/${T.versions}?select=version,device,created_at&user_id=eq.${uid()}&order=version.desc&limit=${KEEP_VERSIONS}`);
    return rows || [];
  },

  /** Estado de uma versão antiga (para pré-visualizar ou restaurar). */
  async loadVersion(version) {
    const rows = await http(`/rest/v1/${T.versions}?select=manifest&user_id=eq.${uid()}&version=eq.${Number(version)}`);
    if (!rows?.[0]) throw new CloudError('Versão não encontrada.');
    const man = await openManifest(rows[0].manifest, key, { userId: uid(), version: Number(version) });
    const { state: old } = await loadManifest(man, memGet('cloud:base'));
    assertSchema(old);
    return old;
  },

  /** Restaura uma versão: vira uma alteração nova (as outras versões continuam no histórico). */
  async restoreVersion(version) {
    const old = await this.loadVersion(version);
    await store.replace(old);
    meta.dirty = true;
    return this.syncNow();
  },

  // ---------- Conflitos ----------

  async conflicts() { return memGet('cloud:conflicts') || []; },

  /** choice: 'local' (volta a minha versão) | 'remote' (mantém a da nuvem, que já está valendo) */
  async resolveConflict(id, choice) {
    const list = await this.conflicts();
    const c = list.find((x) => x.id === id);
    if (!c) return;
    if (choice === 'local') {
      const fields = (c.fields || []).filter((x) => x && x !== '(valor)');
      store.commit((d) => {
        if (c.local != null && c.remote != null && fields.length) {
          // Só os campos que mudaram nos dois: o resto do item fica como veio da nuvem
          for (const fld of fields) {
            const sub = fld.split('.');
            const value = sub.reduce((o, k) => (o == null ? undefined : o[k]), c.local);
            setAtPath(d, [...c.path, ...sub], value === undefined ? null : structuredClone(value));
          }
        } else {
          setAtPath(d, c.path, c.local == null ? null : structuredClone(c.local));
        }
      });
    }
    const rest = list.filter((x) => x.id !== id);
    memSet('cloud:conflicts', rest);
    state.conflicts = rest.length;
    setStatus(state.status, state.error);
  },

  async clearConflicts() {
    memSet('cloud:conflicts', []);
    state.conflicts = 0;
    setStatus(state.status, state.error);
  },

  /** Cópias completas guardadas nesta sessão (até 3, mais nova primeiro): [{ at, origin, data }] */
  async conflictBackups() { return conflictCopies(memGet('cloud:conflict')); },
  /** A cópia mais recente (ou undefined). */
  async conflictBackup() { return (await this.conflictBackups())[0]; },
  /** Descarta uma cópia (pelo `at`) ou todas (sem argumento). */
  async clearConflict(at) {
    const rest = at == null ? [] : (await this.conflictBackups()).filter((c) => c.at !== at);
    return memSet('cloud:conflict', rest.length ? rest : undefined);
  },

  // ---------- Aparelhos ----------

  async listDevices() {
    const rows = await http(`/rest/v1/${T.devices}?select=device_id,name,app_version,last_seen,revoked&user_id=eq.${uid()}&order=last_seen.desc`);
    return (rows || []).map((r) => ({ ...r, current: r.device_id === deviceId() }));
  },

  /**
   * Desconecta um aparelho: marca no banco (ele sai da nuvem na próxima
   * sincronização) e ENCERRA as sessões dos outros aparelhos no
   * Supabase — sem isso, o aparelho desconectado ainda teria um token
   * válido. Os aparelhos que continuam precisam entrar de novo.
   */
  async revokeDevice(id) {
    await http(`/rest/v1/${T.devices}?user_id=eq.${uid()}&device_id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { revoked: true } });
    await this.signOutOthers();
  },

  async forgetDevice(id) {
    await http(`/rest/v1/${T.devices}?user_id=eq.${uid()}&device_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  /**
   * Sai da conta: os dados saem da memória (o app volta para o exemplo)
   * e o login lembrado é apagado. Na nuvem, nada muda.
   */
  async signOut({ remote = true } = {}) {
    // Os lembretes push eram desta conta: este aparelho deixa de recebê-los
    if (session && remote) { try { await (await import('./push.js')).disablePush(); } catch { /* sem push */ } }
    rescue = null;
    forceLocal = false;
    clearTimeout(pushTimer);
    clearInterval(pollTimer);
    realtime?.stop();
    realtime = null;
    try { if (session && remote) await http('/auth/v1/logout', { method: 'POST' }); } catch { /* ignora */ }
    session = null;
    await this.forgetLink();
    meta.userId = null;
    writeAuth(null);
    store.close();
    setStatus(this.configured ? 'signedout' : 'off');
  },
};
