// Reserva de emergência no painel: quanto guardar (10/20/30% dos
// ganhos fixos) × quanto entrou na reserva no mês.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeState } from '../js/domain/schema.js';
import { fixedIncome } from '../js/domain/parcelLimit.js';
import { reservePct, reserveSavedIn, reserveStatus } from '../js/domain/reserve.js';
import { emptyState } from './helpers.mjs';

const TODAY = '2026-10-15';
const YM = '2026-10';
const profile = (cents) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [] });

function base() {
  const s = emptyState();
  s.settings.salaryHistory = [profile(500000)];
  return s;
}
const cdb = (movements, extra = {}) => ({
  id: 'cdb', name: 'CDB', type: 'cdb', institution: '', rate: { kind: 'cdi', bp: 10000 }, liquidity: 'd0', maturity: null,
  emergency: true, notes: '', ticker: '', pension: '', movements, ...extra,
});
const mov = (date, kind, cents) => ({ id: `${kind}-${date}`, date, kind, cents, note: '' });

test('percentual padrão é 10% e só aceita 10, 20 ou 30', () => {
  assert.equal(emptyState().settings.reservePct, 10);
  assert.equal(reservePct({}), 10);
  assert.equal(reservePct({ reservePct: 20 }), 20);
  const s = emptyState();
  s.settings.reservePct = 40;
  assert.equal(sanitizeState(s).settings.reservePct, 10);
});

test('guardado no mês: aportes − resgates só da reserva e só do mês', () => {
  const s = base();
  s.investments = [
    cdb([mov('2026-10-05', 'aporte', 50000), mov('2026-10-20', 'resgate', 10000), mov('2026-09-05', 'aporte', 99999)]),
    cdb([mov('2026-10-05', 'aporte', 70000)], { id: 'acao', emergency: false }),
  ];
  assert.equal(reserveSavedIn(s, YM), 40000);
});

test('meta de reserva solta + investimento de reserva solto: não conta em dobro', () => {
  const s = base();
  s.investments = [cdb([mov('2026-10-05', 'aporte', 50000)])];
  s.goals = [{ id: 'g', description: 'Reserva', targetCents: 1000000, deadline: null, icon: '', emergency: true, investmentIds: [], contributions: [{ id: 'c', date: '2026-10-06', cents: 50000 }] }];
  assert.equal(reserveSavedIn(s, YM), 50000);
  // Ligada ao investimento: são dinheiros diferentes, soma
  s.goals[0].investmentIds = ['cdb'];
  assert.equal(reserveSavedIn(s, YM), 100000);
});

test('status: dentro, na média e abaixo da reserva', () => {
  const fixed = fixedIncome(base(), YM, TODAY).fixed.total;
  const at = (share) => {
    const s = base();
    s.investments = [cdb([mov('2026-10-05', 'aporte', Math.round(fixed * share))])];
    return reserveStatus(s, YM, 10, TODAY);
  };
  assert.equal(at(0.1).status, 'within');
  assert.equal(at(0.12).status, 'within');
  assert.equal(at(0.09).status, 'average');
  const low = at(0.02);
  assert.equal(low.status, 'below');
  assert.ok(low.missing > 0);
  assert.ok(low.tips.some((t) => t.id === 'missing'));
  // Reserva padrão ainda zerada: dica para começar a guardar nela
  const none = reserveStatus(base(), YM, 10, TODAY);
  assert.equal(none.status, 'below');
  assert.ok(none.tips.some((t) => t.id === 'start'));
  // Sem salário
  assert.equal(reserveStatus(emptyState(), YM, 10, TODAY).status, 'none');
});
