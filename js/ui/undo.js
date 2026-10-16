// =============================================================
// undo.js — "Desfazer" por fotografia do estado
// -------------------------------------------------------------
// Para ações que não guardam o próprio desfazer (ex.: marcar como
// paga, que muda data, valor e conta de uma vez): guarda o estado de
// ANTES e, no "Desfazer", volta exatamente para ele — desde que nada
// tenha mudado depois (senão perderia as alterações seguintes).
// O estado é imutável (store.commit trabalha numa cópia), então
// guardar a referência basta.
// =============================================================

import { store } from '../core/store.js';
import { toast, toastError } from './toast.js';

/**
 * Executa `run` e devolve { result, restore }. restore() volta o
 * estado ao que era antes de `run` (lança erro se houve outra
 * alteração no meio).
 */
export function withSnapshot(run) {
  const before = store.data;
  const result = run();
  const after = store.version;
  const restore = () => {
    if (store.version !== after) throw new Error('Não dá para desfazer: houve outras alterações depois.');
    const copy = structuredClone(before);
    store.commit((d) => {
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, copy);
    });
  };
  return { result, restore };
}

/**
 * Executa `run` e mostra `message` com "Desfazer" que restaura o
 * estado anterior. Erros de `run` viram aviso de erro.
 */
export function runWithUndo(run, message, { type = 'success' } = {}) {
  let snap;
  try { snap = withSnapshot(run); } catch (err) { toastError(err.message || 'Não foi possível.'); return undefined; }
  toast(message, { type, action: { label: 'Desfazer', run: () => { snap.restore(); toast('Desfeito.', { type: 'info' }); } } });
  return snap.result;
}
