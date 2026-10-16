// =============================================================
// store.js — Estado central do app
// -------------------------------------------------------------
// • `store.data` é o estado salvo (ver domain/schema.js).
// • `store.ui` é o estado da tela (mês exibido, filtros) — não é salvo.
// • Toda alteração passa por `store.commit()`, que salva no
//   navegador e avisa as telas para redesenhar.
// • Outras abas abertas são avisadas via BroadcastChannel.
// • Com PIN (ou senha) ativado, o que vai para o navegador é
//   CRIPTOGRAFADO (AES-GCM, ver core/crypto.js) e o app abre
//   bloqueado. Isso vale também para as cópias auxiliares (base e
//   conflitos da nuvem, sessão, desfazer, registro de erros…): ver
//   getSecure/setSecure e SECURE_KEYS.
// • `store.version` aumenta a cada alteração: cálculos pesados são
//   guardados em cache por versão (core/memo.js).
// • Desfazer: commits com `undo` guardam o estado anterior; store.undo()
//   volta, desde que nada tenha mudado depois.
// =============================================================

import { loadState, saveState, clearState, getItem, setItem, saveAtomic, removeItems } from './storage.js';
import { createEmptyState, sanitizeState, SCHEMA_VERSION } from '../domain/schema.js';
import { currentYM } from './dates.js';
import { deriveKey, encryptJSON, decryptJSON, isEnvelope, randomSalt, PIN_KDF, LEGACY_ITERATIONS } from './crypto.js';

/**
 * Itens auxiliares que guardam dados financeiros (ou acesso a eles) e,
 * por isso, são criptografados com o PIN quando ele está ligado.
 */
export const SECURE_KEYS = ['cloud:base', 'cloud:manifest', 'cloud:conflict', 'cloud:conflicts', 'cloud:session', 'cloud:keyraw', 'errors:log', 'state:corrupt'];

/**
 * Itens auxiliares NÃO cifrados pelo PIN que também precisam sumir ao
 * apagar os dados: chave da nuvem sem PIN, estado da sincronização e a
 * cópia da chave do PIN guardada pela biometria.
 */
export const LOCAL_KEYS = ['cloud:key', 'cloud:meta', 'biometric:meta'];

/** Dados (da nuvem, de um backup ou deste aparelho) de uma versão MAIS NOVA do app. */
export class SchemaTooNewError extends Error {
  constructor(message = 'Estes dados foram salvos por uma versão mais nova do Dhenors. Atualize o app.') {
    super(message);
    this.name = 'SchemaTooNewError';
  }
}

const listeners = new Set();
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('dhenors') : null;
channel?.unref?.(); // no Node (testes) não segura o processo aberto

let saveTimer = null;
let savePromise = Promise.resolve();
let wiped = false; // dados apagados (tentativas demais): nada mais é gravado até recarregar

// Chave da criptografia (só na memória, nunca salva)
//   kind: 'pin' (só números, teclado na tela) | 'password' (letras e números)
const security = { key: null, salt: null, iterations: 0, kind: 'pin' };

const rekeyHooks = [];
const fileRekeyHooks = [];
const resetHooks = [];

/** Pilha de "desfazer" (só na memória): [{ label, before, version }] */
const undoStack = [];
const UNDO_MAX = 20;

export const store = {
  data: null,
  locked: false,      // true = dados criptografados aguardando o PIN
  version: 0,         // muda a cada alteração (cache de cálculos)
  envelope: null,
  /**
   * Aviso quando os dados NÃO podem ser gravados (ex.: salvos por uma
   * versão mais nova do app). Com ele, as alterações ficam só na
   * memória e nada vai para o navegador nem para a nuvem.
   */
  readOnly: null,
  ui: {
    ym: currentYM(),   // mês exibido
    filters: {},       // filtros por tela
  },

  async init() {
    const saved = await loadState();
    if (isEnvelope(saved)) {
      this.locked = true;
      security.salt = saved.salt;
      security.kind = saved.kind === 'password' ? 'password' : 'pin';
      this.envelope = saved;
    } else if (saved) {
      this.data = await normalizeLocal(saved);
    } else {
      this.data = createEmptyState();
      await saveState(this.data);
    }

    channel?.addEventListener('message', async (ev) => {
      if (ev.data !== 'changed' || this.locked || wiped) return;
      const fresh = await loadState();
      if (!fresh) return;
      try {
        if (isEnvelope(fresh)) {
          if (!security.key) return;
          this.data = normalize(await decryptJSON(fresh, security.key));
        } else {
          this.data = normalize(fresh);
        }
      } catch { return; } // outra aba com versão mais nova ou dado inválido: mantém o que está aberto
      this.version++;
      emit('external');
    });
  },

  // ---------- PIN / senha / criptografia ----------

  get pinEnabled() { return Boolean(security.key); },
  /** 'pin' (números) ou 'password' (letras e números). Vale também com o app bloqueado. */
  get lockKind() { return security.kind; },
  /** Iterações do PBKDF2 em uso (mostra em Ajustes se a proteção é antiga). */
  get kdfIterations() { return security.iterations; },

  /** Abre os dados com o PIN/senha. Lança erro se estiver errado. */
  async unlock(secret) {
    const envelope = this.envelope || await loadState();
    const iterations = envelope.it || LEGACY_ITERATIONS;
    const key = await deriveKey(secret, envelope.salt, iterations, { extractable: true }); // extraível: a biometria guarda uma cópia cifrada
    let data;
    try { data = await decryptJSON(envelope, key); } catch { throw new Error(security.kind === 'password' ? 'Senha incorreta.' : 'PIN incorreto.'); }
    Object.assign(security, { key, salt: envelope.salt, iterations, kind: envelope.kind === 'password' ? 'password' : 'pin' });
    this.data = await normalizeLocal(data);
    this.locked = false;
    this.envelope = null;
    this.version++;
    // Proteção antiga (250 mil iterações): regrava com a atual sem pedir nada
    if (iterations < PIN_KDF.iterations && !this.readOnly) await this.setPin(secret, security.kind);
    emit('unlock');
  },

  /**
   * Abre os dados com uma chave já derivada (desbloqueio por biometria:
   * a chave vem guardada, cifrada pela digital/rosto — ver core/biometric.js).
   */
  async unlockWithKey(key, meta) {
    const envelope = this.envelope || await loadState();
    let data;
    try { data = await decryptJSON(envelope, key); } catch { throw new Error('A biometria não abriu os dados. Use o PIN.'); }
    Object.assign(security, { key, salt: envelope.salt, iterations: envelope.it || meta?.iterations || PIN_KDF.iterations, kind: envelope.kind === 'password' ? 'password' : 'pin' });
    this.data = await normalizeLocal(data);
    this.locked = false;
    this.envelope = null;
    this.version++;
    emit('unlock');
  },

  /** Confere o PIN/senha sem mexer nos dados (usado ao reabrir após bloqueio). */
  async checkPin(secret) {
    if (!security.salt) return false;
    const envelope = await loadState();
    const key = await deriveKey(secret, security.salt, envelope?.it || security.iterations || LEGACY_ITERATIONS);
    try { await decryptJSON(envelope, key); return true; } catch { return false; }
  },

  /** Chave atual (para guardar na biometria). Só existe com os dados abertos. */
  get currentKey() { return security.key; },
  get currentSalt() { return security.salt; },

  /** Ativa (ou troca) o PIN/senha: tudo passa a ser salvo criptografado. */
  async setPin(secret, kind = 'pin') {
    const salt = randomSalt();
    const next = { salt, iterations: PIN_KDF.iterations, kind: kind === 'password' ? 'password' : 'pin', key: null };
    next.key = await deriveKey(secret, salt, next.iterations, { extractable: true });
    await rekey(next);
  },

  /** Desativa o PIN: volta a salvar sem criptografia. */
  async removePin() {
    await rekey({ key: null, salt: null, iterations: 0, kind: 'pin' });
  },

  /** Registra quem precisa saber que o PIN mudou (roda DEPOIS da troca). */
  onRekey(fn) { rekeyHooks.push(fn); },

  /**
   * Registra quem guarda ARQUIVOS cifrados com a chave do PIN (anexos).
   * fn(chaveAntiga, chaveNova) → [[id, registroRecifrado], …], sem gravar:
   * os registros vão na MESMA transação do estado (tudo ou nada).
   */
  onRekeyFiles(fn) { fileRekeyHooks.push(fn); },

  /** Registra quem precisa se desligar antes de apagar os dados (ex.: nuvem). */
  onReset(fn) { resetHooks.push(fn); },

  // ---------- Itens auxiliares protegidos ----------

  /** Lê um item auxiliar; se estiver cifrado com o PIN e o app bloqueado, devolve undefined. */
  async getSecure(name) {
    const value = await getItem(name);
    if (!isEnvelope(value)) return value;
    if (!security.key) return undefined;
    try { return await decryptJSON(value, security.key); } catch { return undefined; }
  },

  /** Grava um item auxiliar, cifrado quando há PIN. `undefined` apaga. */
  async setSecure(name, value) {
    if (value === undefined) return setItem(name, undefined);
    return setItem(name, security.key ? await encryptJSON(value, security.key, security.salt, envelopeExtra()) : value);
  },

  // ---------- Alterações ----------

  /**
   * Aplica uma alteração e salva.
   *   store.commit((data) => { data.expenses.push(x) })
   *   store.commit(fn, 'change', { undo: 'Conta excluída' }) → pode ser desfeita
   * Se a função lançar erro, nada é salvo e o erro sobe.
   */
  commit(mutator, reason = 'change', { undo = null } = {}) {
    if (wiped || !this.data) throw new Error('Os dados não estão abertos.');
    // A alteração é feita numa CÓPIA: se a validação falhar no meio,
    // o estado atual continua intacto.
    const before = this.data;
    const draft = structuredClone(before);
    const result = mutator(draft);
    draft.updatedAt = new Date().toISOString();
    this.data = draft;
    this.version++;
    if (undo) {
      undoStack.push({ label: undo, before, version: this.version });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
    }
    scheduleSave(this.data);
    emit(reason);
    return result;
  },

  /** Última ação que pode ser desfeita (ou null). */
  get undoable() {
    const top = undoStack[undoStack.length - 1];
    return top && top.version === this.version ? top : null;
  },

  /**
   * Desfaz a última ação marcada com `undo`. Só funciona se nada mudou
   * depois dela (senão perderia as alterações seguintes).
   */
  undo() {
    const top = undoStack[undoStack.length - 1];
    if (!top) return false;
    if (top.version !== this.version) {
      undoStack.length = 0;
      throw new Error('Não dá para desfazer: houve outras alterações depois.');
    }
    undoStack.pop();
    this.data = { ...top.before, updatedAt: new Date().toISOString() };
    this.version++;
    scheduleSave(this.data);
    emit('change');
    return top.label;
  },

  /**
   * Dados vindos da nuvem: substitui o estado sem gerar um novo envio.
   * Dados inválidos ou de uma versão mais nova do app LANÇAM erro e o
   * estado atual fica como está (nunca vira um estado vazio).
   */
  async applyRemote(raw) {
    if (this.readOnly) throw new Error(this.readOnly);
    const data = normalize(raw);
    this.data = data;
    this.version++;
    undoStack.length = 0;
    await flush(this.data);
    emit('remote');
  },

  /** Troca o estado inteiro (importação de backup). */
  async replace(rawState) {
    const data = sanitizeState(rawState); // lança erro se for inválido ou de versão mais nova
    this.readOnly = null;
    this.data = data;
    this.version++;
    undoStack.length = 0;
    await flush(this.data);
    emit('replace');
  },

  /**
   * "Apagar todos os dados": desliga a nuvem DESTE aparelho antes (sem
   * isso, o estado vazio seria enviado e apagaria os outros aparelhos),
   * apaga tudo e começa do zero.
   */
  async reset() {
    await runResetHooks();
    await clearState();
    await removeItems([...SECURE_KEYS, ...LOCAL_KEYS]);
    Object.assign(security, { key: null, salt: null, iterations: 0, kind: 'pin' });
    this.readOnly = null;
    this.data = createEmptyState();
    this.version++;
    undoStack.length = 0;
    await flush(this.data);
    emit('reset');
  },

  /**
   * Apaga TUDO deste aparelho e não grava mais nada até recarregar a
   * página (tentativas demais na tela de bloqueio). A chave sai da
   * memória e o salvamento ao fechar a aba é desligado.
   */
  async wipe() {
    wiped = true;
    clearTimeout(saveTimer);
    await runResetHooks({ wipe: true });
    await savePromise;
    await clearState();
    await removeItems([...SECURE_KEYS, ...LOCAL_KEYS]);
    Object.assign(security, { key: null, salt: null, iterations: 0, kind: 'pin' });
    this.data = null;
    this.envelope = null;
    undoStack.length = 0;
  },

  /** Liga (texto do aviso) ou desliga (null) o modo só leitura. */
  setReadOnly(message) {
    this.readOnly = message || null;
    this.version++;
    emit('readonly');
  },

  /** Muda algo só da tela (não salva). */
  setUI(patch) {
    Object.assign(this.ui, patch);
    emit('ui');
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Garante que o último salvamento terminou. */
  flush() {
    clearTimeout(saveTimer);
    return flush(this.data);
  },
};

function envelopeExtra() {
  return { it: security.iterations, kind: security.kind };
}

/** Lê os itens protegidos com a chave atual (antes de trocar/remover o PIN). */
async function readSecureItems() {
  const out = {};
  for (const k of SECURE_KEYS) out[k] = await store.getSecure(k);
  return out;
}

/**
 * Troca a chave do PIN (ou tira o PIN): prepara TUDO cifrado com a
 * chave nova (estado, itens protegidos e anexos) e grava numa única
 * transação. Se algo falhar, nada muda e o PIN antigo continua valendo.
 */
async function rekey(next) {
  if (store.readOnly) throw new Error(store.readOnly);
  if (!store.data || wiped) throw new Error('Desbloqueie o app primeiro.');
  clearTimeout(saveTimer);
  await savePromise;
  const plain = await readSecureItems();
  const oldKey = security.key;
  const extra = { it: next.iterations, kind: next.kind };
  const seal = (v) => (next.key ? encryptJSON(v, next.key, next.salt, extra) : v);
  const items = {};
  for (const [k, v] of Object.entries(plain)) if (v !== undefined) items[k] = await seal(v);
  const files = [];
  for (const fn of fileRekeyHooks) files.push(...((await fn(oldKey, next.key)) || []));
  const state = await seal(store.data);
  await saveAtomic({ state, items, files });
  Object.assign(security, next);
  channel?.postMessage('changed');
  for (const fn of rekeyHooks) { try { await fn(oldKey, security.key); } catch (err) { console.error('[store] rekey', err); } }
  emit('security');
}

async function runResetHooks(opts = {}) {
  for (const fn of resetHooks) { try { await fn(opts); } catch (err) { console.error('[store] reset', err); } }
}

/**
 * Valida um estado. Lança erro se for inválido ou de uma versão MAIS
 * NOVA do app — nunca troca dados de verdade por um estado vazio.
 */
function normalize(saved) {
  if (saved && Number(saved.schema) > SCHEMA_VERSION) throw new SchemaTooNewError();
  return saved.schema === SCHEMA_VERSION ? saved : sanitizeState(saved);
}

/**
 * Estado salvo NESTE aparelho. Versão mais nova do app (ex.: voltou
 * para uma versão antiga): abre em modo só leitura, sem gravar nada.
 * Inválido: guarda uma cópia ('state:corrupt') antes de começar do zero.
 */
async function normalizeLocal(saved) {
  try {
    return normalize(saved);
  } catch (err) {
    if (err instanceof SchemaTooNewError) {
      store.readOnly = 'Os dados deste aparelho foram salvos por uma versão mais nova do Dhenors. Atualize o app (recarregue a página): até lá, nada é salvo nem sincronizado.';
      console.error('[store]', err.message);
    } else {
      console.error('[store] Estado salvo inválido; começando do zero (cópia guardada em state:corrupt).', err);
      try { await store.setSecure('state:corrupt', saved); } catch { /* ignora */ }
    }
    return createEmptyState();
  }
}

function emit(reason) {
  for (const fn of listeners) {
    try { fn(reason); } catch (err) { console.error('[store] listener falhou', err); }
  }
}

function scheduleSave(data) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(data), 120);
}

function flush(data) {
  if (!data || wiped || store.readOnly) return savePromise;
  savePromise = savePromise
    .then(async () => saveState(security.key ? await encryptJSON(data, security.key, security.salt, envelopeExtra()) : data))
    .then(() => channel?.postMessage('changed'))
    .catch((err) => {
      console.error('[store] Falha ao salvar', err);
      globalThis.document?.dispatchEvent(new CustomEvent('dhenors:save-error'));
    });
  return savePromise;
}

// Salva antes de fechar a aba.
globalThis.addEventListener?.('pagehide', () => { if (store.data && !wiped) store.flush(); });
