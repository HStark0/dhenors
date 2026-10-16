// Regras trabalhistas: 13º com média das variáveis e sobreaviso mensal.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyState, sanitizeState } from '../js/domain/schema.js';
import { payrollFor, thirteenthFor, variableAverageFor, onCallLinesFor } from '../js/domain/payroll.js';
import { thirteenthOf } from '../js/domain/ledger.js';

const profile = (cents, extra = {}) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [], ...extra });
const onCall = { id: 'sa', description: 'Sobreaviso', mode: 'hours', value: 20 * 60, hourKind: 'sobreaviso', dsr: false, taxable: true };

test('sobreaviso: fixo de R$ 0,00 todo mês; só ganha valor com as horas do mês', () => {
  const s = createEmptyState();
  s.settings.salaryHistory = [profile(440000, { additions: [onCall] })];
  // Hora = 4.400 ÷ 220 = R$ 20,00 → sobreaviso = 20 ÷ 3 por hora
  const none = payrollFor(s.settings, '2026-10').additions.find((a) => a.id === 'sa');
  assert.equal(none.cents, 0);                              // sem horas no mês = R$ 0,00
  assert.equal(none.pendingHours, true);
  assert.equal(none.variable, true);                        // entra na média do 13º

  s.settings.onCallHours = { '2026-10': { sa: 36 * 60 } };
  const informed = payrollFor(s.settings, '2026-10').additions.find((a) => a.id === 'sa');
  assert.equal(informed.cents, Math.round((2000 * 36) / 3)); // R$ 240,00
  assert.equal(informed.pendingHours, false);
  // Continua ativo nos outros meses, com R$ 0,00 até informar as horas
  assert.equal(payrollFor(s.settings, '2026-11').additions.find((a) => a.id === 'sa').cents, 0);
  assert.deepEqual(onCallLinesFor(s.settings, '2026-10'), [{ id: 'sa', description: 'Sobreaviso', minutes: 2160 }]);
  // Horas inválidas não passam pela limpeza
  const clean = sanitizeState({ ...s, settings: { ...s.settings, onCallHours: { '2026-10': { sa: -5, ok: 60 }, x: { sa: 1 } } } });
  assert.deepEqual(clean.settings.onCallHours, { '2026-10': { ok: 60 } });
});

test('13º: média das variáveis, 1ª parcela = 50% e 2ª = total − 1ª − INSS − IR', () => {
  const s = createEmptyState();
  s.settings.salaryHistory = [profile(300000)];
  s.settings.employment = { admission: null, regime: 'inss', fixedRateBp: 1400, thirteenth: true };
  // Horas extras variáveis: R$ 600 em março e R$ 1.200 em setembro
  s.settings.payrollVariable = [
    { id: 'a', kind: 'add', ym: '2026-03', description: 'Horas extras', mode: 'fixed', value: 60000, base: 'salary', taxable: true },
    { id: 'b', kind: 'add', ym: '2026-09', description: 'Horas extras', mode: 'fixed', value: 120000, base: 'salary', taxable: true },
  ];
  const avg = variableAverageFor(s.settings, 2026, 10);
  assert.equal(avg.months, 10);
  assert.equal(avg.average, 18000); // (600 + 1.200) ÷ 10 meses

  const nov = thirteenthFor(s.settings, '2026-11');
  assert.equal(nov.gross, 318000);  // (3.000 + 180) × 12/12
  assert.equal(nov.net, 159000);    // 50%, sem descontos

  const dec = thirteenthFor(s.settings, '2026-12');
  assert.equal(dec.average, 16364); // 1.800 ÷ 11 meses (jan–nov), arredondado ao centavo
  assert.equal(dec.gross, 316364);
  assert.equal(dec.first, 159000);  // a 1ª parcela que foi paga
  assert.equal(dec.net, dec.gross - dec.first - dec.inss - dec.ir);
  assert.ok(dec.inss > 0);
  for (const v of [nov.gross, nov.net, dec.gross, dec.net, dec.inss, dec.ir]) assert.ok(Number.isInteger(v));
});

test('13º: plantões pagos na folha entram na média', () => {
  const s = createEmptyState();
  s.settings.salaryHistory = [profile(300000)];
  s.extraIncomes = [{ id: 'p', ym: '2026-05', description: 'Plantão', cents: 100000, payroll: true }];
  const t = thirteenthOf(s, '2026-11');
  assert.equal(t.average, 10000);   // 1.000 ÷ 10 meses
  assert.equal(t.gross, 310000);
  assert.equal(t.net, 155000);
});

test('13º proporcional: mês de admissão conta com 15 dias ou mais', () => {
  const s = createEmptyState();
  s.settings.salaryHistory = [profile(240000)];
  s.settings.employment = { admission: '2026-07-10', regime: 'inss', fixedRateBp: 1400, thirteenth: true };
  const nov = thirteenthFor(s.settings, '2026-11');
  assert.equal(nov.avos, 6);        // julho (22 dias) a dezembro
  assert.equal(nov.gross, 120000);
  assert.equal(nov.averageMonths, 4); // média só de julho a outubro
});

test('apagar só o salário: mantém contas e o resto; pode desfazer', async () => {
  const { store } = await import('../js/core/store.js');
  const A = await import('../js/domain/actions.js');
  store.flush = async () => {};
  console.warn = () => {}; console.error = () => {};
  store.data = createEmptyState();
  const d = store.data;
  d.onboarded = true;
  d.settings.salaryHistory = [profile(500000, { additions: [onCall] })];
  d.settings.payrollVariable = [{ id: 'v', kind: 'add', ym: '2026-10', description: 'HE', mode: 'fixed', value: 100, base: 'salary', taxable: true }];
  d.settings.employment = { ...d.settings.employment, admission: '2020-01-01' };
  d.settings.actualNet = { '2026-10': 400000 };
  d.settings.vacations = [{ id: 'f', start: '2026-12-01', days: 30, sellDays: 0, advance13: false }];
  d.settings.benefits = [{ id: 'b', kind: 'plr', name: 'PLR', cents: 100000, month: 3, monthly: false }];
  d.settings.spendingLimitCents = 450000;
  d.expenses = [{ id: 'e', description: 'Luz', cents: 15000, dueDate: '2026-10-10', paidAt: null }];
  d.extraIncomes = [
    { id: 'p', ym: '2026-10', description: 'Plantão', cents: 70000, payroll: true },
    { id: 'f', ym: '2026-10', description: 'Freela', cents: 30000, payroll: false },
  ];

  A.clearSalaryData({ vacations: true, shifts: true, benefits: false });
  const s = store.data.settings;
  assert.deepEqual(s.salaryHistory, []);
  assert.deepEqual(s.payrollVariable, []);
  assert.deepEqual(s.actualNet, {});
  assert.equal(s.employment.admission, null);
  assert.deepEqual(s.vacations, []);
  assert.equal(s.benefits.length, 1);                   // benefícios não marcados ficam
  assert.equal(s.spendingLimitCents, 450000);           // meta de gastos fica
  assert.equal(store.data.expenses.length, 1);          // contas ficam
  assert.deepEqual(store.data.extraIncomes.map((x) => x.id), ['f']); // só a renda da folha sai

  store.undo();
  assert.equal(store.data.settings.salaryHistory.length, 1);
  assert.equal(store.data.extraIncomes.length, 2);
});

test('sobreaviso fixo é salvo com 0 horas (R$ 0,00) mesmo sem informar horas', async () => {
  const { store } = await import('../js/core/store.js');
  const A = await import('../js/domain/actions.js');
  store.flush = async () => {};
  store.data = createEmptyState();
  store.data.onboarded = true;
  store.data.settings.salaryHistory = [profile(440000)];
  A.savePayrollLine('2026-10', 'add', { description: 'Sobreaviso', mode: 'hours', value: NaN, hourKind: 'sobreaviso', dsr: false, taxable: true, variable: false });
  const line = store.data.settings.salaryHistory.at(-1).additions[0];
  assert.equal(line.value, 0);
  assert.equal(payrollFor(store.data.settings, '2026-10').additions[0].cents, 0);
  // Horas extras continuam exigindo as horas
  assert.throws(() => A.savePayrollLine('2026-10', 'add', { description: 'HE', mode: 'hours', value: NaN, hourKind: 'he50', dsr: true, taxable: true, variable: false }), /horas/);
});
