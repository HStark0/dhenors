// Testes das operações de escrita (validação, fechamento de mês, metas).
// Rodam sem navegador: o armazenamento é desligado e só o estado em memória é usado.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { store } from '../js/core/store.js';
import { toCents } from '../js/core/money.js';
import { createEmptyState, sanitizeState } from '../js/domain/schema.js';
import { computeMonth } from '../js/domain/ledger.js';
import { monthSummary } from '../js/domain/analysis.js';
import * as A from '../js/domain/actions.js';

before(() => {
  store.data = createEmptyState();
  store.flush = async () => {};
  // Sem IndexedDB no Node: silencia só os avisos de armazenamento
  const error = console.error;
  console.warn = () => {};
  console.error = (...args) => { if (!String(args[0]).startsWith('[store]')) error(...args); };
});

test('toCents: casos de borda', () => {
  assert.equal(toCents('0.500'), 50);
  assert.equal(toCents('10,'), 1000);
});

test('validação falha não altera o estado (commit em cópia)', () => {
  const before = JSON.stringify(store.data.settings);
  assert.throws(() => A.completeOnboarding({ profileName: 'Parcial', salaryCents: NaN, salaryDay: 5 }), A.ValidationError);
  assert.equal(JSON.stringify(store.data.settings), before);
});

test('despesa: valida valor, data e mês fechado', () => {
  assert.throws(() => A.saveExpense({ description: 'X', cents: 0, dueDate: '2026-09-10' }), /maior que zero/);
  assert.throws(() => A.saveExpense({ description: 'X', cents: 100, dueDate: '2026-02-30' }), /Data inválida/);
  A.saveExpense({ description: 'Mercado', cents: 10000, dueDate: '2026-09-10' });
  A.saveRecurring({ description: 'Luz', cents: 20000, dueDay: 10, startYM: '2026-01' });
  A.closeMonth('2026-09');
  assert.throws(() => A.saveExpense({ description: 'Y', cents: 100, dueDate: '2026-09-11' }), /fechado/);
  const rec = store.data.recurring[0];
  assert.throws(() => A.skipRecurringMonth(rec.id, '2026-09'), /fechado/);
});

test('editar a recorrente não muda mês fechado nem mês já pago', () => {
  const rec = store.data.recurring[0];
  const item = computeMonth(store.data, '2026-08', '2026-10-12').items.find((i) => i.kind === 'recurring');
  A.setItemPaid(item, true, '2026-08-10');
  A.saveRecurring({ ...rec, id: rec.id, cents: 99900 });
  const sep = computeMonth(store.data, '2026-09', '2026-10-12').items.find((i) => i.kind === 'recurring');
  const aug = computeMonth(store.data, '2026-08', '2026-10-12').items.find((i) => i.kind === 'recurring');
  const oct = computeMonth(store.data, '2026-10', '2026-10-12').items.find((i) => i.kind === 'recurring');
  assert.equal(sep.cents, 20000); // fechado
  assert.equal(aug.cents, 20000); // pago
  assert.equal(oct.cents, 99900); // aberto: novo valor
  assert.equal(monthSummary(store.data, '2026-09').spent, 30000);
});

test('meta: retirada e exclusão não deixam saldo negativo', () => {
  A.saveGoal({ description: 'Viagem', targetCents: 100000, icon: '✈️' });
  const g = store.data.goals[0];
  A.addContribution(g.id, 5000, '2026-10-01');
  assert.throws(() => A.addContribution(g.id, -6000, '2026-10-02'), /maior que o valor guardado/);
  A.addContribution(g.id, -5000, '2026-10-02');
  const deposit = store.data.goals[0].contributions[0];
  assert.throws(() => A.deleteContribution(g.id, deposit.id), /negativo/);
});

test('backup com fotografia de mês quebrada é limpo', () => {
  const raw = JSON.parse(JSON.stringify(store.data));
  raw.closedMonths['2026-05'] = { totals: {} };
  const clean = sanitizeState(raw);
  assert.equal(clean.closedMonths['2026-05'], undefined);
  assert.ok(clean.closedMonths['2026-09']);
});

test('salário por itens: vale a partir do mês e não mexe nos anteriores', async () => {
  const { payrollProfileFor, payrollFor } = await import('../js/domain/payroll.js');
  A.savePayrollBase({ fromYM: '2026-01', grossCents: 500000, dependents: 0, salaryDay: 5 });
  A.savePayrollLine('2026-10', 'ded', { description: 'Plano', mode: 'fixed', value: 30000 });
  assert.equal(payrollProfileFor(store.data.settings, '2026-09').deductions.length, 0);
  const oct = payrollProfileFor(store.data.settings, '2026-10');
  assert.equal(oct.deductions.length, 1);
  assert.equal(oct.grossCents, 500000); // herdou o salário de janeiro
  assert.equal(payrollFor(store.data.settings, '2027-05').deductionsTotal, 30000); // continua nos meses seguintes
  assert.throws(() => A.savePayrollLine('2026-10', 'add', { description: '', mode: 'percent', value: 2000 }), /descrição/);
  A.deletePayrollLine('2026-10', 'ded', oct.deductions[0].id);
  assert.equal(payrollFor(store.data.settings, '2026-10').deductionsTotal, 0);
});

test('consignado aparece em TODOS os meses até a última parcela', async () => {
  const { payrollFor } = await import('../js/domain/payroll.js');
  // salário desde jan; aumento cadastrado para dez (perfil posterior já existe)
  A.savePayrollBase({ fromYM: '2026-12', grossCents: 600000, dependents: 0 });
  // consignado incluído vendo outubro: 24 parcelas, 2 já descontadas → começou em agosto
  A.savePayrollLine('2026-10', 'ded', { description: 'Consignado', mode: 'fixed', value: 45000, loan: { count: 24, startYM: '2026-08' } });
  const at = (ym) => payrollFor(store.data.settings, ym).deductions.find((x) => x.description === 'Consignado');
  assert.equal(at('2026-07'), undefined);           // antes da 1ª parcela
  assert.equal(at('2026-08').loan.n, 1);            // mês anterior ao cadastro: aparece
  assert.equal(at('2026-12').loan.n, 5);            // depois do aumento: continua
  assert.equal(at('2028-07').loan.n, 24);           // última parcela
  assert.equal(at('2028-08'), undefined);           // quitado: sai sozinho
  assert.equal(store.data.settings.salaryHistory.every((p) => p.deductions.every((x) => !x.loan)), true);
});

test('linha comum incluída antes de um aumento também vale depois dele', async () => {
  const { payrollFor } = await import('../js/domain/payroll.js');
  A.savePayrollLine('2026-11', 'add', { description: 'Gratificação', mode: 'fixed', value: 10000 });
  assert.ok(payrollFor(store.data.settings, '2026-12').additions.some((x) => x.description === 'Gratificação'));
  assert.ok(!payrollFor(store.data.settings, '2026-10').additions.some((x) => x.description === 'Gratificação'));
});

test('migração v2 → v3: consignado sai do perfil para a lista própria', () => {
  const v2 = { schema: 2, settings: { salaryHistory: [{ from: '2026-10', grossCents: 500000, additions: [], deductions: [
    { id: 'c1', description: 'Consignado', mode: 'fixed', value: 1000, loan: { count: 3, startYM: '2026-09' } },
    { id: 'p1', description: 'Plano', mode: 'fixed', value: 2000 },
  ] }] }, expenses: [] };
  const v3 = sanitizeState(v2);
  assert.equal(v3.settings.payrollLoans.length, 1);
  assert.equal(v3.settings.salaryHistory[0].deductions.length, 1);
});
