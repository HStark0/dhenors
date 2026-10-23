// Reservas (antigas "Metas"): tipos, a Reserva de emergência padrão
// (não exclui, alvo automático de 6 meses de gastos) e "Poupar no mês".

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { store } from '../js/core/store.js';
import { createEmptyState, sanitizeState } from '../js/domain/schema.js';
import { goalProgress, goalTarget, monthlyCost } from '../js/domain/planning.js';
import { EMERGENCY_GOAL_ID } from '../js/domain/goals.js';
import { countItems } from '../js/core/cloud/sync.js';
import * as A from '../js/domain/actions.js';
import { emptyState } from './helpers.mjs';

const reset = () => { store.data = emptyState(); store.data.onboarded = true; };

before(() => {
  store.guest = false;
  console.warn = () => {};
});

test('toda conta nasce com a Reserva de emergência (e ela não conta como dado na sincronização)', () => {
  const s = createEmptyState();
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].id, EMERGENCY_GOAL_ID);
  assert.equal(s.goals[0].kind, 'emergencia');
  assert.ok(s.goals[0].system && s.goals[0].autoTarget && s.goals[0].emergency);
  assert.equal(countItems(s), 0);
  s.goals[0].contributions.push({ id: 'c', date: '2026-10-01', cents: 100 });
  assert.equal(countItems(s), 1);
});

test('backup antigo: ganha a reserva padrão uma vez; quem já tinha reserva não ganha outra', () => {
  const semReserva = sanitizeState({ ...emptyState(), goals: [{ id: 'v', description: 'Viagem', targetCents: 100, contributions: [] }] });
  assert.equal(semReserva.goals.filter((g) => g.system).length, 1);
  assert.equal(sanitizeState(semReserva).goals.length, 2); // abrir de novo não duplica
  const comReserva = sanitizeState({ ...emptyState(), goals: [{ id: 'r', description: 'Minha reserva', targetCents: 100, emergency: true, contributions: [] }] });
  assert.deepEqual(comReserva.goals.map((g) => [g.id, g.system]), [['r', true]]);
});

test('a reserva padrão não pode ser excluída nem mudar de tipo', () => {
  reset();
  assert.throws(() => A.deleteGoal(EMERGENCY_GOAL_ID), /não pode ser excluída/);
  A.saveGoal({ ...store.data.goals[0], id: EMERGENCY_GOAL_ID, kind: 'viagem', description: 'Colchão' });
  const g = store.data.goals[0];
  assert.equal(g.kind, 'emergencia');
  assert.equal(g.description, 'Colchão');
});

test('alvo automático = 6 meses de gastos', () => {
  reset();
  A.saveRecurring({ description: 'Aluguel', cents: 150000, dueDay: 10, startYM: '2026-01' });
  const g = store.data.goals[0];
  const today = '2026-10-15';
  assert.equal(goalTarget(store.data, g, today), monthlyCost(store.data, '2026-10', today) * 6);
  assert.equal(goalTarget(store.data, g, today), 900000);
  // sem gastos ainda: alvo 0 não é "reserva completa"
  reset();
  assert.equal(goalProgress(store.data, store.data.goals[0], today).done, false);
});

test('tipos: compra com alvo e prazo; "Poupar no mês" recomeça a cada mês', () => {
  reset();
  A.saveGoal({ description: 'Carro', kind: 'compra', targetCents: 3000000, deadline: '2027-10-01' });
  const carro = store.data.goals.find((g) => g.description === 'Carro');
  assert.equal(carro.kind, 'compra');
  assert.equal(carro.emergency, false);

  A.saveGoal({ description: 'Poupar', kind: 'mensal', targetCents: 50000, deadline: '2027-01-01' });
  const mensal = store.data.goals.find((g) => g.kind === 'mensal');
  assert.equal(mensal.deadline, null); // alvo mensal não tem prazo
  store.data.goals.find((g) => g.id === mensal.id).contributions.push(
    { id: 'a', date: '2026-09-10', cents: 50000 },
    { id: 'b', date: '2026-10-05', cents: 20000 },
  );
  const p = goalProgress(store.data, store.data.goals.find((g) => g.id === mensal.id), '2026-10-15');
  assert.equal(p.saved, 70000);       // total guardado
  assert.equal(p.monthSaved, 20000);  // só outubro
  assert.equal(p.remaining, 30000);
  assert.equal(p.done, false);
  assert.equal(Math.round(p.progress), 40);
});

test('atalho antigo "metas" na barra vira "reservas"', () => {
  const s = emptyState();
  s.settings.tabbar = ['painel', 'metas', 'contas'];
  assert.deepEqual(sanitizeState(s).settings.tabbar, ['painel', 'reservas', 'contas']);
});
