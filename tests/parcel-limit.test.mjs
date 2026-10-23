// Limite das parcelas sobre os ganhos fixos (10/20/30%) e o fluxo do
// mês (o que entra, o que sai) mostrados no topo do painel.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeState } from '../js/domain/schema.js';
import { computeMonth } from '../js/domain/ledger.js';
import { parcelLimit, parcelLimitPct, fixedIncome, monthOutflow } from '../js/domain/parcelLimit.js';
import { emptyState } from './helpers.mjs';

const TODAY = '2026-10-15';
const YM = '2026-10';
const profile = (cents) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [] });
const inst = (id, parcel, count, first) => ({
  id, description: id, totalCents: parcel * count, count, firstDueDate: first, dueDay: Number(first.slice(8)), paid: [], paidOn: {},
});

function base() {
  const s = emptyState();
  s.settings.salaryHistory = [profile(500000)];
  s.recurring.push({ id: 'aluguel', description: 'Aluguel', cents: 150000, dueDay: 10, startYM: '2026-01', endYM: null, freq: 'monthly', tags: [] });
  return s;
}

test('percentual padrão é 10% e só aceita 10, 20 ou 30', () => {
  assert.equal(emptyState().settings.parcelLimitPct, 10);
  assert.equal(parcelLimitPct({}), 10);
  assert.equal(parcelLimitPct({ parcelLimitPct: 30 }), 30);
  assert.equal(parcelLimitPct({ parcelLimitPct: 15 }), 10);
  const s = emptyState();
  s.settings.parcelLimitPct = 25;
  assert.equal(sanitizeState(s).settings.parcelLimitPct, 10);
  s.settings.parcelLimitPct = 20;
  assert.equal(sanitizeState(s).settings.parcelLimitPct, 20);
});

test('ganhos fixos excluem extras avulsos; fixos + variáveis = ganhos do mês', () => {
  const s = base();
  s.extraIncomes.push({ id: 'freela', ym: '2026-10', description: 'Freela', cents: 80000, date: '2026-10-05', payroll: false, kind: 'freela' });
  const m = computeMonth(s, YM, TODAY);
  const inc = fixedIncome(s, YM, TODAY);
  assert.equal(inc.fixed.total, m.income.salary);
  assert.equal(inc.fixed.total + inc.variable.total, m.income.total);
  assert.ok(inc.variable.list.some((x) => x.label === 'Freela' && x.cents === 80000));
});

test('status: dentro, na média e acima do limite sobre os ganhos fixos', () => {
  const s = base();
  const fixed = fixedIncome(s, YM, TODAY).fixed.total;
  const at = (share) => {
    const st = base();
    st.installments.push(inst('Celular', Math.round(fixed * share), 10, '2026-08-20'));
    return parcelLimit(st, YM, 10, TODAY);
  };
  assert.equal(at(0.05).status, 'within');   // 5% de 10%
  assert.equal(at(0.09).status, 'average');  // 9%: encostando no limite
  const over = at(0.15);
  assert.equal(over.status, 'over');
  assert.ok(over.room < 0);
  assert.ok(over.tips.some((t) => t.id === 'cut'));
  // Com 20% a mesma parcela fica dentro, e a dica aponta o caminho para 10%
  const st = base();
  st.installments.push(inst('Celular', Math.round(fixed * 0.15), 10, '2026-08-20'));
  const r20 = parcelLimit(st, YM, 20, TODAY);
  assert.equal(r20.status, 'within'); // 15% de 20% = 75% do limite
  assert.ok(r20.tips.some((t) => t.id === 'to-10'));
});

test('sem salário: status "none"', () => {
  const s = emptyState();
  assert.equal(parcelLimit(s, YM, 10, TODAY).status, 'none');
});

test('o que sai soma o gasto do mês e separa as parcelas', () => {
  const s = base();
  s.installments.push(inst('TV', 30000, 10, '2026-08-20'));
  s.expenses.push({ id: 'e1', description: 'Mercado', cents: 40000, dueDate: '2026-10-12', paidAt: null, categoryId: null, tags: [] });
  const out = monthOutflow(s, YM, TODAY);
  assert.equal(out.total, computeMonth(s, YM, TODAY).totals.all);
  assert.equal(out.parcels, 30000);
  assert.equal(out.fixed, 150000);
  assert.equal(out.single, 40000);
  assert.equal(out.list.reduce((a, x) => a + x.cents, 0), out.total);
});
