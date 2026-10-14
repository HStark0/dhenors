// =============================================================
// store.js — Estado central do app
// -------------------------------------------------------------
// • `store.data` é o estado salvo (ver domain/schema.js).
// • `store.ui` é o estado da tela (mês exibido, filtros) — não é salvo.
// • Toda alteração passa por `store.commit()`, que salva no
//   navegador e avisa as telas para redesenhar.
// • Outras abas abertas são avisadas via BroadcastChannel.
// • Com PIN ativado, o que vai para o navegador é CRIPTOGRAFADO
//   (AES-GCM, ver core/crypto.js) e o app abre bloqueado.
// =============================================================

import { loadState, saveState, clearState } from './storage.js';
import { createEmptyState, sanitizeState, SCHEMA_VERSION } from '../domain/schema.js';
import { currentYM } from './dates.js';
import { deriveKey, encryptJSON, decryptJSON, isEnvelope, randomSalt } from './crypto.js';

const listeners = new Set();
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('dhenors') : null;
channel?.unref?.(); // no Node (testes) não segura o processo aberto

let saveTimer = null;
let savePromise = Promise.resolve();

// Chave da criptografia (só na memória, nunca salva)
const security = { key: null, salt: null };

export const store = {
  data: null,
  locked: false,      // true = dados criptografados aguardando o PIN
  ui: {
    ym: currentYM(),   // mês exibido
    filters: {},       // filtros por tela
  },

  async init() {
    const saved = await loadState();
    if (isEnvelope(saved)) {
      this.locked = true;
      security.salt = saved.salt;
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
      emit('external');
    });
  },

  // ---------- PIN / criptografia ----------

  get pinEnabled() { return Boolean(security.key); },

  /** Abre os dados com o PIN. Lança erro se o PIN estiver errado. */
  async unlock(pin) {
    const envelope = this.envelope || await loadState();
    const key = await deriveKey(pin, envelope.salt);
    let data;
    try { data = await decryptJSON(envelope, key); } catch { throw new Error('PIN incorreto.'); }
    security.key = key;
    security.salt = envelope.salt;
    this.data = normalize(data);
    this.locked = false;
    this.envelope = null;
    emit('unlock');
  },

  /** Confere o PIN sem mexer nos dados (usado ao reabrir após bloqueio). */
  async checkPin(pin) {
    if (!security.salt) return false;
    const key = await deriveKey(pin, security.salt);
    const envelope = await loadState();
    try { await decryptJSON(envelope, key); return true; } catch { return false; }
  },

  /** Ativa (ou troca) o PIN: tudo passa a ser salvo criptografado. */
  async setPin(pin) {
    security.salt = randomSalt();
    security.key = await deriveKey(pin, security.salt);
    await this.flush();
    emit('security');
  },

  /** Desativa o PIN: volta a salvar sem criptografia. */
  async removePin() {
    security.key = null;
    security.salt = null;
    await this.flush();
    emit('security');
  },

  // ---------- Alterações ----------

  /**
   * Aplica uma alteração e salva.
   *   store.commit((data) => { data.expenses.push(x) })
   * Se a função lançar erro, nada é salvo e o erro sobe.
   */
  commit(mutator, reason = 'change') {
    // A alteração é feita numa CÓPIA: se a validação falhar no meio,
    // o estado atual continua intacto.
    const draft = structuredClone(this.data);
    const result = mutator(draft);
    draft.updatedAt = new Date().toISOString();
    this.data = draft;
    scheduleSave(this.data);
    emit(reason);
    return result;
  },

  /** Dados vindos da nuvem: substitui o estado sem gerar um novo envio. */
  async applyRemote(raw) {
    this.data = normalize(raw);
    await flush(this.data);
    emit('remote');
  },

  /** Troca o estado inteiro (importação de backup). */
  async replace(rawState) {
    this.data = sanitizeState(rawState);
    await flush(this.data);
    emit('replace');
  },

  async reset() {
    await clearState();
    security.key = null;
    security.salt = null;
    this.data = createEmptyState();
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
    .then(async () => saveState(security.key ? await encryptJSON(data, security.key, security.salt) : data))
    .then(() => channel?.postMessage('changed'))
    .catch((err) => {
      console.error('[store] Falha ao salvar', err);
      globalThis.document?.dispatchEvent(new CustomEvent('dhenors:save-error'));
    });
  return savePromise;
}

// Salva antes de fechar a aba.
globalThis.addEventListener?.('pagehide', () => { if (store.data) store.flush(); });
