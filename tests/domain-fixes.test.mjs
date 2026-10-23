// Testes das correções de domínio: IR na venda parcial de ações,
// holerite sem "-", sobreaviso no backup, recorrente anual no cartão,
// parcela de fatura que duplicava, férias que atravessam o mês, INSS das
// férias junto com o salário, sinal do CSV com Débito/Crédito, lançamentos
// idênticos no mesmo extrato, toCents e arredondamento da redução do IR.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toCents } from '../js/core/money.js';
import { sanitizeProfile, sanitizeState } from '../js/domain/schema.js';
import { positionAt, DEFAULT_INVESTING } from '../js/domain/investments.js';
import { stockSalesTax } from '../js/domain/investPlus.js';
import { parsePayslipText, sideOf } from '../js/domain/payslip.js';
import { invoiceLines, invoiceMonthFor } from '../js/domain/cards.js';
import { parseCardInvoice, alignToInvoice } from '../js/domain/cardInvoice.js';
import { daysFor, vacationFor, vacationSplit, payrollFor, inssFor, irReductionFor } from '../js/domain/payroll.js';
import { tablesFor } from '../js/domain/taxTables.js';
import { parseCSV, parseOFX, fingerprint } from '../js/domain/importer.js';
import { emptyState } from './helpers.mjs';

// ---------- C3: IR na venda parcial de ações ----------

function stockState(movements) {
  const s = emptyState();
  s.investments = [{
    id: 'itsa', name: 'ITSA4', type: 'acoes', ticker: 'ITSA4', institution: '', rate: { kind: 'none', bp: 0 },
    liquidity: 'd2', maturity: null, emergency: false, notes: '', movements,
  }];
  return s;
}

test('C3: venda parcial com quantidade usa preço médio × cotas vendidas', () => {
  const s = stockState([
    { id: 'a', kind: 'aporte', date: '2026-01-10', cents: 3000000, qty: 1000, note: '' }, // 1.000 × R$ 30
    { id: 'v', kind: 'venda', date: '2026-03-10', cents: 2250000, qty: 500, note: '' }, // 500 × R$ 45
  ]);
  const r = stockSalesTax(s, 2026);
  const m = r.months[0];
  assert.equal(m.exempt, false); // R$ 22.500 > R$ 20 mil
  assert.equal(m.gains.acoes, 750000); // 22.500 − 500 × 30
  assert.equal(m.tax, 112500); // 15% de R$ 7.500
  assert.equal(r.total, 112500);

  const p = positionAt(s.investments[0], DEFAULT_INVESTING, '2026-03-31');
  assert.equal(p.qty, 500);
  assert.equal(p.principal, 1500000);
  assert.equal(p.realized, 750000);
  assert.equal(p.withdrawn, 2250000);
  assert.equal(p.avgPrice, 3000);
});

test('C3: duas vendas parciais e venda isenta continuam corretas', () => {
  const s = stockState([
    { id: 'a', kind: 'aporte', date: '2026-01-10', cents: 3000000, qty: 1000, note: '' },
    { id: 'v1', kind: 'venda', date: '2026-02-10', cents: 400000, qty: 100, note: '' }, // isenta (< 20 mil)
    { id: 'v2', kind: 'venda', date: '2026-04-10', cents: 2700000, qty: 900, note: '' }, // vende o resto a R$ 30
  ]);
  const r = stockSalesTax(s, 2026);
  assert.equal(r.months[0].exempt, true);
  assert.equal(r.months[0].gains.acoes, 100000); // 4.000 − 100 × 30
  assert.equal(r.months[1].gains.acoes, 0);
  assert.equal(r.total, 0);
  const p = positionAt(s.investments[0], DEFAULT_INVESTING, '2026-05-01');
  assert.equal(p.qty, 0);
  assert.equal(p.principal, 0);
  assert.equal(p.value, 0);
  assert.equal(p.realized, 100000);
});

// ---------- M6: holerite sem "-" nas colunas vazias ----------

test('M6: linha com referência + valor usa a classificação da verba', () => {
  const parsed = parsePayslipText([
    'Competência: 03/2026',
    '0001 SALARIO CONTRATUAL 30 3.000,00',
    '0003 I.N.S.S. 9,00 241,58',
    '0050 HORAS EXTRAS 50% 10:00 204,55',
    '0400 VALE TRANSPORTE 6% 180,00',
    '0500 PLANO DE SAUDE 150,00',
    '0600 SALARIO CONTRATUAL ANTIGO 1.000,00 0,00',
  ].join('\n'));
  const by = Object.fromEntries(parsed.items.map((x) => [x.code, x]));
  assert.deepEqual([by['0001'].provento, by['0001'].desconto, by['0001'].ref], [300000, 0, 30]);
  assert.deepEqual([by['0003'].provento, by['0003'].desconto, by['0003'].ref], [0, 24158, 9]);
  assert.equal(by['0050'].description, 'HORAS EXTRAS 50%');
  assert.deepEqual([by['0050'].provento, by['0050'].ref], [20455, 10]);
  assert.deepEqual([by['0400'].desconto, by['0400'].ref], [18000, 6]);
  assert.deepEqual([by['0500'].desconto, by['0500'].ref], [15000, null]);
  assert.deepEqual([by['0600'].provento, by['0600'].desconto], [100000, 0]); // "0,00" marca a coluna vazia
  assert.equal(sideOf('INSS S/ 13 SALARIO'), 'desconto');
  assert.equal(sideOf('ATESTADO MEDICO PREVIDENCIA'), 'provento');
});

// ---------- M7: sobreaviso por horas sobrevive ao backup ----------

test('M7: sobreaviso com value 0 não some na restauração', () => {
  const line = { id: 'sa1', description: 'Sobreaviso', mode: 'hours', value: 0, hourKind: 'sobreaviso', dsr: false, taxable: true };
  const p = sanitizeProfile({ from: '2026-01', grossCents: 500000, dependents: 0, additions: [line, { ...line, id: 'x', hourKind: 'he50' }], deductions: [] });
  assert.equal(p.additions.length, 1);
  assert.equal(p.additions[0].hourKind, 'sobreaviso');
  assert.equal(p.additions[0].value, 0);
  const raw = emptyState();
  raw.settings.salaryHistory = [{ from: '2026-01', grossCents: 500000, dependents: 0, additions: [line], deductions: [] }];
  const back = sanitizeState(JSON.parse(JSON.stringify(raw)));
  assert.equal(back.settings.salaryHistory[0].additions[0].id, 'sa1');
});

// ---------- M8: recorrente anual no cartão ----------

test('M8: assinatura no cartão entra na fatura que fecha depois da cobrança, no ritmo dela', () => {
  const s = emptyState();
  const card = { id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10 };
  s.cards = [card];
  s.recurring = [
    { id: 'r1', description: 'Anuidade app', cents: 12000, dueDay: 5, startYM: '2026-02', endYM: null, freq: 'annual', cardId: 'c1' },
    { id: 'r2', description: 'Streaming', cents: 3990, dueDay: 5, startYM: '2026-02', endYM: null, cardId: 'c1' },
    { id: 'r3', description: 'Café semanal', cents: 1000, dueDay: 2, startYM: '2026-03', endYM: null, freq: 'weekly', anchorDate: '2026-03-02', cardId: 'c1' },
  ];
  const rec = (ym, id) => invoiceLines(s, card, ym).filter((l) => l.purchase.recurringId === id);
  // cobrança em 05/02 é depois do fechamento (03/02): vai para a fatura de março
  assert.equal(rec('2026-03', 'r1').length, 1);
  for (const ym of ['2026-02', '2026-04', '2026-06', '2027-02']) assert.equal(rec(ym, 'r1').length, 0, ym);
  assert.equal(rec('2027-03', 'r1').length, 1);
  assert.equal(rec('2026-05', 'r2').length, 1); // mensal continua todo mês
  assert.equal(rec('2026-03', 'r3').length, 1); // 02/03 (antes do fechamento)
  assert.equal(rec('2026-04', 'r3').length, 4); // 9, 16, 23 e 30/03 (06/04 já é da fatura de maio)
  s.recurringEntries = { 'r3|2026-03-09': { skipped: true } };
  assert.equal(rec('2026-04', 'r3').length, 3);
});

// ---------- M9: parcela importada da fatura não duplica ----------

test('M9: a mesma compra parcelada tem a mesma impressão digital em faturas seguidas', () => {
  const card = { id: 'c1', closingDay: 3, dueDay: 10 };
  const read = (text) => {
    const { dueDate, rows } = parseCardInvoice(text);
    return alignToInvoice(card, rows[0], dueDate.slice(0, 7), invoiceMonthFor);
  };
  // R$ 100,00 em 3×: 33,34 + 33,33 + 33,33 — o centavo mudava a impressão digital
  const oct = read('Vencimento: 10/10/2026\n12/09 LOJA EXEMPLO 01/03 33,34');
  const nov = read('Vencimento: 10/11/2026\n12/09 LOJA EXEMPLO 02/03 33,33');
  assert.equal(oct.count, 3);
  assert.notEqual(oct.cents, nov.cents);
  assert.equal(oct.fingerprint, nov.fingerprint);
  // Compra à vista continua distinguindo valores
  const a = parseCardInvoice('Vencimento: 10/10/2026\n12/09 PADARIA 10,00').rows[0];
  const b = parseCardInvoice('Vencimento: 10/10/2026\n12/09 PADARIA 12,00').rows[0];
  assert.notEqual(a.fingerprint, b.fingerprint);
});

// ---------- M10/M11: férias ----------

function vacationSettings(vacation) {
  const s = emptyState().settings;
  s.salaryHistory = [{ from: '2026-01', grossCents: 600000, dependents: 0, additions: [], deductions: [] }];
  s.vacations = [{ id: 'v1', sellDays: 0, advance13: false, ...vacation }];
  return s;
}

test('M10: férias que atravessam o mês descontam os dias de cada mês', () => {
  const s = vacationSettings({ start: '2026-03-20', days: 20 });
  assert.deepEqual(vacationSplit(s.vacations[0]), [{ ym: '2026-03', days: 12 }, { ym: '2026-04', days: 8 }]);
  assert.equal(daysFor(s, '2026-03').workedDays, 18);
  assert.equal(daysFor(s, '2026-04').workedDays, 22);
  assert.equal(daysFor(s, '2026-05').workedDays, 30);
  assert.equal(payrollFor(s, '2026-04').base, 440000); // 22 dias de R$ 200
});

test('M11: INSS das férias é calculado junto com o salário do mês', () => {
  const s = vacationSettings({ start: '2026-06-01', days: 15 });
  const table = tablesFor(2026);
  const v = vacationFor(s, '2026-06');
  const p = payrollFor(s, '2026-06');
  assert.equal(v.pay + v.third, 400000); // 15 dias + 1/3
  assert.equal(p.bases.inss, 300000); // 15 dias trabalhados
  const joint = inssFor(700000, table);
  assert.equal(v.inss + p.inss, joint);
  assert.ok(joint > inssFor(300000, table) + inssFor(400000, table)); // separado subestimava

  // Atravessando o mês: soma das diferenças de cada competência
  const s2 = vacationSettings({ start: '2026-06-21', days: 20 }); // 10 dias em jun, 10 em jul
  const v2 = vacationFor(s2, '2026-06');
  const jun = payrollFor(s2, '2026-06');
  const jul = payrollFor(s2, '2026-07');
  const first = Math.round((v2.pay + v2.third) / 2);
  const second = v2.pay + v2.third - first;
  assert.equal(v2.inss, inssFor(jun.bases.inss + first, table) - jun.inss + inssFor(jul.bases.inss + second, table) - jul.inss);
});

// ---------- M12/M13: importação de extrato ----------

test('M12: com colunas Débito/Crédito o sinal nunca é invertido pela maioria', () => {
  const rows = parseCSV([
    'Data;Descrição;Débito;Crédito',
    '01/03/2026;SALARIO;;5.000,00',
    '02/03/2026;PIX RECEBIDO;;200,00',
    '03/03/2026;MERCADO;150,00;',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => r.cents), [-500000, -20000, 15000]);
});

test('M13: lançamentos idênticos no mesmo arquivo não viram um só', () => {
  const rows = parseCSV([
    'Data;Descrição;Valor',
    '05/03/2026;UBER *TRIP;-18,90',
    '05/03/2026;UBER *TRIP;-18,90',
    '06/03/2026;PADARIA;-10,00',
  ].join('\n'));
  const fps = rows.map(fingerprint);
  assert.equal(new Set(fps).size, 3);
  assert.equal(fps[0], '2026-03-05|1890|UBER TRIP'); // 1ª ocorrência: formato antigo (já importados continuam reconhecidos)
  assert.equal(fps[1], '2026-03-05|1890|UBER TRIP#2');

  const ofx = (fitid) => `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305<TRNAMT>-18.90<FITID>${fitid}<MEMO>UBER TRIP</STMTTRN>`;
  const distinct = parseOFX(`<OFX>${ofx('A1')}${ofx('A2')}`);
  assert.equal(new Set(distinct.map(fingerprint)).size, 2);
  const repeated = parseOFX(`<OFX>${ofx('A1')}${ofx('A1')}`);
  assert.equal(new Set(repeated.map(fingerprint)).size, 1); // mesmo FITID = mesma transação
});

// ---------- Baixos: toCents e redução do IR ----------

test('toCents aceita menos no fim e parênteses como negativo', () => {
  assert.equal(toCents('123,45-'), -12345);
  assert.equal(toCents('(50,00)'), -5000);
  assert.equal(toCents('R$ (1.234,56)'), -123456);
  assert.equal(toCents('−5'), -500);
  assert.equal(toCents('+10'), 1000);
  assert.equal(toCents('-1.234,56'), -123456);
  assert.ok(Number.isNaN(toCents('--5')));
  assert.ok(Number.isNaN(toCents('(5')));
  assert.ok(Number.isNaN(toCents('(-5)')));
});

test('redução do IR sem erro de 1 centavo (contas em inteiros)', () => {
  // 978,62 − 0,133145 × 7.000,00 = 46,605 → R$ 46,61 (em ponto flutuante dava 46,60)
  assert.equal(irReductionFor(700000, 99999, tablesFor(2026)), 4661);
});
