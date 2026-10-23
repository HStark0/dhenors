// Nuvem e persistência: AAD + integridade dos envelopes, versão mais nova
// do formato, "pendente" durante o envio, merge com exclusões e cópias.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { deriveKey, encryptJSON, decryptJSON, randomSalt } from '../js/core/crypto.js';
import { store, SchemaTooNewError } from '../js/core/store.js';
import { SCHEMA_VERSION } from '../js/domain/schema.js';
import { mergeWithConflicts } from '../js/domain/merge.js';
import { hashChunks } from '../js/domain/chunks.js';
import {
  sealPart, openPart, sealManifest, openManifest, settlePending, assertNotRollback, assertSchema,
  countItems, hasUserData, addConflictCopy, conflictCopies,
} from '../js/core/cloud/sync.js';
import { CloudError } from '../js/core/cloud/http.js';
import { emptyState } from './helpers.mjs';

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
  const newer = { ...emptyState(), schema: SCHEMA_VERSION + 1 };
  assert.throws(() => assertSchema(newer), (e) => e instanceof CloudError && e.tooNew && /Atualize o app/.test(e.message));
  assert.doesNotThrow(() => assertSchema(emptyState()));

  const mine = emptyState();
  mine.expenses.push({ id: 'x1', description: 'Luz', cents: 100, dueDate: '2026-10-01' });
  store.data = mine;
  store.guest = false; // conta aberta
  await assert.rejects(store.applyRemote(newer), SchemaTooNewError);
  assert.equal(store.data, mine, 'o estado atual fica como estava');
  assert.equal(store.data.expenses.length, 1);
  // lixo vindo da nuvem também não vira estado vazio
  await assert.rejects(store.applyRemote({ foo: 1 }));
  assert.equal(store.data, mine);
});

test('saiu da conta durante uma sincronização: dados da nuvem não entram no exemplo', async () => {
  store.close();
  const sample = store.data;
  const real = emptyState();
  real.settings.profileName = 'Conta real';
  await store.applyRemote(real);
  assert.equal(store.data, sample);
  assert.equal(store.guest, true);
});

test('C2: backup de versão mais nova é recusado sem mexer nos dados', async () => {
  const mine = emptyState();
  store.open(mine);
  await assert.rejects(store.replace({ ...emptyState(), schema: SCHEMA_VERSION + 1 }), /mais nova/);
  assert.equal(store.data.updatedAt, mine.updatedAt);
  assert.equal(store.guest, false);
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

// Datas fixas: emptyState() usa a hora atual, e três chamadas em milissegundos
// diferentes viravam um conflito falso em createdAt (teste instável).
const st = (extra = {}) => ({ ...emptyState(), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', categories: [], ...extra });
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
  assert.equal(countItems(emptyState()), 0);
  assert.equal(hasUserData(emptyState()), false);
  for (const col of ['cards', 'accounts', 'investments', 'shifts', 'debts']) {
    const s = emptyState();
    s[col].push({ id: 'x' });
    assert.equal(hasUserData(s), true, col);
  }
  const s = emptyState();
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

// ---------- Só na nuvem: store na memória e "lembrar o login" ----------

test('visitante: qualquer alteração pede login e nada muda (aparência vale)', async () => {
  const { GuestError } = await import('../js/core/store.js');
  store.init();
  assert.equal(store.guest, true);
  assert.ok(store.data.expenses.length > 0, 'visitante vê o exemplo');
  const before = JSON.stringify(store.data);
  let asked = 0;
  const prevDoc = globalThis.document;
  globalThis.document = { dispatchEvent: (ev) => { if (ev.type === 'dhenors:need-login') asked++; } };
  try {
    assert.throws(() => store.commit((d) => { d.expenses.length = 0; }), GuestError);
    await assert.rejects(store.replace(emptyState()), GuestError);
  } finally { globalThis.document = prevDoc; }
  assert.equal(asked, 2);
  assert.equal(JSON.stringify(store.data), before);
  store.commit((d) => { d.settings.theme = 'dark'; }, 'appearance');
  assert.equal(store.data.settings.theme, 'dark');
});

test('entrar abre os dados da conta; sair tira da memória e volta ao exemplo', () => {
  const reasons = [];
  const unsub = store.subscribe((r) => reasons.push(r));
  const mine = emptyState();
  mine.settings.profileName = 'Minha conta';
  store.open(mine);
  assert.equal(store.guest, false);
  store.commit((d) => { d.expenses.push({ id: 'x' }); }, 'change', { undo: 'teste' });
  store.close();
  unsub();
  assert.equal(store.guest, true);
  assert.notEqual(store.data.settings.profileName, 'Minha conta');
  assert.equal(store.undoable, null, 'desfazer não atravessa contas');
  assert.deepEqual(reasons, ['open', 'change', 'close']);
});

test('"Apagar todos os dados" vira um estado vazio que vai para a nuvem', async () => {
  store.open(emptyState());
  store.data.expenses.push({ id: 'x' });
  const reasons = [];
  const unsub = store.subscribe((r) => reasons.push(r));
  await store.reset();
  unsub();
  assert.equal(store.data.expenses.length, 0);
  assert.deepEqual(reasons, ['replace']);
});

test('lembrar o login: só acesso (sem dados), no lugar certo e com validade', async () => {
  const fake = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  const prev = { ls: globalThis.localStorage, ss: globalThis.sessionStorage };
  const ls = fake();
  const ss = fake();
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true });
  try {
    const { readAuth, writeAuth, clearAuth } = await import('../js/core/storage.js');
    writeAuth({ session: { access_token: 't' }, key: 'k', remember: 'session' });
    assert.equal(ls.m.size, 0, '"só agora" não vai para o localStorage');
    assert.equal(readAuth().key, 'k');
    writeAuth({ session: { access_token: 't' }, key: 'k', remember: '30d', until: 1000 });
    assert.equal(ss.m.size, 0, 'trocar a escolha tira do outro lugar');
    assert.equal(readAuth(999).remember, '30d');
    assert.equal(readAuth(1001), null, 'venceu: some');
    assert.equal(ls.m.size, 0);
    writeAuth({ session: { access_token: 't' }, remember: 'always' });
    clearAuth();
    assert.equal(readAuth(), null);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prev.ls, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: prev.ss, configurable: true });
  }
});

test('anexos: a chave própria do arquivo sobrevive à validação do estado', async () => {
  const { sanitizeState } = await import('../js/domain/schema.js');
  const st = emptyState();
  st.schema = 1; // força passar pelo sanitizador
  st.expenses.push({ id: 'e1', description: 'Luz', cents: 100, dueDate: '2026-10-10', attachments: [{ id: 'a1', name: 'x.jpg', type: 'image/jpeg', size: 10, k: 'A'.repeat(43) + '=' }, { id: 'a2', name: 'y', type: '', size: 1, k: 'não é base64!' }] });
  const out = sanitizeState(st).expenses[0].attachments;
  assert.equal(out[0].k, 'A'.repeat(43) + '=');
  assert.equal(out[1].k, undefined);
});
