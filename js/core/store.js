// =============================================================
// store.js — Estado central do app (só na memória)
// -------------------------------------------------------------
// • `store.data` é o estado (ver domain/schema.js). Ele NÃO é salvo
//   no navegador: vem da nuvem ao entrar (core/cloud.js) e cada
//   alteração volta para a nuvem, criptografada, logo em seguida.
// • Sem login (visitante), `store.data` é um exemplo e `store.guest`
//   fica true: dá para ver todas as telas, mas qualquer alteração
//   pede para entrar (GuestError + evento "dhenors:need-login").
// • `store.ui` é o estado da tela (mês exibido, filtros).
// • Toda alteração passa por `store.commit()`, que avisa as telas
//   (e a nuvem) para redesenhar/enviar.
// • `store.version` aumenta a cada alteração: cálculos pesados são
//   guardados em cache por versão (core/memo.js).
// • Desfazer: commits com `undo` guardam o estado anterior; store.undo()
//   volta, desde que nada tenha mudado depois.
// =============================================================

import { createEmptyState, sanitizeState, SCHEMA_VERSION } from '../domain/schema.js';
import { createSampleState } from '../domain/sample.js';
import { currentYM } from './dates.js';

/** Dados (da nuvem ou de um backup) de uma versão MAIS NOVA do app. */
export class SchemaTooNewError extends Error {
  constructor(message = 'Estes dados foram salvos por uma versão mais nova do Dhenors. Atualize o app.') {
    super(message);
    this.name = 'SchemaTooNewError';
  }
}

/** Alteração tentada sem login: a tela de entrar é aberta. */
export class GuestError extends Error {
  constructor(message = 'Entre na sua conta para salvar alterações.') {
    super(message);
    this.name = 'GuestError';
  }
}

/** Alterações que valem também para o visitante (só aparência, nada é salvo). */
const GUEST_OK = new Set(['appearance', 'silent']);

const listeners = new Set();

/** Pilha de "desfazer": [{ label, before, version }] */
const undoStack = [];
const UNDO_MAX = 20;

export const store = {
  data: null,
  version: 0,         // muda a cada alteração (cache de cálculos)
  /** true = sem login: dados de exemplo, nada é salvo. */
  guest: true,
  /**
   * Aviso quando os dados NÃO podem ser alterados (ex.: a nuvem tem
   * dados de uma versão mais nova do app). Nada é enviado.
   */
  readOnly: null,
  ui: {
    ym: currentYM(),   // mês exibido
    filters: {},       // filtros por tela
  },

  /** Abre como visitante, com dados de exemplo. */
  init() {
    this.data = createSampleState();
    this.guest = true;
    this.version++;
  },

  /** Entrou: os dados da conta (vindos da nuvem) passam a valer. */
  open(raw) {
    this.data = normalize(raw || createEmptyState());
    this.guest = false;
    this.readOnly = null;
    this.version++;
    undoStack.length = 0;
    emit('open');
  },

  /** Saiu da conta: tira os dados da memória e volta para o exemplo. */
  close() {
    this.data = createSampleState();
    this.guest = true;
    this.readOnly = null;
    this.version++;
    undoStack.length = 0;
    emit('close');
  },

  // ---------- Alterações ----------

  /**
   * Aplica uma alteração.
   *   store.commit((data) => { data.expenses.push(x) })
   *   store.commit(fn, 'change', { undo: 'Conta excluída' }) → pode ser desfeita
   * Se a função lançar erro, nada muda e o erro sobe.
   */
  commit(mutator, reason = 'change', { undo = null } = {}) {
    if (!this.data) throw new Error('Os dados não estão abertos.');
    if (this.guest && !GUEST_OK.has(reason)) {
      globalThis.document?.dispatchEvent(new CustomEvent('dhenors:need-login'));
      throw new GuestError();
    }
    if (this.readOnly && !GUEST_OK.has(reason)) throw new Error(this.readOnly);
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
    emit('change');
    return top.label;
  },

  /**
   * Dados vindos da nuvem: substitui o estado sem gerar um novo envio.
   * Dados inválidos ou de uma versão mais nova do app LANÇAM erro e o
   * estado atual fica como está (nunca vira um estado vazio).
   */
  async applyRemote(raw) {
    if (this.guest) return; // saiu da conta durante uma sincronização: nada entra no exemplo
    if (this.readOnly) throw new Error(this.readOnly);
    this.data = normalize(raw);
    this.version++;
    undoStack.length = 0;
    emit('remote');
  },

  /** Troca o estado inteiro (backup restaurado, versão do histórico). Vai para a nuvem. */
  async replace(rawState) {
    if (this.guest) {
      globalThis.document?.dispatchEvent(new CustomEvent('dhenors:need-login'));
      throw new GuestError();
    }
    const data = sanitizeState(rawState); // lança erro se for inválido ou de versão mais nova
    this.readOnly = null;
    this.data = data;
    this.version++;
    undoStack.length = 0;
    emit('replace');
  },

  /** "Apagar todos os dados": a conta começa do zero (as versões antigas continuam no histórico da nuvem). */
  async reset() {
    await this.replace(createEmptyState());
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
};

/**
 * Valida um estado. Lança erro se for inválido ou de uma versão MAIS
 * NOVA do app — nunca troca dados de verdade por um estado vazio.
 */
function normalize(saved) {
  if (saved && Number(saved.schema) > SCHEMA_VERSION) throw new SchemaTooNewError();
  return saved.schema === SCHEMA_VERSION ? saved : sanitizeState(saved);
}

function emit(reason) {
  for (const fn of listeners) {
    try { fn(reason); } catch (err) { console.error('[store] listener falhou', err); }
  }
}
