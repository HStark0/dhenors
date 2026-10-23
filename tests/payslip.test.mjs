// Testes conferidos com um holerite REAL (competência 09/2026):
// salário 2.026,60 · 17 dias + 13 de atestado · periculosidade 30%
// · sobreaviso 100 h · consignado 338,27 → líquido 2.361,79.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { payrollFor, inssFor, absencesIn, formatHours } from '../js/domain/payroll.js';
import { incomeFor, payslipIncome } from '../js/domain/ledger.js';
import { calendarEvents } from '../js/domain/planning.js';
import { dsrDaysIn } from '../js/core/calendar.js';
import { tablesFor } from '../js/domain/taxTables.js';

const settings = () => {
  const s = emptyState().settings;
  s.salaryHistory = [{ from: '2026-04', grossCents: 202660, dependents: 0,
    additions: [{ id: 'peri', description: 'Adicional de periculosidade', mode: 'percent', value: 3000, base: 'salary', taxable: true }],
    deductions: [] }];
  s.payrollLoans = [{ id: 'ct', description: 'Crédito do Trabalhador', mode: 'fixed', value: 33827, base: 'salary', irDeductible: false, loan: { count: 24, startYM: '2026-08' } }];
  s.payrollVariable = [{ id: 'sob', kind: 'add', ym: '2026-09', description: 'Sobreaviso', mode: 'hours', value: 100 * 60, hourKind: 'sobreaviso', dsr: false, taxable: true }];
  s.absences = [{ id: 'at', ym: '2026-09', kind: 'atestado', days: 13 }];
  s.employment = { admission: '2026-04-13', regime: 'inss', fixedRateBp: 1400, thirteenth: true, hoursDivisor: 220, familyChildren: 0 };
  return s;
};

test('holerite real de 09/2026 bate centavo a centavo', () => {
  const p = payrollFor(settings(), '2026-09');
  assert.deepEqual(p.baseLines.map((l) => l.cents), [114841, 87819]); // 17 dias + 13 de atestado
  assert.equal(p.additions.find((a) => a.id === 'peri').cents, 60798);
  assert.equal(p.additions.find((a) => a.id === 'sob').cents, 30706);
  assert.equal(p.gross, 294164);
  assert.equal(p.inss, 24158);
  assert.equal(p.inssBand, 12);
  assert.equal(p.ir.value, 0);
  assert.equal(p.fgts, 23533);
  assert.equal(p.deductionsTotal + p.inss, 57985);
  assert.equal(p.net, 236179);
  assert.deepEqual(p.bases, { salary: 202660, inss: 294164, fgts: 294164, irrf: 294164 });
});

test('INSS truncado por faixa (como a folha)', () => {
  assert.equal(inssFor(294164, tablesFor(2026)), 24158); // 121,57 + 115,36 + 4,65
});

test('atestado acima de 15 dias: o restante é pago pelo INSS', () => {
  const s = settings();
  s.absences = [{ id: 'x', ym: '2026-09', kind: 'atestado', days: 20 }];
  assert.deepEqual({ sick: absencesIn(s, '2026-09').sick, inss: absencesIn(s, '2026-09').inss }, { sick: 15, inss: 5 });
  const p = payrollFor(s, '2026-09');
  assert.equal(p.workedDays, 25);
  assert.equal(p.baseLines.reduce((t, l) => t + l.cents, 0), Math.round(202660 * 25 / 30));
});

test('faltas descontam o dia e reduzem a base de INSS', () => {
  const s = settings();
  s.absences = [{ id: 'f', ym: '2026-09', kind: 'falta', days: 2 }];
  const p = payrollFor(s, '2026-09');
  const falta = p.deductions.find((d) => d.id === 'faltas');
  assert.equal(falta.cents, Math.round(202660 * 2 / 30));
  assert.equal(p.taxable, p.gross - falta.cents);
});

test('horas extras com periculosidade no valor da hora e DSR automático', () => {
  const s = settings();
  s.payrollVariable = [{ id: 'he', kind: 'add', ym: '2026-09', description: 'Horas extras 50%', mode: 'hours', value: 600, hourKind: 'he50', dsr: true, taxable: true }];
  const p = payrollFor(s, '2026-09');
  const he = p.additions.find((a) => a.id === 'he');
  assert.equal(he.cents, Math.round(((202660 + 60798) / 220) * 10 * 1.5)); // 179,63
  const dsr = p.additions.find((a) => a.id === 'he-dsr');
  assert.deepEqual(dsrDaysIn('2026-09'), { rest: 5, business: 25 }); // 4 domingos + 7/9
  assert.equal(dsr.cents, Math.round(he.cents * 5 / 25));
  assert.equal(formatHours(90), '1h30');
});

test('salário-família só até o limite de remuneração', () => {
  const s = settings();
  s.employment.familyChildren = 2;
  assert.equal(payrollFor(s, '2026-09').additions.some((a) => a.id === 'salario-familia'), false); // 2.941,64 > 1.980,38
  s.salaryHistory[0].grossCents = 160000;
  s.salaryHistory[0].additions = [];
  s.payrollVariable = [];
  s.absences = [];
  const fam = payrollFor(s, '2026-09').additions.find((a) => a.id === 'salario-familia');
  assert.equal(fam.cents, 2 * 6754);
  assert.equal(fam.taxable, false);
});

test('salário que cai no mês seguinte: holerite de set entra em out', () => {
  const st = emptyState();
  st.settings = settings();
  st.settings.payday = { mode: 'business', nth: 5, saturday: true, nextMonth: true };
  const set = payslipIncome(st, '2026-09');
  const out = incomeFor(st, '2026-10');
  assert.equal(out.competence, '2026-09');
  assert.equal(out.salary, set.salary);
  const ev = calendarEvents(st, '2026-10', '2026-10-01');
  assert.ok(ev['2026-10-06'].some((e) => e.type === 'income' && e.cents === set.salary));
  // sem a opção, cada mês recebe a própria competência
  st.settings.payday.nextMonth = false;
  assert.equal(incomeFor(st, '2026-10').competence, '2026-10');
});

// ---------- Importação do holerite (texto colado, dados fictícios) ----------
import { parsePayslipText, planFromPayslip, friendlyName } from '../js/domain/payslip.js';
import { applyPayslipTo } from '../js/domain/actions.js';
import { emptyState } from './helpers.mjs';

const SAMPLE = `EMPRESA EXEMPLO LTDA                HOLERITE                    Comp.: 9 / 2026
                         FULANO DE TAL                                  Página 1
Chapa: 000001     TECNICO DE INFORMATICA             Admissão:   13/04/2026
    Cód.        Descrição                                Ref.        Provento         Descontos
     0001       SALARIO CONTRATUAL                       17          1.148,41               -
     0405       ATESTADO MEDICO PREVIDENCIA              13            878,19               -
     9228       ADICIONAL DE PERICULOSIDADE 30%           -            607,98               -
     9227       SOBREAVISO - HORAS                       100           307,06               -
     0083       HORAS EXTRAS 100%                         -              0,00               -
     9309       DESCONTO EMPRÉSTIMO CRÉDITO DO TRABALHADOR -               -             338,27
     0003       I.N.S.S.                                 12               -             241,58
                                                          Total de Proventos     Total de Descontos
                                                               2.941,64              579,85
    Assinatura:                                            Valor Líquido =>          2.361,79
 Sal. Base                 Base INSS      Base FGTS          FGTS Mês         Base IRRF
   2.026,60                  2.941,64       2.941,64           235,33           2.941,64`;

test('lê o texto do holerite e importa batendo o líquido', () => {
  const parsed = parsePayslipText(SAMPLE);
  assert.equal(parsed.competence, '2026-09');
  assert.equal(parsed.admission, '2026-04-13');
  assert.equal(parsed.baseSalary, 202660);
  assert.equal(parsed.net, 236179);
  assert.deepEqual(parsed.totals, { proventos: 294164, descontos: 57985 });
  const st = emptyState();
  const plan = planFromPayslip(parsed, st.settings);
  const by = (code) => plan.items.find((x) => x.code === code);
  assert.equal(by('0405').action, 'sick');
  assert.equal(by('9228').action, 'percent');
  assert.equal(by('9227').params.minutes, 6000);
  assert.equal(by('0003').include, false);
  assert.equal(by('0083').include, false); // zerado
  by('9309').params.count = 24;
  by('9309').params.paid = 1;
  applyPayslipTo(st, plan);
  const p = payrollFor(st.settings, '2026-09');
  assert.equal(p.net, 236179);
  assert.equal(st.settings.payrollLoans[0].loan.startYM, '2026-08');
  assert.equal(friendlyName('ADICIONAL DE PERICULOSIDADE 30%'), 'Adicional de Periculosidade');
  // importar de novo não duplica nada
  applyPayslipTo(st, planFromPayslip(parsed, st.settings));
  assert.equal(st.settings.salaryHistory.at(-1).additions.length, 1);
  assert.equal(st.settings.payrollVariable.length, 1);
  assert.equal(st.settings.payrollLoans.length, 1);
  assert.equal(st.settings.absences.length, 1);
});
