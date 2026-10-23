// Testes de domínio (sem navegador): planejamento, sincronização, cartões e contas.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { store } from '../js/core/store.js';
import { sanitizeState } from '../js/domain/schema.js';
import { computeMonth, recurringDates, installmentSchedule, variableEstimate } from '../js/domain/ledger.js';
import { emergencyCoverage, financialScore, spendingRoom, dailyCashflow } from '../js/domain/planning.js';
import { mergeWithConflicts } from '../js/domain/merge.js';
import { splitChunks, joinChunks, hashChunks, diffChunks } from '../js/domain/chunks.js';
import { invoiceMonthFor, invoice, purchaseSchedule, cardUsage } from '../js/domain/cards.js';
import { accountBalance, accountsSummary } from '../js/domain/accounts.js';
import { reconcile } from '../js/domain/reconcile.js';
import { shiftIncomes } from '../js/domain/shifts.js';
import { benefitsIn, plrTax, jobNet } from '../js/domain/benefits.js';
import { tablesFor, registerCustomTables } from '../js/domain/taxTables.js';
import * as A from '../js/domain/actions.js';
import { emptyState } from './helpers.mjs';

const today = '2026-10-15';
const reset = () => { store.data = emptyState(); store.data.onboarded = true; };

before(() => {
  store.guest = false; // conta aberta (sem login, alterações pedem para entrar)
  console.warn = () => {};
});

test('item 4: parcela paga guarda a data REAL do pagamento', () => {
  reset();
  A.saveInstallment({ description: 'TV', parcelCents: 10000, count: 3, paidCount: 0, nextDueDate: '2026-09-10', dueDay: 10 });
  const inst = store.data.installments[0];
  A.setParcelPaid(inst.id, 1, true, '2026-09-25'); // pagou 15 dias atrasado
  const sch = installmentSchedule(store.data.installments[0]);
  assert.equal(sch[0].paidAt, '2026-09-25');
  assert.equal(sch[0].paidAtKnown, true);
  const item = computeMonth(store.data, '2026-09', today).items.find((i) => i.kind === 'installment');
  assert.equal(item.paidAt, '2026-09-25');
  // pagar pela lista também grava a data informada
  const oct = computeMonth(store.data, '2026-10', today).items.find((i) => i.kind === 'installment');
  A.setItemPaid(oct, true, '2026-10-03');
  assert.equal(store.data.installments[0].paidOn[2], '2026-10-03');
  A.setItemPaid({ ...oct, status: 'paid' }, false);
  assert.equal(store.data.installments[0].paidOn[2], undefined);
});

test('item 5: reserva não conta em dobro e não é reconhecida pelo nome', () => {
  reset();
  // meta chamada "Reserva" sem marcação: não conta
  A.saveGoal({ description: 'Reserva', targetCents: 2000000, initialCents: 800000 });
  A.saveInvestment({ name: 'CDB liquidez', type: 'cdb', rateKind: 'cdi', rateBp: 10000, liquidity: 'd0', emergency: true, initialCents: 632900, initialDate: today });
  let r = emergencyCoverage(store.data, '2026-10', today);
  assert.equal(r.saved, 632900);
  // marcada como reserva e sem ligação: provável duplicidade → vale o maior (8.000), não 14.329
  const g = store.data.goals.find((x) => x.description === 'Reserva');
  A.saveGoal({ ...g, id: g.id, emergency: true });
  r = emergencyCoverage(store.data, '2026-10', today);
  assert.equal(r.saved, 800000);
  assert.equal(r.overlap, true);
  // ligada ao investimento: conta uma vez (contribuições + investimento ligado)
  A.saveGoal({ ...store.data.goals.find((x) => x.id === g.id), id: g.id, emergency: true, investmentIds: [store.data.investments[0].id] });
  r = emergencyCoverage(store.data, '2026-10', today);
  assert.equal(r.overlap, false);
  assert.equal(r.saved, 800000 + 632900);
});

test('item 5: migração do formato antigo marca a meta antiga de reserva uma única vez', () => {
  const v7 = { ...emptyState(), schema: 7, goals: [{ id: 'g1', description: 'Reserva de emergência', targetCents: 100, contributions: [] }, { id: 'g2', description: 'Viagem', targetCents: 100, contributions: [] }] };
  const s = sanitizeState(v7);
  // a antiga "Reserva de emergência" vira a reserva padrão (sem criar outra)
  assert.equal(s.goals.find((x) => x.id === 'g1').emergency, true);
  assert.equal(s.goals.find((x) => x.id === 'g1').system, true);
  assert.equal(s.goals.filter((x) => x.emergency).length, 1);
  assert.equal(s.goals.find((x) => x.id === 'g2').emergency, false);
  // formato novo: o nome não marca nada, vale o tipo
  const v8 = sanitizeState({ ...s, goals: [...s.goals, { id: 'g3', description: 'Reserva da casa', targetCents: 100, kind: 'compra', contributions: [] }] });
  assert.equal(v8.goals.find((x) => x.id === 'g3').emergency, false);
});

test('item 6: 4 contas atrasadas + meta de gastos estourada não dá nota "Boa"', () => {
  reset();
  A.savePayrollBase({ fromYM: '2026-01', grossCents: 650000, dependents: 0 });
  A.setSpendingLimit(100000);
  for (let i = 1; i <= 4; i++) A.saveExpense({ description: `Atrasada ${i}`, cents: 26500, dueDate: `2026-10-0${i}` });
  const s = financialScore(store.data, '2026-10', today);
  assert.ok(s.score < 60, `nota ${s.score}`);
  assert.ok(['Atenção', 'Crítica'].includes(s.grade));
  // Com reserva e poupança boas, o teto de 3+ atrasadas ainda segura a nota em 49
  A.saveInvestment({ name: 'Reserva', type: 'cdb', rateKind: 'cdi', rateBp: 10000, liquidity: 'd0', emergency: true, initialCents: 5000000, initialDate: '2026-01-02' });
  const capped = financialScore(store.data, '2026-10', today);
  assert.ok(capped.score <= 49, `nota ${capped.score}`);
  assert.ok(capped.raw > capped.score);
  assert.ok(capped.caps.some((c) => /atrasadas/.test(c.reason)));
});

test('item 7: mesmo item editado nos dois aparelhos vira conflito registrado', () => {
  const base = { ...emptyState(), expenses: [{ id: 'a', description: 'Luz', cents: 100, dueDate: '2026-10-01' }] };
  const local = structuredClone(base); local.expenses[0].cents = 150;
  const remote = structuredClone(base); remote.expenses[0].cents = 180;
  const { state, conflicts } = mergeWithConflicts(base, local, remote);
  assert.equal(state.expenses[0].cents, 180); // a nuvem vence por padrão…
  assert.equal(conflicts.length, 1); // …mas a edição local não some
  assert.equal(conflicts[0].collection, 'expenses');
  assert.equal(conflicts[0].local.cents, 150);
  assert.deepEqual(conflicts[0].fields, ['cents']);
});

test('item 14: gasto por dia separa o que vence antes e depois do salário', () => {
  reset();
  A.savePayrollBase({ fromYM: '2026-01', grossCents: 500000, dependents: 0, salaryDay: 20 });
  A.saveExpense({ description: 'Antes', cents: 30000, dueDate: '2026-10-18' });
  A.saveExpense({ description: 'Depois', cents: 90000, dueDate: '2026-10-25' });
  const r = spendingRoom(store.data, today);
  assert.equal(r.nextPay, '2026-10-20');
  assert.equal(r.dueBefore, 30000);
  assert.equal(r.dueAfter, 90000);
  assert.equal(r.days, 5);
  // com conta cadastrada, usa o saldo real
  A.saveAccount({ name: 'Nubank', kind: 'digital', anchorCents: 100000, anchorDate: today });
  const r2 = spendingRoom(store.data, today);
  assert.equal(r2.source, 'accounts');
  assert.equal(r2.perDay, Math.floor((100000 - 30000) / 5));
  const flow = dailyCashflow(store.data, today);
  assert.ok(flow.points.length > 5);
  assert.equal(flow.points.find((p) => p.date === '2026-10-18').out, 30000);
});

test('item 27: estado dividido por coleção e ano, só o que mudou é enviado', async () => {
  const s = emptyState();
  s.expenses = [{ id: 'a', dueDate: '2025-05-01', cents: 1 }, { id: 'b', dueDate: '2026-05-01', cents: 2 }];
  s.closedMonths = { '2025-12': { x: 1 }, '2026-01': { y: 2 } };
  const parts = splitChunks(s);
  assert.ok(parts['expenses:2025'] && parts['expenses:2026']);
  assert.ok(parts['closedMonths:2025'] && parts['closedMonths:2026']);
  const back = joinChunks(parts);
  assert.deepEqual(back.expenses.map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(back.closedMonths).sort(), ['2025-12', '2026-01']);
  assert.equal(back.schema, s.schema);
  const h1 = await hashChunks(parts);
  s.expenses[1].cents = 3;
  const h2 = await hashChunks(splitChunks(s));
  const prev = Object.fromEntries(Object.entries(h1).map(([k, v]) => [k, { hash: v }]));
  assert.deepEqual(diffChunks(h2, prev).changed, ['expenses:2026']);
});

test('item 30: compras entram na fatura certa pelo dia de fechamento', () => {
  reset();
  const card = A.saveCard({ name: 'Nubank', closingDay: 3, dueDay: 10, limitCents: 500000 });
  assert.equal(invoiceMonthFor(card, '2026-10-02'), '2026-10'); // antes do fechamento
  assert.equal(invoiceMonthFor(card, '2026-10-03'), '2026-11'); // no fechamento: próxima
  const c2 = { closingDay: 25, dueDay: 5 };
  assert.equal(invoiceMonthFor(c2, '2026-10-20'), '2026-11'); // vence no mês seguinte ao fechamento
  A.saveCardPurchase({ cardId: card.id, description: 'Geladeira', date: '2026-10-01', cents: 300000, count: 3 });
  A.saveCardPurchase({ cardId: card.id, description: 'Mercado', date: '2026-10-05', cents: 20000 });
  const oct = invoice(store.data, card, '2026-10', today);
  const nov = invoice(store.data, card, '2026-11', today);
  assert.equal(oct.total, 100000);
  assert.equal(nov.total, 120000);
  assert.equal(purchaseSchedule(card, store.data.cardPurchases[0]).length, 3);
  // a fatura é uma conta do mês
  const item = computeMonth(store.data, '2026-11', today).items.find((i) => i.kind === 'invoice');
  assert.equal(item.cents, 120000);
  assert.equal(item.dueDate, '2026-11-10');
  assert.equal(cardUsage(store.data, card, today).used, 320000);
  A.setItemPaid(computeMonth(store.data, '2026-10', today).items.find((i) => i.kind === 'invoice'), true, '2026-10-10');
  assert.equal(cardUsage(store.data, card, today).used, 220000);
});

test('item 31/32: saldo da conta, transferências e diferença com o banco', () => {
  reset();
  const nu = A.saveAccount({ name: 'Nubank', kind: 'digital', anchorCents: 100000, anchorDate: '2026-10-01' });
  const cash = A.saveAccount({ name: 'Carteira', kind: 'carteira', anchorCents: 0, anchorDate: '2026-10-01' });
  A.saveExpense({ description: 'Mercado', cents: 20000, dueDate: '2026-10-05', paid: true, paidAt: '2026-10-05', accountId: nu.id });
  A.saveTransfer({ fromId: nu.id, toId: cash.id, cents: 10000, date: '2026-10-06' });
  const d = store.data;
  assert.equal(accountBalance(d, d.accounts[0], today), 70000);
  assert.equal(accountBalance(d, d.accounts[1], today), 10000);
  A.checkBalance(nu.id, 65000, today);
  const sum = accountsSummary(store.data, today);
  assert.equal(sum.list.find((x) => x.account.id === nu.id).diff, -5000);
  assert.equal(sum.total, 80000);
});

test('item 43: recorrência semanal, quinzenal, bimestral e anual', () => {
  const w = { id: 'w', startYM: '2026-10', dueDay: 1, freq: 'weekly', anchorDate: '2026-10-02' };
  assert.deepEqual(recurringDates(w, '2026-10'), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  assert.deepEqual(recurringDates(w, '2026-11'), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  const b = { id: 'b', startYM: '2026-01', dueDay: 10, freq: 'bimonthly' };
  assert.equal(recurringDates(b, '2026-03').length, 1);
  assert.equal(recurringDates(b, '2026-04').length, 0);
  const y = { id: 'y', startYM: '2026-02', dueDay: 15, freq: 'annual' };
  assert.deepEqual(recurringDates(y, '2027-02'), ['2027-02-15']);
  assert.deepEqual(recurringDates(y, '2027-03'), []);
});

test('item 44: conta variável usa a média dos últimos valores', () => {
  reset();
  A.saveRecurring({ description: 'Luz', cents: 15000, dueDay: 10, startYM: '2026-06', variable: true });
  const r = store.data.recurring[0];
  A.setRecurringMonthAmount(r.id, '2026-07', 18000);
  A.setRecurringMonthAmount(r.id, '2026-08', 21000);
  A.setRecurringMonthAmount(r.id, '2026-09', 24000);
  assert.equal(variableEstimate(store.data, store.data.recurring[0], '2026-10'), 21000);
  const item = computeMonth(store.data, '2026-10', today).items.find((i) => i.kind === 'recurring');
  assert.equal(item.cents, 21000);
  assert.equal(item.estimated, true);
});

test('item 42: reajuste anual pelo índice no mês do aniversário', () => {
  reset();
  A.saveRecurring({ description: 'Aluguel', cents: 200000, dueDay: 5, startYM: '2025-10', adjust: { index: 'igpm', month: 10 } });
  store.data.settings.indices.igpm12Bp = 500; // 5%
  const out = A.applyReadjustments('2026-10-02');
  assert.equal(out.length, 1);
  assert.equal(store.data.recurring[0].cents, 210000);
  assert.equal(A.applyReadjustments('2026-10-20').length, 0); // uma vez por ano
});

test('item 75: conciliação liga a transação do extrato à conta já lançada', () => {
  reset();
  A.saveExpense({ description: 'Energia Enel', cents: 18750, dueDate: '2026-10-10' });
  const rows = [
    { date: '2026-10-11', description: 'PAG ENEL ENERGIA', cents: 18750 },
    { date: '2026-10-11', description: 'IFOOD', cents: 4590 },
  ];
  const out = reconcile(store.data, rows, today);
  assert.equal(out[0].match.description, 'Energia Enel');
  assert.equal(out[1].match, null);
  const res = A.importTransactions(out);
  assert.equal(res.matched, 1);
  assert.equal(res.expenses, 1);
  assert.equal(store.data.expenses.find((e) => e.description === 'Energia Enel').paidAt, '2026-10-11');
});

test('item 48: escala de plantões gera as rendas do mês', () => {
  reset();
  A.saveShiftType({ id: 'p12', name: 'Plantão 12h', hours: 12, cents: 60000, payroll: false });
  A.addShifts(['2026-10-03', '2026-10-10', '2026-10-17'], 'p12');
  const inc = shiftIncomes(store.data, '2026-10');
  const line = inc.find((x) => x.description.startsWith('Plantão 12h'));
  assert.equal(line.cents, 180000);
  assert.equal(line.count, 3);
  assert.equal(computeMonth(store.data, '2026-10', today).income.extrasCents, 180000);
});

test('itens 47, 53 e 54: tabelas ausentes, PLR e outro vínculo', () => {
  registerCustomTables({});
  assert.equal(tablesFor(2027).missing, true);
  assert.equal(tablesFor(2026).missing, false);
  registerCustomTables({ 2027: { ...tablesFor(2026), custom: true } });
  assert.equal(tablesFor(2027).missing, false);
  registerCustomTables({});
  assert.equal(plrTax(500000), 0); // até R$ 7.640,80: isento
  assert.ok(plrTax(1000000) > 0);
  const b = benefitsIn({ benefits: [{ id: 'x', kind: 'plr', name: 'PLR', cents: 1000000, month: 3 }, { id: 'v', kind: 'va', name: 'VA', cents: 80000, monthly: true }] }, '2026-03');
  assert.equal(b.cash.length, 1);
  assert.equal(b.cardTotal, 80000);
  const pj = jobNet({ kind: 'pj', grossCents: 1000000, pjTaxBp: 600 }, '2026-10');
  assert.equal(pj.net, 940000);
});

test('item 82: excluir pode ser desfeito', () => {
  reset();
  const e = A.saveExpense({ description: 'Teste', cents: 1000, dueDate: '2026-10-10' });
  A.deleteExpense(e.id);
  assert.equal(store.data.expenses.length, 0);
  assert.equal(store.undo(), 'Conta excluída');
  assert.equal(store.data.expenses.length, 1);
});

test('item 34/35: gasto dividido entre categorias e etiquetas', () => {
  reset();
  const [c1, c2] = store.data.categories;
  A.saveExpense({ description: 'Mercado', cents: 30000, dueDate: '2026-10-10', tags: '#viagem-natal reforma', splits: [{ categoryId: c1.id, cents: 20000 }, { categoryId: c2.id, cents: 10000 }] });
  const m = computeMonth(store.data, '2026-10', today);
  assert.equal(m.categories.find((c) => c.id === c1.id).cents, 20000);
  assert.equal(m.categories.find((c) => c.id === c2.id).cents, 10000);
  assert.deepEqual(store.data.expenses[0].tags, ['viagem-natal', 'reforma']);
  assert.throws(() => A.saveExpense({ description: 'X', cents: 30000, dueDate: '2026-10-10', splits: [{ categoryId: c1.id, cents: 1000 }, { categoryId: c2.id, cents: 1000 }] }), /faltam/);
});
