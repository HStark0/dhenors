// Testes da carteira de investimentos: taxas, posição (custo médio,
// IR regressivo, vencimento), carteira ideal, projeção e operações.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { store } from '../js/core/store.js';
import { createEmptyState, sanitizeState } from '../js/domain/schema.js';
import { emergencyCoverage } from '../js/domain/planning.js';
import {
  annualRate, positionAt, portfolio, rebalance, project, irRate, DEFAULT_INVESTING,
} from '../js/domain/investments.js';
import * as A from '../js/domain/actions.js';

const cfg = { ...DEFAULT_INVESTING, cdiBp: 1490, ipcaBp: 450 };
const inv = (over) => ({ id: 'i1', name: 'Teste', type: 'cdb', rate: { kind: 'pre', bp: 1000 }, liquidity: 'd0', maturity: null, emergency: false, movements: [], ...over });
const mov = (kind, date, cents, id = `${kind}-${date}`) => ({ id, kind, date, cents, note: '' });

before(() => {
  store.data = createEmptyState();
  store.flush = async () => {};
  const error = console.error;
  console.warn = () => {};
  console.error = (...args) => { if (!String(args[0]).startsWith('[store]')) error(...args); };
});

test('taxas: 100% do CDI = CDI; IPCA+ composto; IR regressivo', () => {
  assert.ok(Math.abs(annualRate({ rate: { kind: 'cdi', bp: 10000 } }, cfg) - 0.149) < 1e-9);
  assert.ok(annualRate({ rate: { kind: 'cdi', bp: 9000 } }, cfg) < 0.149 * 0.9 + 1e-3);
  assert.ok(Math.abs(annualRate({ rate: { kind: 'ipca', bp: 600 } }, cfg) - (1.045 * 1.06 - 1)) < 1e-12);
  assert.equal(annualRate({ rate: { kind: 'none' } }, cfg), null);
  assert.ok(Math.abs(annualRate({ rate: { kind: 'poup' } }, cfg) - (1.005 ** 12 - 1)) < 1e-12); // Selic > 8,5%
  assert.equal(irRate(180), 0.225);
  assert.equal(irRate(181), 0.2);
  assert.equal(irRate(720), 0.175);
  assert.equal(irRate(721), 0.15);
});

test('posição: renda fixa rende sozinha e calcula IR', () => {
  const p = positionAt(inv({ movements: [mov('aporte', '2025-01-01', 100000)] }), cfg, '2026-01-01');
  assert.equal(p.value, 110000);
  assert.equal(p.principal, 100000);
  assert.equal(p.gain, 10000);
  assert.equal(p.avgDays, 365);
  assert.equal(p.ir, 1750); // 17,5% (de 361 a 720 dias)
  assert.equal(p.net, 108250);
  assert.equal(p.estimated, true);
});

test('posição: resgate usa custo médio (lucro realizado proporcional)', () => {
  const p = positionAt(inv({ movements: [mov('aporte', '2025-01-01', 100000), mov('resgate', '2026-01-01', 55000)] }), cfg, '2026-01-01');
  assert.equal(p.value, 55000);
  assert.equal(p.principal, 50000);
  assert.equal(p.realized, 5000);
  assert.equal(p.gain, 5000);
});

test('posição: renda variável só muda com atualização de saldo; proventos à parte', () => {
  const i = inv({ type: 'acoes', rate: { kind: 'none', bp: 0 }, movements: [
    mov('aporte', '2026-01-10', 100000), mov('saldo', '2026-03-01', 120000), mov('provento', '2026-04-15', 800),
  ] });
  const p = positionAt(i, cfg, '2026-06-01');
  assert.equal(p.value, 120000);
  assert.equal(p.gain, 20000);
  assert.equal(p.income, 800);
  assert.equal(p.ir, 0); // renda variável: sem estimativa de IR
  assert.equal(p.estimated, false);
  assert.equal(positionAt(i, cfg, '2026-02-01').value, 100000);
});

test('posição: para de render no vencimento; isento não tem IR', () => {
  const p = positionAt(inv({ type: 'lci_lca', maturity: '2026-01-01', movements: [mov('aporte', '2025-01-01', 100000)] }), cfg, '2027-01-01');
  assert.equal(p.value, 110000);
  assert.equal(p.ir, 0);
  assert.equal(p.matured, true);
});

test('carteira ideal: o aporte vai para a classe que está abaixo', () => {
  const state = { settings: { investing: { ...cfg, targets: { rf: 50, rv: 50 } } }, investments: [
    inv({ movements: [mov('aporte', '2026-10-01', 100000)], rate: { kind: 'none', bp: 0 } }),
  ] };
  const pf = portfolio(state, '2026-10-14');
  assert.equal(pf.totals.value, 100000);
  assert.equal(pf.month.aportes, 100000);
  const plan = rebalance(pf.byClass, 100000);
  assert.deepEqual(plan.map((p) => [p.key, p.cents]), [['rv', 100000]]);
  const split = rebalance(pf.byClass, 300000); // total 400 mil → 200 mil para cada
  assert.deepEqual(Object.fromEntries(split.map((p) => [p.key, p.cents])), { rf: 100000, rv: 200000 });
});

test('projeção: juros compostos e tempo até a meta', () => {
  const flat = project({ startCents: 0, monthlyCents: 1000, annualRate: 0, months: 12, targetCents: 6000 });
  assert.equal(flat.final, 12000);
  assert.equal(flat.contributed, 12000);
  assert.equal(flat.monthsToTarget, 6);
  const grow = project({ startCents: 100000, monthlyCents: 0, annualRate: 0.1, months: 12 });
  assert.ok(Math.abs(grow.final - 110000) <= 2);
  assert.equal(project({ startCents: 0, monthlyCents: 0, annualRate: 0.1, months: 12, targetCents: 100 }).monthsToTarget, null);
});

test('operações: aporte com gasto no mês, resgate validado, exclusão e backup', () => {
  const created = A.saveInvestment({ name: 'Tesouro Selic 2029', type: 'tesouro_selic', rateKind: 'cdi', rateBp: 10000, liquidity: 'd1', emergency: true, initialCents: 50000, initialDate: '2025-03-01' });
  assert.equal(store.data.investments.length, 1);
  assert.equal(created.movements[0].kind, 'aporte');
  assert.throws(() => A.saveInvestment({ name: 'CDB', type: 'cdb', rateKind: 'cdi', rateBp: 0 }), /taxa/);

  const mv = A.addInvestmentMovement(created.id, { kind: 'aporte', cents: 20000, date: '2025-05-10', asExpense: true });
  const expense = store.data.expenses.find((e) => e.id === mv.expenseId);
  assert.ok(expense, 'aporte virou gasto pago');
  assert.equal(expense.paidAt, '2025-05-10');
  assert.equal(store.data.categories.find((c) => c.id === expense.categoryId)?.name, 'Investimentos');

  assert.throws(() => A.addInvestmentMovement(created.id, { kind: 'resgate', cents: 999999, date: '2025-06-01' }), /maior que o saldo/);
  assert.throws(() => A.addInvestmentMovement(created.id, { kind: 'aporte', cents: 100, date: '2999-01-01' }), /futuro/);

  A.deleteInvestmentMovement(created.id, mv.id);
  assert.equal(store.data.expenses.some((e) => e.id === mv.expenseId), false, 'gasto ligado sai junto');

  A.addInvestmentMovement(created.id, { kind: 'resgate', cents: 10000, date: '2025-06-01' });
  const first = store.data.investments[0].movements.find((m) => m.kind === 'aporte');
  assert.throws(() => A.deleteInvestmentMovement(created.id, first.id), /resgates/);

  const restored = sanitizeState(JSON.parse(JSON.stringify(store.data)));
  assert.deepEqual(restored.investments, store.data.investments);

  const reserve = emergencyCoverage(store.data, '2026-10', '2026-10-14');
  assert.equal(reserve.hasGoal, true);
  assert.ok(reserve.saved > 40000);
});

test('configurações: carteira ideal precisa somar 100%', () => {
  assert.throws(() => A.saveInvestingSettings({ cdiBp: 1400, ipcaBp: 400, targets: { rf: 60, rv: 30 } }), /100%/);
  A.saveInvestingSettings({ cdiBp: 1400, ipcaBp: 400, monthlyTargetCents: 50000, targets: { rf: 70, rv: 30 } });
  const { cdiBp, ipcaBp, monthlyTargetCents, targets } = store.data.settings.investing;
  assert.deepEqual({ cdiBp, ipcaBp, monthlyTargetCents, targets }, { cdiBp: 1400, ipcaBp: 400, monthlyTargetCents: 50000, targets: { rf: 70, rv: 30 } });
  A.saveInvestingSettings({ cdiBp: 1400, ipcaBp: 400, targets: {} });
  assert.deepEqual(store.data.settings.investing.targets, {});
});
