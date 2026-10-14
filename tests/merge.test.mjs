// Merge de 3 vias usado na sincronização entre aparelhos
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, mergeStates } from '../js/domain/merge.js';
import { createEmptyState } from '../js/domain/schema.js';

const st = (expenses, extra = {}) => ({ ...createEmptyState(), categories: [], expenses, ...extra });
const e = (id, cents = 100, d = 'x') => ({ id, description: d, cents, dueDate: '2026-10-01' });

test('itens novos dos dois aparelhos ficam', () => {
  const base = st([e('a')]);
  const local = st([e('a'), e('b')]);
  const remote = st([e('a'), e('c')]);
  assert.deepEqual(mergeStates(base, local, remote).expenses.map((x) => x.id).sort(), ['a', 'b', 'c']);
});

test('apagado de um lado e não mexido do outro sai', () => {
  const base = st([e('a'), e('b')]);
  assert.deepEqual(mergeStates(base, st([e('a')]), st([e('a'), e('b')])).expenses.map((x) => x.id), ['a']);
  assert.deepEqual(mergeStates(base, st([e('a'), e('b')]), st([e('b')])).expenses.map((x) => x.id), ['b']);
});

test('apagado de um lado mas alterado do outro: a alteração fica', () => {
  const base = st([e('a')]);
  assert.equal(mergeStates(base, st([]), st([e('a', 999)])).expenses[0].cents, 999);
});

test('alterações em campos diferentes do mesmo item se juntam', () => {
  const base = st([e('a', 100, 'luz')]);
  const local = st([e('a', 150, 'luz')]);
  const remote = st([e('a', 100, 'conta de luz')]);
  const m = mergeStates(base, local, remote).expenses[0];
  assert.equal(m.cents, 150);
  assert.equal(m.description, 'conta de luz');
});

test('ajustes: cada campo pelo lado que mudou', () => {
  const base = createEmptyState();
  const local = structuredClone(base); local.settings.profileName = 'Wade';
  const remote = structuredClone(base); remote.settings.theme = 'dark';
  const m = merge(base, local, remote);
  assert.equal(m.settings.profileName, 'Wade');
  assert.equal(m.settings.theme, 'dark');
});

test('salário (lista por mês "from") e listas simples', () => {
  const base = { h: [{ from: '2026-01', grossCents: 1 }], f: ['x'] };
  const local = { h: [{ from: '2026-01', grossCents: 1 }, { from: '2026-05', grossCents: 2 }], f: ['x', 'y'] };
  const remote = { h: [{ from: '2026-01', grossCents: 1 }, { from: '2026-09', grossCents: 3 }], f: ['x', 'z'] };
  const m = merge(base, local, remote);
  assert.deepEqual(m.h.map((x) => x.from).sort(), ['2026-01', '2026-05', '2026-09']);
  assert.deepEqual(m.f.sort(), ['x', 'y', 'z']);
});
