// Início do uso do app: quem cria a conta em 16/10 e cadastra contas
// "desde janeiro" não tem 9 meses de atraso — os cálculos contam a
// partir do mês em que começou a usar o app (js/domain/tracking.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyState, sanitizeState } from '../js/domain/schema.js';
import { computeMonth, overdueBefore, creditorOutstanding, creditorMonthly, creditorsInMonth, installmentSummary } from '../js/domain/ledger.js';
import { monthsWithData, monthSeries, projection } from '../js/domain/analysis.js';
import { scoreHistory, financialScore } from '../js/domain/planning.js';
import { cardUsage, invoice } from '../js/domain/cards.js';
import { trackingStartYM, detectedStartYM, beforeStart } from '../js/domain/tracking.js';

const TODAY = '2026-10-20';

/** Conta criada em 16/10/2026 com tudo cadastrado "desde janeiro". */
function lateStarter() {
  const s = createEmptyState();
  s.createdAt = '2026-10-16T13:00:00.000Z';
  s.settings.salaryHistory = [{ from: '2026-01', grossCents: 500000, dependents: 0, additions: [], deductions: [] }];
  s.creditors = [{ id: 'banco', name: 'Banco', notes: '' }, { id: 'imob', name: 'Imobiliária', notes: '' }];
  s.recurring.push({ id: 'aluguel', description: 'Aluguel', cents: 150000, dueDay: 10, startYM: '2026-01', endYM: null, freq: 'monthly', tags: [], creditorId: 'imob' });
  s.installments.push({
    id: 'emp', description: 'Empréstimo', totalCents: 1200000, count: 12, firstDueDate: '2026-01-20', dueDay: 20,
    paid: [], paidOn: {}, creditorId: 'banco',
  });
  s.cards = [{ id: 'nu', name: 'Nubank', closingDay: 3, dueDay: 10, limitCents: 500000 }];
  s.recurring.push({ id: 'netflix', description: 'Netflix', cents: 5000, dueDay: 15, startYM: '2026-01', endYM: null, freq: 'monthly', tags: [], cardId: 'nu' });
  return s;
}

test('o início é o mês em que a conta foi criada', () => {
  const s = lateStarter();
  assert.equal(trackingStartYM(s), '2026-10');
  assert.ok(beforeStart(s, '2026-09'));
  assert.ok(!beforeStart(s, '2026-10'));
});

test('nada de "atrasado" de antes do início (recorrente, parcela, fatura)', () => {
  const s = lateStarter();
  assert.deepEqual(overdueBefore(s, '2026-10', TODAY), []);
  const oct = computeMonth(s, '2026-10', TODAY);
  assert.ok(oct.items.some((i) => i.refId === 'aluguel'));                   // outubro conta
  assert.ok(oct.items.some((i) => i.kind === 'installment' && i.parcel.n === 10));
  assert.equal(oct.items.filter((i) => i.status === 'overdue' && i.refId === 'aluguel').length, 1); // venceu 10/10 e não foi paga
  const mar = computeMonth(s, '2026-03', TODAY);
  assert.equal(mar.items.length, 0);
  assert.equal(mar.income.total, 0);
  assert.ok(mar.beforeStart);
});

test('saldo devedor: parcelas de antes do início contam como pagas', () => {
  const s = lateStarter();
  const sum = installmentSummary(s.installments[0], trackingStartYM(s));
  assert.equal(sum.paidCount, 9);                       // jan–set, antes do app
  assert.equal(sum.remainingCents, 300000);             // out, nov, dez
  assert.equal(creditorOutstanding(s, 'banco', TODAY).outstanding, 300000);
  assert.equal(creditorMonthly(s, 'banco', '2026-10', 1, TODAY)[0].dueCents, 100000);
  const banco = creditorsInMonth(s, '2026-10', TODAY).list.find((x) => x.creditor.id === 'banco');
  assert.equal(banco.total, 100000);
  const imob = creditorsInMonth(s, '2026-10', TODAY).list.find((x) => x.creditor.id === 'imob');
  assert.equal(imob.total, 150000);                     // só outubro, sem jan–set
});

test('cartão: faturas de antes do início são pagas e não ocupam limite', () => {
  const s = lateStarter();
  assert.equal(invoice(s, s.cards[0], '2026-05', TODAY).status, 'paid');
  assert.ok(cardUsage(s, s.cards[0], TODAY).used <= 10000);   // no máximo as cobranças desde outubro
});

test('histórico, médias e nota só a partir do início', () => {
  const s = lateStarter();
  assert.deepEqual(monthsWithData(s, TODAY), ['2026-10']);
  const series = monthSeries(s, '2026-09', 3, TODAY);
  assert.ok(series.every((m) => m.income === 0 && m.spent === 0));
  assert.ok(scoreHistory(s, '2026-10', 6, TODAY).filter((h) => h.ym < '2026-10').every((h) => h.score == null));
  assert.ok(!financialScore(s, '2026-10', TODAY).caps.some((c) => /atras/i.test(c.reason)));
  // a previsão de novembro não usa a "média" de meses vazios de antes do início
  assert.ok(projection(s, '2026-11', 1, TODAY)[0].income > 0);
});

test('gasto avulso antigo lançado à mão continua valendo (dívida real)', () => {
  const s = lateStarter();
  s.expenses.push({ id: 'velha', description: 'Conta antiga', cents: 20000, dueDate: '2026-06-05', paidAt: null, categoryId: null, tags: [], creditorId: 'imob' });
  const older = overdueBefore(s, '2026-10', TODAY);
  assert.deepEqual(older.map((i) => i.refId), ['velha']);
});

test('o início pode ser escolhido; meses fechados e backups antigos puxam o início para trás', () => {
  const s = lateStarter();
  s.settings.trackingStartYM = '2026-08';
  assert.equal(trackingStartYM(s), '2026-08');
  assert.equal(overdueBefore(s, '2026-10', TODAY).filter((i) => i.refId === 'aluguel').length, 2); // ago e set
  assert.equal(sanitizeState(s).settings.trackingStartYM, '2026-08');
  s.settings.trackingStartYM = 'lixo';
  assert.equal(sanitizeState(s).settings.trackingStartYM, null);

  const t = lateStarter();
  t.lastBackupAt = '2026-07-01T10:00:00.000Z';
  assert.equal(detectedStartYM(t), '2026-07');
});
