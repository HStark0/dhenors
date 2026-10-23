// Card "Credores do mês": quanto se deve a cada credor no mês vigente.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { creditorsInMonth } from '../js/domain/ledger.js';
import { emptyState } from './helpers.mjs';

const TODAY = '2026-10-15';

function state() {
  const s = emptyState();
  s.creditors = [{ id: 'paulina', name: 'Paulina', notes: '' }, { id: 'vivo', name: 'Vivo', notes: '' }, { id: 'zero', name: 'Sem nada', notes: '' }];
  s.installments.push({
    id: 'emp', description: 'Empréstimo', totalCents: 300000, count: 3, firstDueDate: '2026-09-20', dueDay: 20,
    paid: [1], paidOn: {}, creditorId: 'paulina',
  });
  s.recurring.push({ id: 'cel', description: 'Celular', cents: 3500, dueDay: 5, startYM: '2026-10', endYM: null, freq: 'monthly', tags: [], creditorId: 'vivo' });
  return s;
}

test('só credores com valor no mês, do maior para o menor', () => {
  const c = creditorsInMonth(state(), '2026-10', TODAY);
  assert.deepEqual(c.list.map((x) => x.creditor.id), ['paulina', 'vivo']);
  const p = c.list[0];
  assert.equal(p.total, 100000);          // a parcela de outubro
  assert.equal(p.pending, 100000);
  assert.equal(p.outstanding, 200000);    // outubro + novembro
  assert.equal(c.total, 103500);
});

test('mês vigente inclui atrasadas de meses anteriores', () => {
  const s = state();
  s.installments[0].paid = [];
  const c = creditorsInMonth(s, '2026-10', TODAY);
  const p = c.list.find((x) => x.creditor.id === 'paulina');
  assert.equal(p.total, 200000);          // setembro (atrasada) + outubro
  assert.equal(p.overdue, 100000);
});
