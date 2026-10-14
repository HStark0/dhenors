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
//    alterado do outro sai; alterado dos dois lados → fica o da nuvem
//  • mudou dos dois lados no mesmo valor simples → fica o da nuvem
// =============================================================

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (item) => (isObj(item) ? item.id ?? item.from ?? null : null);
const isKeyedList = (...lists) => lists.every((l) => Array.isArray(l) && l.every((x) => keyOf(x) != null))
  && lists.some((l) => l.length);

function mergeList(base, local, remote) {
  const b = new Map((base || []).map((x) => [keyOf(x), x]));
  const l = new Map(local.map((x) => [keyOf(x), x]));
  const r = new Map(remote.map((x) => [keyOf(x), x]));
  const out = [];
  const take = (k) => {
    const inL = l.has(k);
    const inR = r.has(k);
    const inB = b.has(k);
    if (inL && inR) return merge(b.get(k), l.get(k), r.get(k));
    if (inL && !inR) {
      // apagado na nuvem? só sai se aqui não foi alterado
      if (inB && same(l.get(k), b.get(k))) return undefined;
      return l.get(k);
    }
    if (!inL && inR) {
      if (inB && same(r.get(k), b.get(k))) return undefined; // apagado aqui
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

function mergeObject(base, local, remote) {
  const out = {};
  const b = base || {};
  for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const inL = k in local;
    const inR = k in remote;
    if (inL && inR) out[k] = merge(b[k], local[k], remote[k]);
    else if (inL) { if (!(k in b) || !same(local[k], b[k])) out[k] = local[k]; } else if (!(k in b) || !same(remote[k], b[k])) out[k] = remote[k];
  }
  return out;
}

export function merge(base, local, remote) {
  if (same(local, remote)) return remote;
  if (base !== undefined && same(local, base)) return remote; // só a nuvem mudou
  if (base !== undefined && same(remote, base)) return local; // só este aparelho mudou
  if (isKeyedList(local, remote)) return mergeList(Array.isArray(base) ? base : [], local, remote);
  if (Array.isArray(local) && Array.isArray(remote) && [...local, ...remote].every((x) => typeof x !== 'object')) {
    return [...new Set([...remote, ...local])]; // ex.: impressões de importação
  }
  if (isObj(local) && isObj(remote)) return mergeObject(isObj(base) ? base : {}, local, remote);
  return remote;
}

/** Junta dois estados do app. */
export function mergeStates(base, local, remote) {
  const out = merge(base, local, remote);
  out.updatedAt = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || new Date().toISOString();
  return out;
}
