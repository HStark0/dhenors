// Testes dos cálculos. Rode com:  node --test tests/
// (Node 18+; não precisa instalar nada.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toCents, splitCents, formatBRL, percent } from '../js/core/money.js';
import { addMonthsYM, addMonthsISO, dateInMonth, nextPayday, diffDays, monthRange } from '../js/core/dates.js';
import { installmentSchedule, installmentInMonth, computeMonth, entryKey, overdueBefore, goalPlan, creditorMonthly } from '../js/domain/ledger.js';
import { sanitizeState } from '../js/domain/schema.js';
import { payrollProfileFor, computePayroll, payrollFor, thirteenthFor, thirteenthMonths, inssBandFor } from '../js/domain/payroll.js';
import { tablesFor } from '../js/domain/taxTables.js';
import { planInstallment } from '../js/domain/ledger.js';
import { buildSnapshot, monthSummary, projection, periodAnalysis, median } from '../js/domain/analysis.js';
import { emptyState } from './helpers.mjs';

const nbsp = (s) => s.replace(/ /g, ' ');

test('toCents entende formatos brasileiros', () => {
  assert.equal(toCents('12,50'), 1250);
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('1234.56'), 123456);
  assert.equal(toCents('1.234'), 123400);
  assert.equal(toCents('R$ 10'), 1000);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.ok(Number.isNaN(toCents('abc')));
  assert.ok(Number.isNaN(toCents('')));
});

test('splitCents fecha exatamente o total', () => {
  assert.deepEqual(splitCents(100000, 3), [33334, 33333, 33333]);
  const parts = splitCents(123457, 7);
  assert.equal(parts.reduce((a, b) => a + b, 0), 123457);
});

test('formatBRL e percent seguros', () => {
  assert.equal(nbsp(formatBRL(123456)), 'R$ 1.234,56');
  assert.equal(formatBRL(NaN), '—');
  assert.equal(percent(10, 0), 0);
});

test('datas: dia 31 não pula fevereiro e virada de ano funciona', () => {
  assert.equal(addMonthsISO('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsISO('2028-01-31', 1), '2028-02-29'); // bissexto
  assert.equal(addMonthsISO('2026-08-31', 1), '2026-09-30');
  assert.equal(addMonthsYM('2026-12', 1), '2027-01');
  assert.equal(addMonthsYM('2026-01', -1), '2025-12');
  assert.equal(dateInMonth('2026-02', 31), '2026-02-28');
  assert.equal(diffDays('2026-02-27', '2026-03-01'), 2);
  assert.deepEqual(monthRange('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
});

test('próximo salário: no próprio dia é hoje', () => {
  assert.equal(nextPayday(5, '2026-10-05'), '2026-10-05');
  assert.equal(nextPayday(5, '2026-10-06'), '2026-11-05');
  assert.equal(nextPayday(31, '2026-02-10'), '2026-02-28');
});

test('parcelas começando em 31/01 caem em todos os meses', () => {
  const inst = { id: 'i', totalCents: 100000, count: 4, firstDueDate: '2026-01-31', dueDay: 31, paid: [] };
  const months = installmentSchedule(inst).map((p) => p.dueDate);
  assert.deepEqual(months, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(installmentInMonth(inst, '2026-02').n, 2);
  assert.equal(installmentInMonth(inst, '2026-05'), null);
  assert.equal(installmentInMonth(inst, '2025-12'), null);
});

function sampleState() {
  const s = emptyState();
  // salário já líquido (perfil legado) para manter as contas simples
  s.settings.salaryHistory = [{ from: '2026-01', grossCents: 500000, dependents: 0, additions: [], deductions: [], legacyNet: true }];
  s.extraIncomes = [{ id: 'x1', ym: '2026-10', description: 'Plantão', cents: 80000, date: '2026-10-10' }];
  s.expenses = [
    { id: 'e1', description: 'Mercado', cents: 45000, dueDate: '2026-10-03', paidAt: '2026-10-03', categoryId: null },
    { id: 'e2', description: 'Luz', cents: 20000, dueDate: '2026-10-20', paidAt: null, categoryId: null },
    { id: 'e3', description: 'Conta velha', cents: 10000, dueDate: '2026-09-15', paidAt: null, categoryId: null },
  ];
  s.recurring = [{ id: 'r1', description: 'Internet', cents: 10000, dueDay: 31, startYM: '2026-10', endYM: null }];
  s.installments = [{ id: 'i1', description: 'Celular', totalCents: 120000, count: 3, firstDueDate: '2026-09-10', dueDay: 10, paid: [1, 2] }];
  return s;
}

test('computeMonth: renda extra soma como número (sem NaN)', () => {
  const m = computeMonth(sampleState(), '2026-10', '2026-10-12');
  assert.equal(m.income.total, 580000);
  // 45000 + 20000 + 10000 (internet) + 40000 (parcela 2/3, paga)
  assert.equal(m.totals.all, 115000);
  assert.equal(m.totals.paid, 85000); // mercado + parcela paga
  assert.equal(m.balance, 580000 - 115000);
  assert.ok(Number.isFinite(m.cashBalance));
});

test('parcela paga continua no total do mês', () => {
  const m = computeMonth(sampleState(), '2026-10', '2026-10-12');
  const parcel = m.items.find((i) => i.kind === 'installment');
  assert.equal(parcel.status, 'paid');
  assert.ok(m.totals.all >= m.totals.paid);
});

test('recorrente: não aparece antes do início, dia 31 vira 30/11, pulo e ajuste por mês', () => {
  const s = sampleState();
  assert.equal(computeMonth(s, '2026-09', '2026-10-12').items.some((i) => i.kind === 'recurring'), false);
  const nov = computeMonth(s, '2026-11', '2026-10-12').items.find((i) => i.kind === 'recurring');
  assert.equal(nov.dueDate, '2026-11-30');
  s.recurringEntries[entryKey('r1', '2026-11')] = { cents: 12345, paidAt: '2026-11-29', skipped: false };
  const adj = computeMonth(s, '2026-11', '2026-12-01').items.find((i) => i.kind === 'recurring');
  assert.equal(adj.cents, 12345);
  assert.equal(adj.status, 'paid');
  s.recurringEntries[entryKey('r1', '2026-12')] = { skipped: true };
  assert.equal(computeMonth(s, '2026-12', '2026-10-12').items.some((i) => i.kind === 'recurring'), false);
});

test('atrasadas de meses anteriores', () => {
  const list = overdueBefore(sampleState(), '2026-10', '2026-10-12');
  assert.equal(list.length, 1);
  assert.equal(list[0].refId, 'e3');
});

test('salário por período (histórico)', () => {
  const settings = { salaryHistory: [{ from: '2026-05', grossCents: 600000 }, { from: '2026-01', grossCents: 500000 }] };
  assert.equal(payrollProfileFor(settings, '2025-12'), null);
  assert.equal(payrollProfileFor(settings, '2026-03').grossCents, 500000);
  assert.equal(payrollProfileFor(settings, '2026-10').grossCents, 600000);
});

test('snapshot do fechamento bate com o cálculo ao vivo', () => {
  const s = sampleState();
  const snap = buildSnapshot(s, '2026-10', '2026-10-12');
  const live = monthSummary(s, '2026-10', '2026-10-12');
  s.closedMonths['2026-10'] = snap;
  const frozen = monthSummary(s, '2026-10', '2026-10-12');
  assert.equal(frozen.spent, live.spent);
  assert.equal(frozen.income, live.income);
  assert.equal(frozen.balance, live.balance);
  assert.equal(snap.categories.reduce((a, c) => a + c.cents, 0), snap.totals.all);
});

test('projeção e análise não geram NaN', () => {
  const s = sampleState();
  for (const p of projection(s, '2026-10', 6, '2026-10-12')) {
    assert.ok(Number.isFinite(p.balance));
  }
  const a = periodAnalysis(s, '2026-10', 3, '2026-10-12');
  assert.ok(Number.isFinite(a.savingsRate));
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), 0);
});

test('meta: valor mensal necessário', () => {
  const g = { targetCents: 120000, deadline: '2027-03-15', contributions: [{ cents: 20000, date: '2026-10-01' }] };
  const plan = goalPlan(g, '2026-10-12');
  assert.equal(plan.remaining, 100000);
  assert.equal(plan.monthsLeft, 6); // out, nov, dez, jan, fev, mar
  assert.equal(plan.perMonth, 16667);
});

test('backup: sanitizeState limpa dados inválidos e rejeita arquivos estranhos', () => {
  const s = sampleState();
  s.expenses.push({ id: 'bad', description: '<img onerror=x>', cents: -5, dueDate: '2026-13-01' });
  const clean = sanitizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(clean.expenses.length, 3);
  assert.throws(() => sanitizeState({ foo: 1 }));
});

// ---------- Folha de pagamento (tabelas 2026) ----------

const gross = (cents, extra = {}) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [], ...extra });

test('INSS e IR 2026: valores conferidos com as tabelas oficiais', () => {
  const a = computePayroll(gross(450000), '2026-10');
  assert.equal(a.inss, 43150);     // R$ 431,50 (cada faixa truncada, como na folha)
  assert.equal(a.ir.value, 0);     // isento até R$ 5.000 (redução)
  const b = computePayroll(gross(600000), '2026-10');
  assert.equal(b.inss, 64150);     // R$ 641,50
  assert.equal(b.ir.tax, 56486);   // tabela: 5.358,50 × 27,5% − 908,73 = R$ 564,86
  assert.equal(b.ir.reduction, 17975); // 978,62 − 0,133145 × 6.000 = 179,75
  assert.equal(b.ir.value, 38511);
  const c = computePayroll(gross(1000000), '2026-10');
  assert.equal(c.inss, 98809);     // teto: R$ 988,09
  assert.equal(c.ir.reduction, 0); // acima de 7.350, sem redução
});

test('adicionais, extras na folha e descontos', () => {
  const p = computePayroll(gross(500000, {
    dependents: 1,
    additions: [{ description: 'Insalubridade', mode: 'percent', value: 2000, base: 'minimum', taxable: true }],
    deductions: [
      { description: 'VT', mode: 'percent', value: 600, base: 'salary' },
      { description: 'Pensão', mode: 'fixed', value: 50000, base: 'salary', irDeductible: true },
    ],
  }), '2026-10', { extras: 100000 });
  assert.equal(p.additions[0].cents, 32420); // 20% de R$ 1.621
  assert.equal(p.gross, 500000 + 32420 + 100000);
  assert.equal(p.deductions[0].cents, 30000); // 6% de 5.000
  assert.equal(p.net, p.gross - p.inss - p.ir.value - 80000);
  assert.equal(p.ir.method, 'deduções legais');
});

test('renda do mês: plantão na folha soma o líquido marginal', () => {
  const s = emptyState();
  s.settings.salaryHistory = [gross(500000)];
  s.extraIncomes = [
    { id: 'p', ym: '2026-10', description: 'Plantão', cents: 100000, date: '2026-10-10', payroll: true },
    { id: 'f', ym: '2026-10', description: 'Freela', cents: 30000, date: '2026-10-11', payroll: false },
  ];
  const m = computeMonth(s, '2026-10', '2026-10-12');
  const base = computePayroll(gross(500000), '2026-10').net;
  const withShift = computePayroll(gross(500000), '2026-10', { extras: 100000 }).net;
  assert.equal(m.income.salary, base);
  assert.equal(m.income.extrasCents, withShift - base + 30000);
  assert.equal(m.income.total, withShift + 30000);
  assert.ok(m.income.extrasCents < 130000); // plantão paga imposto
});

test('migração: salário antigo (líquido) continua igual', () => {
  const v1 = { schema: 1, settings: { salaryHistory: [{ from: '2026-01', cents: 450000 }] }, expenses: [] };
  const v2 = sanitizeState(v1);
  const p = v2.settings.salaryHistory[0];
  assert.equal(p.legacyNet, true);
  assert.equal(computePayroll(p, '2026-10').net, 450000);
});

test('parcelamento a partir da parcela, nº de parcelas e já pagas', () => {
  const plan = planInstallment({ parcelCents: 25000, count: 10, paidCount: 3, nextDueDate: '2026-11-10' });
  assert.equal(plan.totalCents, 250000);
  assert.equal(plan.firstDueDate, '2026-08-10');
  assert.equal(plan.lastDueDate, '2027-05-10');
  // vencimento dia 31, próxima em fevereiro (28): a 1ª foi em 31/01 e a última em 30/04
  const d31 = planInstallment({ parcelCents: 1000, count: 4, paidCount: 1, nextDueDate: '2027-02-28', dueDay: 31 });
  assert.equal(d31.firstDueDate, '2027-01-31');
  assert.equal(d31.lastDueDate, '2027-04-30');
});

test('consignado parcelado: desconta só entre o início e o fim', () => {
  const loan = { id: 'c', description: 'Consignado', mode: 'fixed', value: 40000, base: 'salary', loan: { count: 3, startYM: '2026-09' } };
  const p = gross(500000, { deductions: [loan] });
  assert.equal(computePayroll(p, '2026-08').deductionsTotal, 0);       // ainda não começou
  const oct = computePayroll(p, '2026-10');
  assert.equal(oct.deductionsTotal, 40000);
  assert.equal(oct.deductions[0].detail, 'parcela 2/3');
  assert.equal(computePayroll(p, '2026-11').deductions[0].loan.n, 3);  // última
  assert.equal(computePayroll(p, '2026-12').deductionsTotal, 0);       // quitado: sai sozinho
});

// ---------- Variáveis, faixa do INSS, regime fixo, 13º, conferência ----------

test('INSS: faixa nominal (o "12%" do holerite) x efetivo', () => {
  const t = tablesFor(2026);
  assert.equal(inssBandFor(400000, t), 12);  // R$ 4.000 cai na faixa de 12%
  assert.equal(inssBandFor(532420, t), 14);
  const p = computePayroll(gross(400000), '2026-10');
  assert.equal(p.inssBand, 12);
  assert.ok(p.inss < 400000 * 0.12);         // efetivo menor que 12%
  assert.equal(p.inss, 36858);               // 121,57 + 115,36 + 131,65 (cada faixa truncada)
});

test('regime de alíquota fixa (servidor/RPPS)', () => {
  const p = computePayroll(gross(500000), '2026-10', { employment: { regime: 'fixed', fixedRateBp: 1400 } });
  assert.equal(p.inss, 70000);
  assert.equal(p.fgts, 0);
  assert.equal(p.inssLabel, 'Previdência (RPPS)');
});

test('adicional variável só entra no mês lançado', () => {
  const s = emptyState();
  s.settings.salaryHistory = [gross(500000)];
  s.settings.payrollVariable = [{ id: 'v', kind: 'add', ym: '2026-10', description: 'Adicional noturno', mode: 'fixed', value: 40000, base: 'salary', taxable: true }];
  assert.equal(payrollFor(s.settings, '2026-10').gross, 540000);
  assert.equal(payrollFor(s.settings, '2026-11').gross, 500000);
  assert.equal(payrollFor(s.settings, '2026-10').additions[0].variable, true);
});

test('13º proporcional à admissão, com 1ª e 2ª parcelas', () => {
  assert.equal(thirteenthMonths('2026-04-13', 2026), 9);  // abril conta (18 dias)
  assert.equal(thirteenthMonths('2026-04-20', 2026), 8);  // abril não conta (11 dias)
  assert.equal(thirteenthMonths('2025-04-13', 2026), 12);
  const s = emptyState();
  s.settings.salaryHistory = [gross(480000)];
  s.settings.employment = { admission: '2026-04-13', regime: 'inss', fixedRateBp: 1400, thirteenth: true };
  const nov = thirteenthFor(s.settings, '2026-11');
  const dec = thirteenthFor(s.settings, '2026-12');
  assert.equal(nov.gross, 360000);          // 4.800 × 9/12
  assert.equal(nov.net, 180000);            // metade, sem descontos
  assert.equal(dec.net, 360000 - 180000 - dec.inss - dec.ir);
  assert.equal(thirteenthFor(s.settings, '2026-10'), null);
  const m = computeMonth(s, '2026-11', '2026-11-01');
  // O 13º é pago à parte: não entra na renda nem no saldo previsto do mês
  assert.equal(m.income.total, m.income.salary);
  assert.equal(m.income.thirteenthNet, 180000);
  assert.equal(m.balance, m.income.total - m.totals.all);
  s.settings.employment.thirteenth = false;
  assert.equal(thirteenthFor(s.settings, '2026-11'), null);
});

test('líquido conferido no holerite substitui a estimativa', () => {
  const s = emptyState();
  s.settings.salaryHistory = [gross(500000)];
  s.settings.actualNet = { '2026-10': 412345 };
  const m = computeMonth(s, '2026-10', '2026-10-12');
  assert.equal(m.income.total, 412345);
  assert.notEqual(m.income.estimatedNet, 412345);
});

test('saldo devedor do credor mês a mês', () => {
  const s = emptyState();
  s.creditors = [{ id: 'c1', name: 'Banco', notes: '' }];
  // 4 parcelas de R$ 100 (set a dez), a 1ª já paga
  s.installments = [{ id: 'i1', description: 'TV', totalCents: 40000, count: 4, firstDueDate: '2026-09-10', dueDay: 10, paid: [1], creditorId: 'c1' }];
  // conta avulsa atrasada de agosto: entra no mês atual
  s.expenses = [{ id: 'e1', description: 'Acordo', cents: 5000, dueDate: '2026-08-20', paidAt: null, creditorId: 'c1' }];
  const rows = creditorMonthly(s, 'c1', '2026-10', 4, '2026-10-05');
  assert.deepEqual(rows.map((r) => [r.ym, r.balanceCents, r.dueCents]), [
    ['2026-10', 35000, 15000],
    ['2026-11', 20000, 10000],
    ['2026-12', 10000, 10000],
    ['2027-01', 0, 0],
  ]);
});
