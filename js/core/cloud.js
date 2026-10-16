// =============================================================
// cloud.js — Sincronização com a nuvem (Supabase), sem bibliotecas
// -------------------------------------------------------------
// • O app continua "local primeiro": tudo é salvo no aparelho na
//   hora e funciona offline. A nuvem recebe uma cópia logo depois.
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
// =============================================================

import { store } from './store.js';
import { getItem, setItem } from './storage.js';
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
const PUSH_DELAY = 1500;
const POLL_MS = 60_000;          // sem tempo real
const POLL_LIVE_MS = 5 * 60_000; // com tempo real (só reserva)
const KEEP_VERSIONS = 30;
const MAX_CHUNK = 4.5 * 1024 * 1024;
const PAUSE_DAYS = 7;            // projeto gratuito do Supabase pausa após 7 dias sem uso
const ORPHAN_GRACE_MS = 86_400_000; // parte sem índice só é apagada depois de 1 dia (outro aparelho pode estar no meio de um envio)
const IGNORE = new Set(['ui', 'remote', 'external', 'unlock', 'security', 'silent', 'reset', 'readonly']);

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

const randomRev = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20);
const uid = () => session.user.id;

// ---------- HTTP (com a sessão) ----------

async function http(path, { auth = true, headers = {}, ...opts } = {}) {
  if (auth) await ensureFreshToken();
  try {
    const json = await request(path, { ...opts, headers, token: auth ? session?.access_token : null });
    meta.lastContact = Date.now();
    return json;
  } catch (err) {
    if (err.status) meta.lastContact = Date.now(); // o servidor respondeu (com erro)
    throw err;
  }
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
//  • sem PIN: a chave fica como CryptoKey no IndexedDB ('cloud:key')
//  • com SENHA do app (letras e números): a chave vai cifrada por ela ('cloud:keyraw')
//  • com PIN só de números: a chave fica SÓ NA MEMÓRIA. Um PIN de 4–8
//    números pode ser testado inteiro fora do app por quem copiar o
//    navegador; guardar a chave cifrada por ele entregaria a nuvem toda
//    (inclusive o histórico). A frase é pedida de novo ao reabrir o app.

/** A frase só pode ficar na memória neste aparelho (PIN numérico)? */
const memoryOnly = () => store.pinEnabled && store.lockKind === 'pin';

async function persistKey() {
  await setItem('cloud:key', undefined);
  await store.setSecure('cloud:keyraw', undefined);
  if (!key || meta.remember === 'session') return;
  if (store.pinEnabled) {
    if (memoryOnly()) return;
    try { await store.setSecure('cloud:keyraw', toB64(await exportRawKey(key))); } catch { /* chave antiga não exportável: só na memória */ }
    return; // com PIN/senha, NUNCA grava a CryptoKey sem cifra
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
  if (raw) {
    try {
      const k = await importRawKey(fromB64(raw), true);
      // Guardada por uma versão anterior com PIN numérico: usa agora, mas apaga a cópia
      if (memoryOnly()) await store.setSecure('cloud:keyraw', undefined);
      return k;
    } catch { /* corrompido */ }
  }
  if (store.pinEnabled) { await setItem('cloud:key', undefined); return null; }
  return (await getItem('cloud:key')) || null;
}

// ---------- Linhas remotas ----------

async function fetchRow() {
  const rows = await http(`/rest/v1/${T.state}?select=version,data,updated_at,device&user_id=eq.${uid()}`);
  return rows?.[0] || null;
}

/** Última versão em comum com a nuvem (base do merge de 3 vias) — cifrada com o PIN. */
const saveBase = (data) => store.setSecure('cloud:base', structuredClone(data));

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
  meta.lastSync = Date.now();
  meta.pushes = (meta.pushes || 0) + 1;
  await store.setSecure('cloud:manifest', manifest);
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
  const base = await store.getSecure('cloud:base');
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
  if (man) await store.setSecure('cloud:manifest', man);
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
  const saved = await store.getSecure('cloud:conflict');
  await store.setSecure('cloud:conflict', addConflictCopy(saved, { at: Date.now(), origin, data: structuredClone(data) }));
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
    const rows = await http(`/rest/v1/${T.devices}?select=revoked&user_id=eq.${uid()}&device_id=eq.${encodeURIComponent(id)}`);
    if (rows?.[0]?.revoked) {
      await cloud.signOut({ remote: false });
      notify('Este aparelho foi desconectado da nuvem por outro aparelho. Os dados continuam aqui; para voltar, entre de novo.');
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

/** Modo exemplo (ui/onboarding.js): dados de mentira nunca vão para a nuvem. */
const demoMode = () => { try { return localStorage.getItem('dhenors:demo') === '1'; } catch { return false; } };

const ready = () => Boolean(session && key && meta.linked && readConfig().url && !demoMode() && !store.readOnly);

function run(fn) {
  return serial(async () => {
    try { await fn(); } catch (err) {
      if (err.tooNew) {
        // Nuvem com dados de uma versão mais nova: não aplica, não envia, não grava
        store.setReadOnly(err.message);
        notify(err.message);
        setStatus('error', err.message);
      } else if (err.paused) setStatus('paused', err.message);
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

/**
 * Recifra TUDO com uma frase (nova ou a mesma) num sal novo e com as
 * iterações atuais. Os outros aparelhos vão pedir a frase de novo.
 */
async function rekeyCloud(passphrase) {
  await pull(); // garante a versão mais recente antes de recriptografar
  const salt = randomSalt();
  key = await deriveKey(passphrase, salt, PIN_KDF.iterations, { extractable: true });
  meta.salt = salt;
  meta.iterations = PIN_KDF.iterations;
  manifest = null; // todas as partes são enviadas de novo, com a chave nova
  meta.dirty = true;
  await push();
  try { await http(`/rest/v1/${T.versions}?user_id=eq.${uid()}&version=lt.${meta.version}`, { method: 'DELETE' }); } catch { /* ignora */ }
  await persistKey();
  await saveMeta();
  collectGarbage().catch(() => {});
}

// "Apagar todos os dados" / apagar após tentativas erradas: este aparelho sai da
// nuvem ANTES (sem chamar o servidor), senão o estado vazio seria enviado.
store.onReset(({ wipe = false } = {}) => cloud.signOut({ remote: false, quiet: wipe }));

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
  /** Com PIN numérico a frase só fica na memória (pede de novo ao reabrir). */
  get rememberLimited() { return memoryOnly(); },

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
    saveDeviceName(name);
    meta.deviceCheck = 0;
    if (ready()) run(() => checkDevice(true));
  },

  /** Carrega sessão/chave salvas e começa a sincronizar. */
  async init() {
    session = (await store.getSecure('cloud:session')) || null;
    meta = { ...EMPTY_META, ...((await getItem('cloud:meta')) || {}) };
    key = key || await loadKey(); // com PIN numérico a chave pode estar só na memória
    manifest = (await store.getSecure('cloud:manifest')) || null;
    state.conflicts = ((await store.getSecure('cloud:conflicts')) || []).length;
    if (!this.configured) return setStatus('off');
    if (!session) return setStatus('signedout');
    if (!key || !meta.linked) return setStatus('locked');
    if (store.readOnly) return setStatus('error', store.readOnly);

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
    await run(() => pull());
    if (upgradePass) {
      // Conta antiga (PBKDF2 com menos iterações): recifra tudo com a proteção atual
      const p = upgradePass;
      upgradePass = null;
      await run(() => rekeyCloud(p));
    }
    return undefined;
  },

  async signIn(email, password) {
    const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: String(email).trim(), password } });
    await saveSession(s);
    if (meta.userId && meta.userId !== s.user?.id) await this.forgetLink(); // outra conta: começa do zero
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
    await rejoinDevice();
    await saveMeta();
    await this.init();
  },

  async forgetLink() {
    key = null; manifest = null; upgradePass = null;
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
    let damaged = false;
    if (row) {
      key = k;
      try {
        ({ remote, man } = await readRemote(row, null));
      } catch (err) {
        if (!err.missing) {
          key = null;
          if (err.badKey) throw new CloudError('Frase secreta incorreta. É a mesma que você criou no primeiro aparelho.');
          throw err;
        }
        // A frase está certa (o índice abriu), mas faltam partes na nuvem.
        // Aparelho já ligado: a sincronização completa com os dados dele.
        // Aparelho novo: usa o histórico de versões e, sem cópia, segue sem aquela parte.
        damaged = true;
        if (meta.linked) {
          meta.dirty = true; // mesmo sem mudanças locais, reenvia todas as partes
          await store.setSecure('cloud:manifest', undefined);
        } else {
          ({ remote } = await readRemote(row, null, { fill: historyFill(), partial: true }));
          if (remote?.schema == null) remote = null; // sem a parte "meta" não há o que aproveitar
        }
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
    await persistKey();
    await saveMeta();
    return { remote, version: row?.version ?? null, damaged };
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
      meta.dirty = repairOnLink; // faltavam partes na nuvem: reenvia todas
      meta.lastSync = Date.now();
    } else {
      meta.version = version; // sobrescreve a versão atual da nuvem
      meta.dirty = true;
      manifest = null; // reenvia todas as partes
    }
    if (!manifest) await store.setSecure('cloud:manifest', undefined); // init() não pode trazer um índice antigo de volta
    repairOnLink = false;
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
      try { await openManifest(row.data, check, { userId: uid(), version: row.version }); } catch { throw new CloudError('A frase secreta atual está incorreta.'); }
    }
    return serial(() => rekeyCloud(next));
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
    const { state: old } = await loadManifest(man, await store.getSecure('cloud:base'));
    assertSchema(old);
    return old;
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

  /** Cópias completas guardadas (até 3, mais nova primeiro): [{ at, origin, data }] */
  async conflictBackups() { return conflictCopies(await store.getSecure('cloud:conflict')); },
  /** A cópia mais recente (ou undefined). */
  async conflictBackup() { return (await this.conflictBackups())[0]; },
  /** Descarta uma cópia (pelo `at`) ou todas (sem argumento). */
  async clearConflict(at) {
    const rest = at == null ? [] : (await this.conflictBackups()).filter((c) => c.at !== at);
    return store.setSecure('cloud:conflict', rest.length ? rest : undefined);
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

  /** quiet: sem avisar as telas (dados sendo apagados). */
  async signOut({ remote = true, quiet = false } = {}) {
    clearTimeout(pushTimer);
    clearInterval(pollTimer);
    realtime?.stop();
    realtime = null;
    try { if (session && remote) await http('/auth/v1/logout', { method: 'POST' }); } catch { /* ignora */ }
    await saveSession(null);
    await this.forgetLink();
    await saveMeta();
    if (!quiet) setStatus(this.configured ? 'signedout' : 'off');
  },
};
