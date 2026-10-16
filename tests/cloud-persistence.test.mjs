// Nuvem e persistência: AAD + integridade dos envelopes, versão mais nova
// do formato, "pendente" durante o envio, merge com exclusões e cópias.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { deriveKey, encryptJSON, decryptJSON, randomSalt } from '../js/core/crypto.js';
import { store, SchemaTooNewError } from '../js/core/store.js';
import { createEmptyState, SCHEMA_VERSION } from '../js/domain/schema.js';
import { mergeWithConflicts } from '../js/domain/merge.js';
import { hashChunks } from '../js/domain/chunks.js';
import {
  sealPart, openPart, sealManifest, openManifest, settlePending, assertNotRollback, assertSchema,
  countItems, hasUserData, addConflictCopy, conflictCopies,
} from '../js/core/cloud/sync.js';
import { CloudError } from '../js/core/cloud/http.js';

let key;
let otherKey;
const salt = randomSalt();

before(async () => {
  console.warn = () => {};
  key = await deriveKey('frase secreta longa', salt, 1000);
  otherKey = await deriveKey('outra frase qualquer', salt, 1000);
});

const flipByte = (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  bytes[0] ^= 1;
  return btoa(String.fromCharCode(...bytes));
};

// ---------- crypto.js ----------

test('crypto: ida e volta sem AAD (formato antigo continua abrindo)', async () => {
  const env = await encryptJSON({ a: 1, b: 'ç' }, key, salt, { it: 1000 });
  assert.equal(env.a, undefined);
  assert.equal(env.it, 1000);
  assert.deepEqual(await decryptJSON(env, key), { a: 1, b: 'ç' });
});

test('crypto: ida e volta com AAD; AAD errado, chave errada ou bytes alterados falham', async () => {
  const env = await encryptJSON({ x: [1, 2, 3] }, key, salt, {}, { aad: 'u1|expenses:2026|rev1' });
  assert.equal(env.a, 1);
  assert.deepEqual(await decryptJSON(env, key, { aad: 'u1|expenses:2026|rev1' }), { x: [1, 2, 3] });
  await assert.rejects(decryptJSON(env, key, { aad: 'u1|expenses:2025|rev1' }));
  await assert.rejects(decryptJSON(env, key)); // envelope amarrado sem contexto
  await assert.rejects(decryptJSON(env, otherKey, { aad: 'u1|expenses:2026|rev1' }));
  await assert.rejects(decryptJSON({ ...env, data: flipByte(env.data) }, key, { aad: 'u1|expenses:2026|rev1' }));
  // tirar a marca `a` não ajuda: o texto foi cifrado com AAD
  await assert.rejects(decryptJSON({ ...env, a: undefined }, key));
});

// ---------- envelopes da nuvem ----------

test('nuvem: parte amarrada a usuário/nome/rev e conferida pelo hash', async () => {
  const value = [{ id: 'a', cents: 100 }];
  const hash = (await hashChunks({ 'expenses:2026': value }))['expenses:2026'];
  const ctx = { userId: 'u1', name: 'expenses:2026', rev: 'r1' };
  const env = await sealPart(value, key, { salt, it: 1000, ...ctx });
  const { value: out, legacy } = await openPart(env, key, { ...ctx, hash });
  assert.deepEqual(out, value);
  assert.equal(legacy, false);
  // trocada de lugar (outra parte / outra conta / outro rev)
  await assert.rejects(openPart(env, key, { ...ctx, name: 'expenses:2025', hash }), (e) => e instanceof CloudError && e.integrity);
  await assert.rejects(openPart(env, key, { ...ctx, userId: 'u2', hash }), (e) => e.integrity);
  await assert.rejects(openPart(env, key, { ...ctx, rev: 'r2', hash }), (e) => e.integrity);
  // hash do índice não bate
  await assert.rejects(openPart(env, key, { ...ctx, hash: '0'.repeat(32) }), (e) => e.integrity);
});

test('nuvem: parte antiga (sem AAD) abre e é marcada para recifrar', async () => {
  const value = { theme: 'dark' };
  const hash = (await hashChunks({ settings: value })).settings;
  const env = await encryptJSON(value, key, salt, { it: 1000 });
  const r = await openPart(env, key, { userId: 'u1', name: 'settings', rev: 'old', hash });
  assert.deepEqual(r.value, value);
  assert.equal(r.legacy, true);
});

test('nuvem: índice amarrado à versão (servidor não troca índice velho por número novo)', async () => {
  const man = { format: 'dhenors-manifest', v: 3, chunks: {} };
  const env = await sealManifest(man, key, { salt, it: 1000, userId: 'u1', version: 7 });
  const out = await openManifest(env, key, { userId: 'u1', version: 7 });
  assert.equal(out.version, 7);
  await assert.rejects(openManifest(env, key, { userId: 'u1', version: 8 }), (e) => e.badKey || e.integrity);
  await assert.rejects(openManifest(env, otherKey, { userId: 'u1', version: 7 }), (e) => e.badKey);
  assert.throws(() => assertNotRollback(9, 8), (e) => e.integrity);
  assert.doesNotThrow(() => assertNotRollback(9, 9));
  assert.doesNotThrow(() => assertNotRollback(null, 1));
});

// ---------- C2: versão mais nova do formato ----------

test('C2: dados da nuvem de versão mais nova lançam erro (nunca viram estado vazio)', async () => {
  const newer = { ...createEmptyState(), schema: SCHEMA_VERSION + 1 };
  assert.throws(() => assertSchema(newer), (e) => e instanceof CloudError && e.tooNew && /Atualize o app/.test(e.message));
  assert.doesNotThrow(() => assertSchema(createEmptyState()));

  const mine = createEmptyState();
  mine.expenses.push({ id: 'x1', description: 'Luz', cents: 100, dueDate: '2026-10-01' });
  store.data = mine;
  await assert.rejects(store.applyRemote(newer), SchemaTooNewError);
  assert.equal(store.data, mine, 'o estado atual fica como estava');
  assert.equal(store.data.expenses.length, 1);
  // lixo vindo da nuvem também não vira estado vazio
  await assert.rejects(store.applyRemote({ foo: 1 }));
  assert.equal(store.data, mine);
});

test('C2: backup de versão mais nova é recusado sem mexer nos dados', async () => {
  const mine = createEmptyState();
  store.data = mine;
  await assert.rejects(store.replace({ ...createEmptyState(), schema: SCHEMA_VERSION + 1 }), /mais nova/);
  assert.equal(store.data, mine);
});

// ---------- M1: pendências durante o envio ----------

test('M1: envio só zera "pendente" se nada mudou durante o envio', () => {
  const m = { dirty: true, pending: 2 };
  assert.equal(settlePending(m, 2), true);
  assert.deepEqual(m, { dirty: false, pending: 0 });

  const m2 = { dirty: true, pending: 3 }; // começou com 2, chegou mais 1 no meio
  assert.equal(settlePending(m2, 2), false);
  assert.deepEqual(m2, { dirty: true, pending: 1 });

  const m3 = { dirty: true, pending: 0 }; // envio forçado (ex.: ao ligar)
  assert.equal(settlePending(m3, 0), true);
  assert.equal(m3.dirty, false);
});

// ---------- merge: exclusões ----------

const st = (extra = {}) => ({ ...createEmptyState(), categories: [], ...extra });
const inst = (paid) => ({ id: 'p1', description: 'TV', totalCents: 3000, count: 3, paid });

test('merge: desmarcar uma parcela num aparelho não volta pelo outro', () => {
  const base = st({ installments: [inst([1, 2])] });
  const local = st({ installments: [inst([1])] });            // desmarcou a 2
  const remote = st({ installments: [inst([1, 2, 3])] });     // marcou a 3
  const { state } = mergeWithConflicts(base, local, remote);
  assert.deepEqual(state.installments[0].paid.slice().sort(), [1, 3]);
});

test('merge: pagamento de recorrente desfeito aqui sai, mesmo com outra mudança na nuvem', () => {
  const base = st({ recurringEntries: { 'r1|2026-10': { paidAt: '2026-10-05' }, 'r1|2026-09': { paidAt: '2026-09-05' } } });
  const local = st({ recurringEntries: { 'r1|2026-09': { paidAt: '2026-09-05' } } });
  const remote = st({ recurringEntries: { ...base.recurringEntries, 'r2|2026-10': { paidAt: '2026-10-07' } } });
  const { state } = mergeWithConflicts(base, local, remote);
  assert.deepEqual(Object.keys(state.recurringEntries).sort(), ['r1|2026-09', 'r2|2026-10']);
});

test('merge: apagado aqui e alterado na nuvem vira conflito (dá para refazer a exclusão)', () => {
  const e = (cents) => ({ id: 'a', description: 'Luz', cents, dueDate: '2026-10-01' });
  const { state, conflicts } = mergeWithConflicts(st({ expenses: [e(100)] }), st({ expenses: [] }), st({ expenses: [e(150)] }));
  assert.equal(state.expenses.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'deleted-local');
  assert.equal(conflicts[0].local, null);
});

// ---------- M5: aparelho "vazio" ----------

test('M5: cartões, contas, investimentos e plantões contam como dados do aparelho', () => {
  assert.equal(countItems(createEmptyState()), 0);
  assert.equal(hasUserData(createEmptyState()), false);
  for (const col of ['cards', 'accounts', 'investments', 'shifts', 'debts']) {
    const s = createEmptyState();
    s[col].push({ id: 'x' });
    assert.equal(hasUserData(s), true, col);
  }
  const s = createEmptyState();
  s.settings.salaryHistory.push({ from: '2026-01' });
  assert.equal(hasUserData(s), true);
});

// ---------- cópias de conflito ----------

test('conflitos: guarda as 3 cópias mais recentes (aceita o formato antigo)', () => {
  let saved = { at: 1, origin: 'nuvem', data: {} }; // formato antigo: uma só
  assert.equal(conflictCopies(saved).length, 1);
  for (const at of [2, 3, 4]) saved = addConflictCopy(saved, { at, origin: 'x', data: {} });
  assert.deepEqual(saved.map((c) => c.at), [4, 3, 2]);
  assert.deepEqual(conflictCopies(undefined), []);
});

// ---------- C1 / M4: apagar dados ----------

test('C1: "Apagar todos os dados" desliga a nuvem ANTES e não emite "replace"', async () => {
  const { cloud, CloudError: Exported } = await import('../js/core/cloud.js');
  assert.equal(Exported, CloudError, 'API pública da nuvem continua igual');
  assert.equal(typeof cloud.signOut, 'function');
  const order = [];
  store.data = createEmptyState();
  store.data.expenses.push({ id: 'x' });
  store.onReset(() => order.push(`hook:${store.data.expenses.length}`));
  const unsub = store.subscribe((reason) => order.push(`emit:${reason}`));
  await store.reset();
  unsub();
  assert.deepEqual(order, ['hook:1', 'emit:reset']);
  assert.equal(store.data.expenses.length, 0);
});

// Por último: depois de wipe() a store não grava mais nada neste processo
test('M4: apagar após tentativas erradas tira os dados e a chave da memória', async () => {
  store.data = createEmptyState();
  await store.wipe();
  assert.equal(store.data, null);
  assert.equal(store.pinEnabled, false);
  assert.throws(() => store.commit(() => {}));
});
