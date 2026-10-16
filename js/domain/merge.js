// @ts-check
// =============================================================
// merge.js — Junta mudanças feitas em dois aparelhos (merge de 3 vias)
// -------------------------------------------------------------
// base   = última versão que os dois aparelhos tinham em comum
// local  = como está neste aparelho
// remote = como está na nuvem (salvo por outro aparelho)
//
// Regras, campo a campo:
//  • mudou só de um lado → fica essa mudança
//  • listas com `id` (contas, parcelas, metas…) → junta item a item:
//    itens novos dos dois lados entram; item apagado de um lado e não
//    alterado do outro sai; alterado dos dois lados → campo a campo
//  • listas de valores simples (parcelas pagas, etiquetas) → conjunto
//    de 3 vias: o que um lado tirou sai, o que um lado pôs entra
//  • chaves de objeto (pagamentos de recorrentes, faturas pagas…)
//    apagadas de um lado e não alteradas do outro saem
//  • mudou dos dois lados no mesmo valor simples → fica o da nuvem,
//    MAS a mudança deste aparelho é registrada como CONFLITO, para
//    você escolher depois (tela "Conflitos" na Nuvem). Nada some
//    sem aviso.
// =============================================================

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (item) => (isObj(item) ? item.id ?? item.from ?? null : null);
const isKeyedList = (...lists) => lists.every((l) => Array.isArray(l) && l.every((x) => keyOf(x) != null))
  && lists.some((l) => l.length);

/**
 * Contexto do merge: caminho atual e conflitos encontrados.
 * conflito = { path: ['expenses', 'abc', 'cents'], itemPath: ['expenses','abc'], local, remote, localItem, remoteItem }
 */
function ctx() { return { path: [], item: null, conflicts: [] }; }

function mergeList(base, local, remote, c) {
  const b = new Map((base || []).map((x) => [keyOf(x), x]));
  const l = new Map(local.map((x) => [keyOf(x), x]));
  const r = new Map(remote.map((x) => [keyOf(x), x]));
  const out = [];
  const take = (k) => {
    const inL = l.has(k);
    const inR = r.has(k);
    const inB = b.has(k);
    if (inL && inR) {
      const prevItem = c.item;
      c.path.push(k);
      c.item = { path: [...c.path], local: l.get(k), remote: r.get(k) };
      const merged = merge(b.get(k), l.get(k), r.get(k), c);
      c.item = prevItem;
      c.path.pop();
      return merged;
    }
    if (inL && !inR) {
      // apagado na nuvem? só sai se aqui não foi alterado
      if (inB && same(l.get(k), b.get(k))) return undefined;
      if (inB) c.conflicts.push({ kind: 'deleted-remote', path: [...c.path, k], itemPath: [...c.path, k], local: l.get(k), remote: null, localItem: l.get(k), remoteItem: null });
      return l.get(k);
    }
    if (!inL && inR) {
      if (inB && same(r.get(k), b.get(k))) return undefined; // apagado aqui
      // apagado aqui mas alterado na nuvem: fica a nuvem, e a exclusão vira conflito (dá para refazer)
      if (inB) c.conflicts.push({ kind: 'deleted-local', path: [...c.path, k], itemPath: [...c.path, k], local: null, remote: r.get(k), localItem: null, remoteItem: r.get(k) });
      return r.get(k);
    }
    return undefined;
  };
  const seen = new Set();
  for (const k of [...r.keys(), ...l.keys()]) {
    if (seen.has(k)) continue;
    seen.add(k);
    const v = take(k);
    if (v !== undefined) out.push(v);
  }
  return out;
}

/**
 * Listas de valores simples (ex.: parcelas pagas [1, 2, 3]) como
 * CONJUNTOS, olhando a base: o que um lado tirou sai (desmarcar uma
 * parcela não volta sozinha) e o que um lado pôs entra.
 */
function mergeSet(base, local, remote) {
  const b = new Set(base);
  const l = new Set(local);
  const r = new Set(remote);
  const keep = (x) => (b.has(x) ? l.has(x) && r.has(x) : true);
  return [...new Set([...remote, ...local])].filter(keep);
}

function mergeObject(base, local, remote, c) {
  const out = {};
  const b = base || {};
  for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const inL = k in local;
    const inR = k in remote;
    c.path.push(k);
    if (inL && inR) out[k] = merge(b[k], local[k], remote[k], c);
    else if (inL) { if (!(k in b) || !same(local[k], b[k])) out[k] = local[k]; } else if (!(k in b) || !same(remote[k], b[k])) out[k] = remote[k];
    c.path.pop();
  }
  return out;
}

export function merge(base, local, remote, c = ctx()) {
  if (same(local, remote)) return remote;
  if (base !== undefined && same(local, base)) return remote; // só a nuvem mudou
  if (base !== undefined && same(remote, base)) return local; // só este aparelho mudou
  if (isKeyedList(local, remote)) return mergeList(Array.isArray(base) ? base : [], local, remote, c);
  if (Array.isArray(local) && Array.isArray(remote) && [...local, ...remote].every((x) => typeof x !== 'object')) {
    return mergeSet(Array.isArray(base) ? base : [], local, remote); // ex.: parcelas pagas, etiquetas, impressões de importação
  }
  if (isObj(local) && isObj(remote)) return mergeObject(isObj(base) ? base : {}, local, remote, c);
  // Mudou dos dois lados: fica a nuvem, mas registra o conflito
  if (base !== undefined && !(c.path[c.path.length - 1] === 'updatedAt')) {
    c.conflicts.push({
      kind: 'changed-both', path: [...c.path], itemPath: c.item?.path || [...c.path],
      local, remote, localItem: c.item?.local ?? local, remoteItem: c.item?.remote ?? remote,
    });
  }
  return remote;
}

/** Junta dois estados do app. */
export function mergeStates(base, local, remote) {
  return mergeWithConflicts(base, local, remote).state;
}

/**
 * Junta e devolve também os conflitos, agrupados por item:
 * → { state, conflicts: [{ id, collection, key, path, fields, local, remote }] }
 */
export function mergeWithConflicts(base, local, remote) {
  const c = ctx();
  const out = merge(base, local, remote, c);
  out.updatedAt = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || new Date().toISOString();
  const byItem = new Map();
  for (const x of c.conflicts) {
    const id = x.itemPath.join('/');
    const entry = byItem.get(id) || {
      id, collection: String(x.itemPath[0]), key: x.itemPath.length > 1 ? x.itemPath[x.itemPath.length - 1] : null,
      path: x.itemPath, kind: x.kind, fields: [], local: x.localItem, remote: x.remoteItem,
    };
    if (x.kind === 'changed-both') entry.fields.push(x.path.slice(x.itemPath.length).join('.') || '(valor)');
    byItem.set(id, entry);
  }
  return { state: out, conflicts: [...byItem.values()] };
}

/** Lê/escreve um valor no estado por caminho (ids nas listas). */
export function getAtPath(state, path) {
  let cur = state;
  for (const k of path) {
    if (Array.isArray(cur)) cur = cur.find((x) => keyOf(x) === k);
    else cur = cur?.[k];
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function setAtPath(state, path, value) {
  let cur = state;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    cur = Array.isArray(cur) ? cur.find((x) => keyOf(x) === k) : cur[k];
    if (cur == null) return false;
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) {
    const i = cur.findIndex((x) => keyOf(x) === last);
    if (value == null) { if (i >= 0) cur.splice(i, 1); } else if (i >= 0) cur[i] = value; else cur.push(value);
  } else if (value === undefined) delete cur[last];
  else cur[last] = value;
  return true;
}
