// Pente fino nos cálculos (3.5.0): cada teste é um caso que dava valor
// errado antes da correção.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyState } from '../js/domain/schema.js';
import { invoiceLines, cardUsage, scaleSplits } from '../js/domain/cards.js';
import { salaryBalanceDays, vacationAvos } from '../js/domain/termination.js';
import { stockSalesTax } from '../js/domain/investPlus.js';
import { averageMonthlyContribution } from '../js/domain/investments.js';
import { canIBuy } from '../js/domain/yearplan.js';
import { isBusinessDay } from '../js/core/calendar.js';

test('assinatura no cartão cobrada depois do fechamento vai para a fatura seguinte (como uma compra)', () => {
  const s = createEmptyState();
  const card = { id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10 };
  s.cards = [card];
  s.recurring = [{ id: 'nf', description: 'Netflix', cents: 5590, dueDay: 20, startYM: '2026-09', endYM: null, cardId: 'c1' }];
  const has = (ym) => invoiceLines(s, card, ym).some((l) => l.purchase.recurringId === 'nf' && l.purchase.date === '2026-10-20');
  assert.equal(has('2026-10'), false, 'fatura de outubro já fechou em 03/10');
  assert.equal(has('2026-11'), true, 'cobrança de 20/10 vence em 10/11');
});

test('limite usado conta a assinatura do cartão mesmo sem compras', () => {
  const s = createEmptyState();
  const card = { id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10, limitCents: 100000 };
  s.cards = [card];
  s.recurring = [{ id: 'sp', description: 'Spotify', cents: 2190, dueDay: 15, startYM: '2026-09', endYM: null, cardId: 'c1' }];
  assert.ok(cardUsage(s, card, '2026-10-16').used >= 2190);
});

test('divisão entre categorias sempre fecha com o total', () => {
  const parts = scaleSplits([{ categoryId: 'a', cents: 50 }, { categoryId: 'b', cents: 50 }], 1);
  assert.equal(parts.reduce((a, p) => a + p.cents, 0), 1);
  const three = scaleSplits([{ categoryId: 'a', cents: 1 }, { categoryId: 'b', cents: 1 }, { categoryId: 'c', cents: 1 }], 100);
  assert.equal(three.reduce((a, p) => a + p.cents, 0), 100);
});

test('rescisão: saldo de salário em mês comercial (30 dias) e avos de férias por mês de calendário', () => {
  assert.equal(salaryBalanceDays('2026-07-31'), 30); // antes: 31 dias
  assert.equal(salaryBalanceDays('2026-02-28'), 30); // antes: 28 dias
  assert.equal(salaryBalanceDays('2026-10-18'), 18);
  // período aquisitivo de 10/03/2026; contrato até 23/11/2026 (com aviso): 8 meses cheios + 14 dias
  assert.equal(vacationAvos('2026-03-10', '2026-11-23'), 8); // antes: 9 (blocos de 30 dias)
  assert.equal(vacationAvos('2026-03-10', '2026-11-24'), 9); // 15 dias completam mais um avo
});

test('DARF vence no último dia ÚTIL do mês seguinte (nunca num domingo)', () => {
  const s = createEmptyState();
  s.investments = [{
    id: 'x', name: 'PETR4', type: 'acoes', ticker: 'PETR4', institution: '', rate: { kind: 'none', bp: 0 }, liquidity: 'd2', maturity: null, emergency: false, notes: '',
    movements: [
      { id: 'a', kind: 'aporte', date: '2026-01-05', cents: 3000000, qty: 1000, note: '' },
      { id: 'v', kind: 'venda', date: '2026-04-10', cents: 2500000, qty: 500, note: '' }, // venda em abril → DARF em maio
    ],
  }];
  const m = stockSalesTax(s, 2026).months.find((x) => x.ym === '2026-04');
  assert.equal(m.darfDue, '2026-05-29'); // 31/05/2026 é domingo
  assert.ok(isBusinessDay(m.darfDue, { saturdayCounts: false }));
});

test('aporte médio desconta vendas (independência financeira)', () => {
  const s = createEmptyState();
  s.investments = [{
    id: 'x', name: 'ITSA4', type: 'acoes', ticker: 'ITSA4', institution: '', rate: { kind: 'none', bp: 0 }, liquidity: 'd2', maturity: null, emergency: false, notes: '',
    movements: [
      { id: 'a', kind: 'aporte', date: '2026-09-10', cents: 100000, qty: 10, note: '' },
      { id: 'v', kind: 'venda', date: '2026-09-20', cents: 100000, qty: 10, note: '' },
    ],
  }];
  assert.equal(averageMonthlyContribution(s, 6, '2026-10-15'), 0);
});

test('"Posso comprar?" à vista: uma compra pequena também diminui o que sobra no mês', () => {
  const s = createEmptyState();
  s.settings.salaryHistory = [{ from: '2026-01', grossCents: 500000, dependents: 0, additions: [], deductions: [] }];
  const r = canIBuy(s, { cents: 40000, count: 1 }, 3, '2026-10-15');
  assert.equal(r.months[0].before - r.months[0].after, 40000);
});
