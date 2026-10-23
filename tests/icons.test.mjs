// O app não mostra emoji: ícones guardados são sempre "i:nome" (do sprite).
// Cadastros antigos com emoji viram o ícone equivalente ao abrir os dados.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeState } from '../js/domain/schema.js';
import { toIconValue } from '../js/domain/defaults.js';
import { GOAL_KINDS } from '../js/domain/goals.js';
import { INVEST_TYPES } from '../js/domain/investments.js';
import { emptyState } from './helpers.mjs';

const HOUSE = '\u{1F3E0}';
const PLANE = '\u{2708}\u{FE0F}';
const JAR = '\u{1FAD9}';
const PICTO = /\p{Extended_Pictographic}/u;

test('emoji antigo vira ícone (com ou sem seletor de variação); desconhecido vira o padrão', () => {
  assert.equal(toIconValue(HOUSE), 'i:house');
  assert.equal(toIconValue(PLANE), 'i:plane');
  assert.equal(toIconValue('\u{2708}'), 'i:plane');
  assert.equal(toIconValue('i:coins'), 'i:coins');
  assert.equal(toIconValue('\u{1F984}'), 'i:tag');
  assert.equal(toIconValue('', 'i:inbox'), 'i:inbox');
});

test('abrir dados antigos converte categorias, reservas e envelopes', () => {
  const s = emptyState();
  s.categories[0].icon = HOUSE;
  s.goals.push({ id: 'v', description: 'Viagem', targetCents: 100, icon: PLANE, contributions: [] });
  s.settings.envelopes = [{ id: 'e', name: 'Mercado', icon: JAR, monthlyCents: 100, categoryIds: [], rollover: true }];
  const out = sanitizeState(s);
  assert.equal(out.categories[0].icon, 'i:house');
  assert.equal(out.goals.find((g) => g.id === 'v').icon, 'i:plane');
  assert.equal(out.settings.envelopes[0].icon, 'i:inbox');
  const all = JSON.stringify({ c: out.categories.map((c) => c.icon), g: out.goals.map((g) => g.icon), e: out.settings.envelopes.map((e) => e.icon) });
  assert.ok(!PICTO.test(all));
});

test('tipos de reserva e de investimento usam ícones do sprite', () => {
  for (const k of GOAL_KINDS) assert.match(k.icon, /^i:[a-z0-9-]+$/);
  for (const t of Object.values(INVEST_TYPES)) assert.match(t.icon, /^[a-z0-9-]+$/);
});
