// Regressões da revisão completa (3.4.0): cada teste reproduz um bug
// encontrado e corrigido, para ele não voltar.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { store } from '../js/core/store.js';
import { sanitizeState } from '../js/domain/schema.js';
import { computeMonth, incomeFor } from '../js/domain/ledger.js';
import { invoice, cardUsage } from '../js/domain/cards.js';
import { thirteenthFor, vacationFor } from '../js/domain/payroll.js';
import { simulate, calendarEvents, employerIncomeFn } from '../js/domain/planning.js';
import { accountBalance } from '../js/domain/accounts.js';
import { canIBuy } from '../js/domain/yearplan.js';
import * as A from '../js/domain/actions.js';
import { emptyState } from './helpers.mjs';

const profile = (cents) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [] });
const card = { id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10, limitCents: 500000, color: '#000000', accountId: null, archived: false };

before(() => {
  store.guest = false; // conta aberta (sem login, alterações pedem para entrar)
  console.warn = () => {};
});

test('fechar o mês: o mês aparece fechado na hora e a conta variável fica com a estimativa que aparecia', () => {
  store.data = emptyState();
  const d = store.data;
  d.settings.salaryHistory = [profile(400000)];
  d.recurring.push({ id: 'luz', description: 'Luz', cents: 15000, dueDay: 10, startYM: '2026-01', endYM: null, freq: 'monthly', variable: true, tags: [] });
  d.recurringEntries['luz|2026-07'] = { paidAt: '2026-07-10', cents: 20000, skipped: false };
  d.recurringEntries['luz|2026-08'] = { paidAt: '2026-08-10', cents: 22000, skipped: false };
  d.recurringEntries['luz|2026-09'] = { paidAt: '2026-09-10', cents: 24000, skipped: false };
  const today = new Date().toISOString().slice(0, 10);
  const shown = computeMonth(store.data, '2026-09', today).items.find((i) => i.refId === 'luz').cents;
  A.closeMonth('2026-09');
  assert.equal(computeMonth(store.data, '2026-09', today).closed, true, 'sem cache velho de "aberto"');
  // set/26 já tinha valor confirmado; out (sem valor) usaria a média: confere o mês fechado
  assert.equal(store.data.closedMonths['2026-09'].items.find((i) => i.description === 'Luz').cents, shown);
  store.data = emptyState();
  const s = store.data;
  s.recurring.push({ id: 'luz', description: 'Luz', cents: 15000, dueDay: 10, startYM: '2026-01', endYM: null, freq: 'monthly', variable: true, tags: [] });
  for (const [ym, c] of [['2026-06', 20000], ['2026-07', 22000], ['2026-08', 24000]]) s.recurringEntries[`luz|${ym}`] = { paidAt: `${ym}-10`, cents: c, skipped: false };
  A.closeMonth('2026-09');
  assert.equal(store.data.recurringEntries['luz|2026-09'].cents, 22000, 'média dos 3 últimos, não o cadastro (R$ 150)');
});

test('fatura com estorno maior que as compras: o crédito abate a fatura seguinte', () => {
  const s = emptyState();
  s.cards.push(card);
  s.cardPurchases.push({ id: 'p1', cardId: 'c1', description: 'Compra', date: '2026-10-05', cents: 10000, count: 1, tags: [] });
  s.cardPurchases.push({ id: 'p2', cardId: 'c1', description: 'Estorno', date: '2026-10-06', cents: -35000, count: 1, tags: [] });
  s.cardPurchases.push({ id: 'p3', cardId: 'c1', description: 'Mercado', date: '2026-11-05', cents: 40000, count: 1, tags: [] });
  const nov = invoice(s, card, '2026-11', '2026-10-15');
  const dec = invoice(s, card, '2026-12', '2026-10-15');
  assert.equal(nov.total, -25000);
  assert.equal(dec.total, 40000 - 25000, 'crédito de R$ 250 entra em dezembro');
  assert.ok(dec.lines.some((l) => l.purchase.locked));
  // categorias não recebem o crédito (não é gasto) e o limite não desconta duas vezes
  assert.equal(dec.parts.reduce((a, p) => a + p.cents, 0), 40000);
  assert.equal(cardUsage(s, card, '2026-10-15').used, 10000 - 35000 + 40000);
});

test('13º adiantado nas férias: dezembro desconta o valor que foi pago, não a parcela recalculada', () => {
  const s = emptyState();
  s.settings.salaryHistory = [profile(500000)];
  s.settings.employment.admission = '2020-01-01';
  s.settings.vacations = [{ id: 'v', start: '2026-07-01', days: 30, sellDays: 0, advance13: true }];
  const extras = (ym) => (ym >= '2026-01' && ym <= '2026-10' ? 100000 : 0); // plantões elevam a média
  // o recibo de férias usa a média até junho; dezembro usa a média até novembro
  const vac = vacationFor(s.settings, '2026-07', extras);
  const dec = thirteenthFor(s.settings, '2026-12', extras);
  assert.equal(dec.first, vac.advance13Cents);
  assert.equal(dec.net, dec.gross - vac.advance13Cents - dec.inss - dec.ir);
});

test('saldo da conta-salário conta o 13º (e não só o salário)', () => {
  const s = emptyState();
  s.settings.salaryHistory = [profile(500000)];
  s.settings.employment.admission = '2020-01-01';
  s.accounts.push({ id: 'a1', name: 'Banco', kind: 'salario', institution: '', color: '#000000', anchor: { cents: 0, date: '2026-12-01' }, archived: false });
  s.settings.salaryAccountId = 'a1';
  const dec13 = incomeFor(s, '2026-12').thirteenth.net;
  const bal = accountBalance(s, s.accounts[0], '2026-12-22', { salaryFn: employerIncomeFn(s) });
  const salary = incomeFor(s, '2026-12');
  assert.equal(bal, salary.salary + salary.payrollExtrasNet + dec13);
});

test('simulador: cancelar recorrente que começa no mês da simulação tira ela de todos os meses', () => {
  const s = emptyState();
  s.settings.salaryHistory = [profile(400000)];
  s.recurring.push({ id: 'gym', description: 'Academia', cents: 20000, dueDay: 5, startYM: '2026-11', endYM: null, freq: 'monthly', tags: [] });
  const r = simulate(s, { cutRecurring: ['gym'] }, '2026-11', 3, '2026-10-15');
  assert.deepEqual(r.diff, [20000, 20000, 20000]);
});

test('Agenda: fechamento do cartão no dia certo e com o valor da fatura que fecha', () => {
  const s = emptyState();
  const late = { ...card, id: 'c2', closingDay: 28, dueDay: 5 }; // fecha 28, vence 5 do mês seguinte
  s.cards.push(card, late);
  s.cardPurchases.push({ id: 'p', cardId: 'c2', description: 'Loja', date: '2026-10-10', cents: 10000, count: 1, tags: [] });
  const ev = calendarEvents(s, '2026-10', '2026-10-15');
  assert.ok(ev['2026-10-03']?.some((e) => e.type === 'card'), 'cartão que fecha dia 3 aparece mesmo com fatura vazia');
  const c2 = ev['2026-10-28'].find((e) => e.type === 'card');
  assert.equal(c2.cents, 10000, 'a fatura que fecha em 28/out (vence 5/nov) tem a compra');
});

test('"Posso comprar?" parcelado não perde centavos', () => {
  const s = emptyState();
  s.settings.salaryHistory = [profile(400000)];
  const r = canIBuy(s, { cents: 100000, count: 3 }, 12, '2026-10-15');
  const paid = r.months.reduce((a, m) => a + (m.before - m.after), 0);
  assert.equal(paid, 100000);
});

test('backup: recorrente com fim antes do início ou cartão inexistente não some', () => {
  const s = sanitizeState({
    schema: 9, settings: {}, expenses: [], cards: [],
    recurring: [
      { id: 'r1', description: 'A', cents: 1000, dueDay: 5, startYM: '2026-05', endYM: '2026-01' },
      { id: 'r2', description: 'B', cents: 1000, dueDay: 5, startYM: '2026-01', cardId: 'sumiu' },
    ],
  });
  assert.equal(s.recurring.find((r) => r.id === 'r1').endYM, null);
  assert.equal(s.recurring.find((r) => r.id === 'r2').cardId, null);
  const items = computeMonth(s, '2026-10', '2026-10-15').items.map((i) => i.refId);
  assert.ok(items.includes('r1') && items.includes('r2'));
});

test('excluir em lote não mexe em mês fechado', () => {
  store.data = emptyState();
  store.data.recurring.push({ id: 'r', description: 'Net', cents: 10000, dueDay: 5, startYM: '2026-01', endYM: null, freq: 'monthly', tags: [] });
  A.closeMonth('2026-08');
  const item = computeMonth(store.data, '2026-08', '2026-10-15').items.find((i) => i.refId === 'r');
  assert.throws(() => A.deleteItems([item]), /fechad/i);
});

test('pagar fatura guarda o valor pago (mudar uma compra depois não altera a fatura paga)', () => {
  store.data = emptyState();
  store.data.cards.push(card);
  store.data.cardPurchases.push({ id: 'p', cardId: 'c1', description: 'Loja', date: '2026-09-10', cents: 30000, count: 1, tags: [] });
  const item = computeMonth(store.data, '2026-10', '2026-10-15').items.find((i) => i.kind === 'invoice');
  A.setItemPaid(item, true, '2026-10-10');
  assert.equal(store.data.cardInvoices['c1|2026-10'].cents, 30000);
});
