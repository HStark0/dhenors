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

import { loadState, saveState, clearState, getItem, setItem } from './storage.js';
import { createEmptyState, sanitizeState, SCHEMA_VERSION } from '../domain/schema.js';
import { currentYM } from './dates.js';
import { deriveKey, encryptJSON, decryptJSON, isEnvelope, randomSalt, PIN_KDF, LEGACY_ITERATIONS } from './crypto.js';

/**
 * Itens auxiliares que guardam dados financeiros (ou acesso a eles) e,
 * por isso, são criptografados com o PIN quando ele está ligado.
 */
export const SECURE_KEYS = ['cloud:base', 'cloud:manifest', 'cloud:conflict', 'cloud:conflicts', 'cloud:session', 'cloud:keyraw', 'errors:log'];

const listeners = new Set();
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('dhenors') : null;
channel?.unref?.(); // no Node (testes) não segura o processo aberto

let saveTimer = null;
let savePromise = Promise.resolve();

// Chave da criptografia (só na memória, nunca salva)
//   kind: 'pin' (só números, teclado na tela) | 'password' (letras e números)
const security = { key: null, salt: null, iterations: 0, kind: 'pin' };

const rekeyHooks = [];

/** Pilha de "desfazer" (só na memória): [{ label, before, version }] */
const undoStack = [];
const UNDO_MAX = 20;

export const store = {
  data: null,
  locked: false,      // true = dados criptografados aguardando o PIN
  version: 0,         // muda a cada alteração (cache de cálculos)
  envelope: null,
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
      this.data = normalize(saved);
    } else {
      this.data = createEmptyState();
      await saveState(this.data);
    }

    channel?.addEventListener('message', async (ev) => {
      if (ev.data !== 'changed' || this.locked) return;
      const fresh = await loadState();
      if (!fresh) return;
      if (isEnvelope(fresh)) {
        if (!security.key) return;
        try { this.data = normalize(await decryptJSON(fresh, security.key)); } catch { return; }
      } else {
        this.data = normalize(fresh);
      }
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
    this.data = normalize(data);
    this.locked = false;
    this.envelope = null;
    this.version++;
    // Proteção antiga (250 mil iterações): regrava com a atual sem pedir nada
    if (iterations < PIN_KDF.iterations) await this.setPin(secret, security.kind);
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
    this.data = normalize(data);
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
    const plain = await readSecureItems();
    const oldKey = security.key;
    security.salt = randomSalt();
    security.iterations = PIN_KDF.iterations;
    security.kind = kind === 'password' ? 'password' : 'pin';
    security.key = await deriveKey(secret, security.salt, security.iterations, { extractable: true });
    await this.flush();
    await writeSecureItems(plain);
    for (const fn of rekeyHooks) { try { await fn(oldKey, security.key); } catch (err) { console.error('[store] rekey', err); } }
    emit('security');
  },

  /** Desativa o PIN: volta a salvar sem criptografia. */
  async removePin() {
    const plain = await readSecureItems();
    const oldKey = security.key;
    Object.assign(security, { key: null, salt: null, iterations: 0, kind: 'pin' });
    await this.flush();
    await writeSecureItems(plain);
    for (const fn of rekeyHooks) { try { await fn(oldKey, null); } catch (err) { console.error('[store] rekey', err); } }
    emit('security');
  },

  /** Registra quem precisa recifrar dados próprios quando o PIN muda (ex.: anexos). */
  onRekey(fn) { rekeyHooks.push(fn); },

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

  /** Dados vindos da nuvem: substitui o estado sem gerar um novo envio. */
  async applyRemote(raw) {
    this.data = normalize(raw);
    this.version++;
    undoStack.length = 0;
    await flush(this.data);
    emit('remote');
  },

  /** Troca o estado inteiro (importação de backup). */
  async replace(rawState) {
    this.data = sanitizeState(rawState);
    this.version++;
    undoStack.length = 0;
    await flush(this.data);
    emit('replace');
  },

  async reset() {
    await clearState();
    for (const k of SECURE_KEYS) await setItem(k, undefined);
    Object.assign(security, { key: null, salt: null, iterations: 0, kind: 'pin' });
    this.data = createEmptyState();
    this.version++;
    undoStack.length = 0;
    await flush(this.data);
    emit('replace');
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

async function writeSecureItems(plain) {
  for (const [k, v] of Object.entries(plain)) if (v !== undefined) await store.setSecure(k, v);
}

function normalize(saved) {
  try {
    return saved.schema === SCHEMA_VERSION ? saved : sanitizeState(saved);
  } catch (err) {
    console.error('[store] Estado salvo inválido; começando do zero.', err);
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
  if (!data) return savePromise;
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
globalThis.addEventListener?.('pagehide', () => { if (store.data) store.flush(); });
