// Testes de domínio (sem navegador):
// boleto, Pix, fatura do cartão, dívidas, rescisão, IR na venda de ações,
// independência financeira, PGBL × VGBL, "posso comprar?", IRPF,
// conferência do holerite, migrações antigas e versão sincronizada.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { store } from '../js/core/store.js';
import { diffDays } from '../js/core/dates.js';
import { sanitizeState, SCHEMA_VERSION } from '../js/domain/schema.js';
import { parseBoleto, _dv } from '../js/domain/boleto.js';
import { parsePix, buildPix } from '../js/domain/pix.js';
import { parseCardInvoice, findDueDate } from '../js/domain/cardInvoice.js';
import { simulatePayoff, comparePayoff } from '../js/domain/debts.js';
import { simulateTermination } from '../js/domain/termination.js';
import { stockSalesTax, fiPlan, pensionCompare, dividendsCalendar } from '../js/domain/investPlus.js';
import { canIBuy } from '../js/domain/yearplan.js';
import { irpfForecast } from '../js/domain/irpf.js';
import { compareLines } from '../js/domain/payslip.js';
import { payrollFor } from '../js/domain/payroll.js';
import { parseQuickAdd } from '../js/domain/quickadd.js';
import * as A from '../js/domain/actions.js';
import { emptyState } from './helpers.mjs';

const today = '2026-10-15';
const reset = () => { store.data = emptyState(); store.data.onboarded = true; };

before(() => {
  store.guest = false; // conta aberta (sem login, alterações pedem para entrar)
  console.warn = () => {};
});

// ---------- Boleto ----------

function makeBankBarcode({ bank = '341', cents, due }) {
  const factor = 1000 + diffDays('2025-02-22', due);
  const free = '1790001010435100479102015'; // 25 dígitos do campo livre
  const noDv = `${bank}9${String(factor).padStart(4, '0')}${String(cents).padStart(10, '0')}${free}`;
  const dv = _dv.mod11Bank(noDv);
  return noDv.slice(0, 4) + dv + noDv.slice(4);
}
function toLine(bc) {
  const f1 = bc.slice(0, 4) + bc.slice(19, 24);
  const f2 = bc.slice(24, 34);
  const f3 = bc.slice(34, 44);
  return f1 + _dv.mod10(f1) + f2 + _dv.mod10(f2) + f3 + _dv.mod10(f3) + bc[4] + bc.slice(5, 19);
}

test('boleto: código de barras e linha digitável dão valor, banco e vencimento', () => {
  const bc = makeBankBarcode({ cents: 18990, due: '2026-11-10' });
  const a = parseBoleto(bc, today);
  assert.equal(a.cents, 18990);
  assert.equal(a.dueDate, '2026-11-10');
  assert.match(a.bank, /Itaú/);
  const line = toLine(bc);
  assert.equal(line.length, 47);
  const b = parseBoleto(line, today);
  assert.equal(b.cents, 18990);
  assert.equal(b.barcode, bc);
  // um dígito errado é detectado
  const typo = line.slice(0, 5) + ((Number(line[5]) + 1) % 10) + line.slice(6);
  assert.throws(() => parseBoleto(typo, today), /digitação/);
  assert.throws(() => parseBoleto('123', today), /linha digitável/);
});

// ---------- Pix ----------

test('Pix Copia e Cola: lê chave, valor e nome; CRC alterado é recusado', () => {
  const code = buildPix({ key: 'fulano@email.com', name: 'Fulano de Tal', city: 'Recife', cents: 4590, txid: 'ABC123' });
  const p = parsePix(code);
  assert.equal(p.key, 'fulano@email.com');
  assert.equal(p.cents, 4590);
  assert.equal(p.name, 'Fulano de Tal');
  assert.equal(p.txid, 'ABC123');
  assert.throws(() => parsePix(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')), /alterado/);
  assert.throws(() => parsePix('oi'), /Pix/);
});

// ---------- Fatura do cartão ----------

test('fatura: lê compras, parcelas e ignora pagamentos e IOF', () => {
  const text = [
    'Fatura Nubank · Vencimento: 10/11/2026',
    '12 OUT Uber *Trip 23,90',
    '15 OUT Magazine Luiza 03/10 150,00',
    '18 OUT Pagamento recebido 1.000,00',
    '20 OUT IOF compra internacional 1,20',
    '21/10 Farmácia São João 45,67',
  ].join('\n');
  assert.equal(findDueDate(text), '2026-11-10');
  const { dueDate, rows } = parseCardInvoice(text);
  assert.equal(dueDate, '2026-11-10');
  assert.equal(rows.length, 3);
  const uber = rows.find((r) => /uber/i.test(r.description));
  assert.equal(uber.date, '2026-10-12');
  assert.equal(uber.cents, 2390);
  const magalu = rows.find((r) => /magazine/i.test(r.description));
  assert.equal(magalu.count, 10);
  assert.equal(magalu.n, 3);
  assert.ok(parseCardInvoice(text, { includeFees: true }).rows.some((r) => /iof/i.test(r.description)));
});

// ---------- Dívidas ----------

test('dívidas: avalanche paga menos juros; pagamento menor que os juros trava', () => {
  const debts = [
    { id: 'a', name: 'Cartão', balanceCents: 300000, rateMonthlyBp: 1200, paymentCents: 30000 },
    { id: 'b', name: 'Empréstimo', balanceCents: 500000, rateMonthlyBp: 200, paymentCents: 30000 },
  ];
  const avalanche = simulatePayoff(debts, { extraCents: 20000, method: 'avalanche' });
  const snowball = simulatePayoff(debts, { extraCents: 20000, method: 'snowball' });
  assert.ok(avalanche.months > 0 && snowball.months > 0);
  assert.ok(avalanche.interest <= snowball.interest);
  assert.equal(avalanche.order[0].id, 'a'); // maior juro primeiro
  const cmp = comparePayoff(debts, 20000);
  assert.ok(cmp);
  const stuck = simulatePayoff([{ id: 'x', name: 'Rotativo', balanceCents: 1000000, rateMonthlyBp: 1500, paymentCents: 10000 }]);
  assert.equal(stuck.stuck, true);
  assert.equal(stuck.months, null);
});

// ---------- Rescisão ----------

test('rescisão: sem justa causa tem multa de 40% e saque; pedido de demissão não', () => {
  const base = { lastDay: '2026-10-15', admission: '2023-03-01', salaryCents: 500000, fgtsCents: 1200000, vacationsDueDays: 0, noticeServed: false };
  const fired = simulateTermination({ ...base, reason: 'sem_justa' });
  const quit = simulateTermination({ ...base, reason: 'pedido' });
  assert.equal(fired.fgts.fine, Math.round((fired.fgts.balance + fired.fgts.deposit) * 0.4));
  assert.ok(fired.fgts.withdraw > 0);
  assert.equal(quit.fgts.fine, 0);
  assert.equal(quit.fgts.withdraw, 0);
  assert.ok(fired.net > quit.net);
  assert.ok(fired.lines.some((l) => /aviso/i.test(l.label)));
});

// ---------- Investimentos ----------

function stocksState(sell) {
  reset();
  store.data.investments = [{
    id: 'petr', name: 'PETR4', type: 'acoes', ticker: 'PETR4', institution: '', rate: { kind: 'none', bp: 0 }, liquidity: 'd2', maturity: null, emergency: false, notes: '',
    movements: [
      { id: 'm1', kind: 'aporte', date: '2026-01-10', cents: 2000000, note: '' },
      { id: 'm2', kind: 'saldo', date: '2026-03-01', cents: 3000000, note: '' },
      { id: 'm3', kind: 'venda', date: '2026-03-10', cents: sell, note: '' },
      { id: 'm4', kind: 'provento', date: '2026-02-15', cents: 12000, note: '' },
    ],
  }];
  return store.data;
}

test('IR na venda de ações: isento até R$ 20 mil no mês; acima, 15% do lucro com DARF', () => {
  const small = stockSalesTax(stocksState(1500000), 2026);
  assert.equal(small.months.length, 1);
  assert.equal(small.months[0].exempt, true);
  assert.equal(small.total, 0);
  const big = stockSalesTax(stocksState(3000000), 2026);
  const m = big.months[0];
  assert.equal(m.exempt, false);
  assert.equal(m.gains.acoes, 1000000);
  assert.equal(m.tax, 150000);
  assert.equal(m.darfCode, '6015');
  assert.ok(m.darfDue.startsWith('2026-04'));
  const div = dividendsCalendar(stocksState(0 + 1), 12, today);
  assert.equal(div.last12, 12000);
});

test('independência financeira: regra dos 4% e aporte necessário', () => {
  const p = fiPlan({ currentCents: 10000000, monthlyCents: 200000, age: 30, targetAge: 55, monthlyCostCents: 500000, withdrawalBp: 400, annualRealRate: 0.04 });
  assert.equal(p.target, 150000000); // 5.000 × 12 ÷ 4% = 1,5 milhão
  assert.ok(p.needMonthly > 0);
  const rich = fiPlan({ currentCents: 200000000, monthlyCents: 0, age: 30, targetAge: 55, monthlyCostCents: 500000 });
  assert.equal(rich.onTrack, true);
  assert.equal(rich.needMonthly, 0);
});

test('PGBL compensa na declaração completa; na simplificada, VGBL', () => {
  const full = pensionCompare({ annualContribution: 1200000, taxableIncome: 12000000, years: 20, fullDeclaration: true });
  assert.equal(full.best, 'pgbl');
  assert.equal(full.pgbl.deductible, 1200000);
  const simple = pensionCompare({ annualContribution: 1200000, taxableIncome: 12000000, years: 20, fullDeclaration: false });
  assert.equal(simple.best, 'vgbl');
  assert.equal(simple.pgbl.deductible, 0);
});

// ---------- Planejamento e IR ----------

test('posso comprar? sem renda o veredito é não; com sobra folgada, sim', () => {
  reset();
  assert.equal(canIBuy(store.data, { cents: 500000, count: 1 }, 12, today).verdict, 'nao');
  A.savePayrollBase({ fromYM: '2026-01', grossCents: 1500000, dependents: 0 });
  A.saveGoal({ description: 'Reserva', targetCents: 3000000, initialCents: 2500000, emergency: true });
  const r = canIBuy(store.data, { cents: 100000, count: 1 }, 12, today);
  assert.notEqual(r.verdict, 'nao');
  assert.equal(r.months.length, 12);
});

test('IRPF: previsão do ano com salário cadastrado', () => {
  reset();
  A.savePayrollBase({ fromYM: '2026-01', grossCents: 800000, dependents: 0 });
  const f = irpfForecast(store.data, 2026, today);
  assert.equal(f.year, 2026);
  assert.ok(f.taxable > 0);
  assert.ok(f.withheld >= 0);
  assert.ok(['completa', 'simplificada'].includes(f.model) || typeof f.model === 'string');
});

test('holerite: conferência verba a verba casa nomes e mostra diferenças', () => {
  reset();
  A.savePayrollBase({ fromYM: '2026-01', grossCents: 500000, dependents: 0 });
  const p = payrollFor(store.data.settings, '2026-10');
  const rows = compareLines([
    { description: 'SALARIO BASE', provento: 500000, desconto: 0 },
    { description: 'INSS', provento: 0, desconto: p.inss },
    { description: 'IRRF', provento: 0, desconto: p.ir.value + 500 },
    { description: 'VALE TRANSPORTE', provento: 0, desconto: 30000 },
  ], p);
  assert.equal(rows.find((r) => r.label === 'SALARIO BASE').diff, 0);
  assert.equal(rows.find((r) => r.label === 'INSS').diff, 0);
  assert.equal(rows.find((r) => r.label === 'IRRF').diff, -500);
  assert.equal(rows.find((r) => r.label === 'VALE TRANSPORTE').app, null);
});

test('lançamento rápido: parcelado, recorrente e cartão', () => {
  const t = '2026-10-13';
  const inst = parseQuickAdd('tv 2400 em 10x', t);
  assert.equal(inst.type, 'installment');
  assert.equal(inst.count, 10);
  assert.equal(inst.cents, 240000);
  const rec = parseQuickAdd('luz 180 todo dia 20', t);
  assert.equal(rec.type, 'recurring');
  assert.equal(rec.dueDay, 20);
  const card = parseQuickAdd('gastei 50 no mercado no nubank', t, { cards: ['Nubank'] });
  assert.equal(card.card, 'Nubank');
  assert.equal(card.cents, 5000);
});

// ---------- Migrações (dados nos formatos antigos 1 a 7) ----------

const FIXTURES = {
  1: { schema: 1, settings: { salaryDay: 10, profileName: 'Ana' }, expenses: [{ id: 'e1', description: 'Luz', cents: 15000, dueDate: '2024-03-10', paidAt: null }], recurring: [], installments: [], goals: [], categories: [] },
  2: { schema: 2, settings: { salaryDay: 5, salaryHistory: [{ from: '2024-01', cents: 300000 }] }, expenses: [], recurring: [{ id: 'r1', description: 'Aluguel', cents: 120000, dueDay: 31, startYM: '2024-01' }], installments: [], goals: [] },
  3: { schema: 3, settings: { salaryDay: 5 }, expenses: [], recurring: [], installments: [{ id: 'i1', description: 'Celular', totalCents: 240000, count: 12, firstDueDate: '2025-01-15', paidCount: 2 }], goals: [] },
  4: { schema: 4, settings: { salaryDay: 5, theme: 'dark' }, expenses: [], recurring: [], installments: [], goals: [{ id: 'g1', description: 'Viagem', targetCents: 500000, contributions: [{ id: 'c1', date: '2025-05-01', cents: 10000 }] }] },
  5: { schema: 5, settings: { salaryDay: 5, investing: { cdiBp: 1400 } }, expenses: [], recurring: [], installments: [], goals: [], investments: [{ id: 'v1', name: 'CDB', type: 'cdb', rate: { kind: 'cdi', bp: 11000 }, liquidity: 'd0', movements: [{ id: 'mv', kind: 'aporte', date: '2025-06-01', cents: 100000 }] }] },
  6: { schema: 6, settings: { salaryDay: 5, rules: [{ id: 'ru', pattern: 'uber', categoryId: 'transporte' }] }, expenses: [], recurring: [], installments: [], goals: [], closedMonths: { '2025-12': { closedAt: '2026-01-01' } } },
  7: { schema: 7, settings: { salaryDay: 5 }, expenses: [], recurring: [], installments: [], goals: [{ id: 'g2', description: 'Reserva de emergência', targetCents: 1000000, contributions: [] }] },
};

test('migração: backups em todos os formatos antigos (1 a 7) abrem no formato atual', () => {
  for (const [v, raw] of Object.entries(FIXTURES)) {
    const s = sanitizeState(structuredClone(raw));
    assert.equal(s.schema, SCHEMA_VERSION, `formato ${v}`);
    for (const k of ['expenses', 'recurring', 'installments', 'goals', 'cards', 'cardPurchases', 'accounts', 'transfers', 'shifts', 'receivables', 'debts', 'wishlist']) {
      assert.ok(Array.isArray(s[k]), `formato ${v}: ${k} deve ser lista`);
    }
    assert.ok(Array.isArray(s.settings.tabbar) && s.settings.tabbar.length === 3, `formato ${v}: atalhos`);
  }
  assert.equal(sanitizeState(structuredClone(FIXTURES[1])).expenses[0].cents, 15000);
  assert.equal(sanitizeState(structuredClone(FIXTURES[1])).settings.profileName, 'Ana');
  assert.equal(sanitizeState(structuredClone(FIXTURES[2])).recurring[0].description, 'Aluguel');
  assert.equal(sanitizeState(structuredClone(FIXTURES[4])).goals[0].contributions.length, 1);
  assert.equal(sanitizeState(structuredClone(FIXTURES[5])).investments[0].movements.length, 1);
  // Formato 7: a meta antiga chamada "Reserva de emergência" vira reserva marcada
  assert.equal(sanitizeState(structuredClone(FIXTURES[7])).goals[0].emergency, true);
  assert.throws(() => sanitizeState({ schema: SCHEMA_VERSION + 1, settings: {}, expenses: [] }), /mais nova/);
});

// ---------- Versão sincronizada ----------

test('versão: package.json, js/version.js e cores do tema batem', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { APP_VERSION } = await import('../js/version.js');
  assert.equal(APP_VERSION, pkg.version);
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const { THEME_COLORS } = await import('../js/core/theme.js');
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.theme_color.toUpperCase(), THEME_COLORS.light.toUpperCase());
  assert.ok(index.includes(`content="${THEME_COLORS.light}"`));
  const changelog = await import('../js/changelog.js');
  assert.equal(changelog.CHANGELOG[0].version, pkg.version);
});
