// Testes das funcionalidades da 3.0: dia útil, férias, orçamento,
// pontuação, simulador, agenda/.ics e importação de extratos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { easter, nthBusinessDay, isBusinessDay, holidayName } from '../js/core/calendar.js';
import { createEmptyState } from '../js/domain/schema.js';
import { paydayIn, nextPaydayFrom, vacationFor, payrollFor } from '../js/domain/payroll.js';
import { computeMonth } from '../js/domain/ledger.js';
import { budgetStatus, financialScore, simulate, calendarEvents, monthGrid, buildICS, dueReminders } from '../js/domain/planning.js';
import { parseOFX, parseCSV, parseStatement, suggestCategory, cleanDescription, fingerprint } from '../js/domain/importer.js';

const profile = (cents) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [] });

test('feriados e Páscoa', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  assert.equal(holidayName('2026-04-03'), 'Sexta-feira Santa');
  assert.equal(holidayName('2026-11-20'), 'Dia Nacional de Zumbi e da Consciência Negra');
  assert.equal(isBusinessDay('2026-11-02'), false); // Finados
  assert.equal(isBusinessDay('2026-10-10'), true);  // sábado conta (CLT)
  assert.equal(isBusinessDay('2026-10-10', { saturdayCounts: false }), false);
});

test('5º dia útil (com e sem sábado)', () => {
  assert.equal(nthBusinessDay('2026-11', 5), '2026-11-07');                      // 3,4,5,6,7 (2 é Finados)
  assert.equal(nthBusinessDay('2026-11', 5, { saturdayCounts: false }), '2026-11-09');
  assert.equal(nthBusinessDay('2026-10', 5), '2026-10-06');
  assert.equal(nthBusinessDay('2026-10', 5, { saturdayCounts: false }), '2026-10-07');
});

test('data de pagamento: dia fixo x dia útil', () => {
  const s = createEmptyState().settings;
  s.salaryDay = 10;
  assert.equal(paydayIn(s, '2026-02'), '2026-02-10');
  s.payday = { mode: 'business', nth: 5, saturday: true };
  assert.equal(paydayIn(s, '2026-11'), '2026-11-07');
  assert.equal(nextPaydayFrom(s, '2026-11-07'), '2026-11-07');
  assert.equal(nextPaydayFrom(s, '2026-11-08'), '2026-12-05'); // dez/26: ter 1 … sáb 5
});

test('férias: 1/3, abono sem impostos e salário só dos dias trabalhados', () => {
  const s = createEmptyState().settings;
  s.salaryHistory = [profile(300000)];
  s.vacations = [{ id: 'v', start: '2026-07-01', days: 20, sellDays: 10, advance13: false }];
  const v = vacationFor(s, '2026-07');
  assert.equal(v.pay, 200000);              // 3.000 ÷ 30 × 20
  assert.equal(v.third, 66667);             // 1/3
  assert.equal(v.abono, 100000 + 33333);    // 10 dias + 1/3, sem INSS/IR
  assert.equal(payrollFor(s, '2026-07').base, 100000); // salário do mês: 10 dias
  assert.equal(vacationFor(s, '2026-08'), null);
});

test('orçamento por categoria e pontuação financeira', () => {
  const st = createEmptyState();
  st.settings.salaryHistory = [profile(500000)];
  const cat = st.categories[1];
  st.settings.budgets = { [cat.id]: 50000 };
  st.expenses.push({ id: 'e', description: 'Mercado', cents: 45000, dueDate: '2026-10-05', paidAt: '2026-10-05', categoryId: cat.id });
  const [b] = budgetStatus(st, '2026-10', '2026-10-12');
  assert.equal(b.pct, 90);
  assert.equal(b.tone, 'warn');
  const score = financialScore(st, '2026-10', '2026-10-12');
  assert.ok(score.score >= 0 && score.score <= 100);
  assert.equal(score.factors.length, 5);
});

test('simulador: aumento de salário melhora o saldo projetado', () => {
  const st = createEmptyState();
  st.settings.salaryHistory = [profile(500000)];
  const r = simulate(st, { salaryPct: 10 }, '2026-11', 6, '2026-10-12');
  assert.equal(r.scenario.length, 6);
  assert.ok(r.cumulativeDiff > 0);
  const r2 = simulate(st, { purchase: { parcelCents: 20000, count: 3 } }, '2026-11', 6, '2026-10-12');
  assert.equal(r2.cumulativeDiff, -60000);
});

test('agenda do mês e arquivo .ics', () => {
  const st = createEmptyState();
  st.settings.salaryHistory = [profile(500000)];
  st.expenses.push({ id: 'e', description: 'Luz; casa', cents: 12345, dueDate: '2026-10-20', paidAt: null });
  const ev = calendarEvents(st, '2026-10', '2026-10-12');
  assert.ok(ev['2026-10-20'].some((e) => e.type === 'bill'));
  assert.ok(ev['2026-10-05'].some((e) => e.type === 'income'));
  assert.equal(monthGrid('2026-10').flat().filter((d) => d.inMonth).length, 31);
  const ics = buildICS(st, '2026-10', 1, 1, '2026-10-12');
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261020/);
  assert.match(ics, /Luz\\; casa/);
  assert.equal(dueReminders(st, 10, '2026-10-12').length, 1);
});

test('importação: OFX, CSV de conta e de cartão', () => {
  const ofx = `<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-45.90<FITID>1<MEMO>UBER *TRIP</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>1200.00<FITID>2<MEMO>PIX RECEBIDO</STMTTRN>
</BANKTRANLIST></OFX>`;
  const o = parseOFX(ofx);
  assert.deepEqual(o.map((r) => [r.date, r.cents]), [['2026-10-03', 4590], ['2026-10-05', -120000]]);

  const conta = 'Data;Descrição;Valor\n03/10/2026;IFOOD *RESTAURANTE;-32,50\n05/10/2026;Salário;3.000,00\n06/10/2026;Farmácia;-15,00';
  const c = parseCSV(conta);
  assert.deepEqual(c.map((r) => r.cents), [3250, -300000, 1500]);

  const cartao = 'date,title,amount\n2026-10-03,Netflix,55.90\n2026-10-04,Mercado Livre,120.00\n2026-10-09,Pagamento recebido,-500.00';
  const k = parseStatement(cartao, 'fatura.csv');
  assert.equal(k.format, 'CSV');
  assert.deepEqual(k.rows.map((r) => r.cents), [5590, 12000, -50000]);
});

test('categorização automática: regra, histórico e palavra-chave', () => {
  const st = createEmptyState();
  const transporte = st.categories.find((c) => c.name === 'Transporte');
  const lazer = st.categories.find((c) => c.name === 'Lazer e viagens');
  assert.equal(suggestCategory(st, 'UBER *TRIP 12/03').categoryId, transporte.id);
  st.expenses.push({ id: 'x', description: 'Padaria do João', cents: 100, dueDate: '2026-10-01', categoryId: lazer.id });
  assert.equal(suggestCategory(st, 'PADARIA DO JOAO').source, 'histórico');
  st.settings.rules = [{ id: 'r', pattern: 'padaria', categoryId: transporte.id, subcategoryId: null }];
  assert.equal(suggestCategory(st, 'Padaria Central').source, 'regra');
  assert.equal(cleanDescription('UBER *TRIP 12/03'), 'UBER TRIP');
  assert.equal(fingerprint({ date: '2026-10-01', cents: 100, description: 'A 12/03' }), '2026-10-01|100|A');
});

test('renda do mês inclui férias', () => {
  const st = createEmptyState();
  st.settings.salaryHistory = [profile(300000)];
  st.settings.vacations = [{ id: 'v', start: '2026-07-01', days: 30, sellDays: 0, advance13: false }];
  const m = computeMonth(st, '2026-07', '2026-07-01');
  assert.ok(m.income.vacation.net > 0);
  assert.equal(m.income.total, m.income.salary + m.income.vacation.net);
});

test('lançamento rápido em linguagem natural', async () => {
  const { parseQuickAdd } = await import('../js/domain/quickadd.js');
  const t = '2026-10-13';
  assert.deepEqual(parseQuickAdd('mercado 154,90', t), { description: 'Mercado', cents: 15490, date: t, paid: false, income: false });
  assert.deepEqual(parseQuickAdd('uber 23 ontem', t), { description: 'Uber', cents: 2300, date: '2026-10-12', paid: true, income: false });
  assert.equal(parseQuickAdd('luz 180 dia 20', t).date, '2026-10-20');
  assert.equal(parseQuickAdd('dentista 250 15/11', t).date, '2026-11-15');
  assert.equal(parseQuickAdd('plantão 1.200 recebi', t).income, true);
  assert.equal(parseQuickAdd('plantão 1.200 recebi', t).cents, 120000);
  assert.equal(parseQuickAdd('só texto', t), null);
});
