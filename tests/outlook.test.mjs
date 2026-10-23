// Testes da versão 3.4: salário × ganhos × gastos, ganhos extras
// recorrentes, situação dos meses (folgado / apertado / não fecha),
// peso no futuro, selos dos lançamentos, prévia de impacto e dicas.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeState, SCHEMA_VERSION, DEFAULT_ALERTS } from '../js/domain/schema.js';
import { computeMonth, extrasOf } from '../js/domain/ledger.js';
import { projection, insightsFor, nextActions } from '../js/domain/analysis.js';
import { yearPlan, canIBuy } from '../js/domain/yearplan.js';
import { monthStatus, bigThreshold } from '../js/domain/monthStatus.js';
import { monthMoney, monthWhy, impactPreview, shortMonthsAhead } from '../js/domain/outlook.js';
import { futureWeight, futureWeightSummary, itemFlags, purchaseFlags } from '../js/domain/weights.js';
import { adviceFor } from '../js/domain/advice.js';
import { accountBalance } from '../js/domain/accounts.js';
import { mergeStates } from '../js/domain/merge.js';
import { emptyState } from './helpers.mjs';

const TODAY = '2026-10-15';
const profile = (cents) => ({ from: '2026-01', grossCents: cents, dependents: 0, additions: [], deductions: [] });

/** Estado com salário, aluguel e luz (variável). */
function base(gross = 500000) {
  const s = emptyState();
  s.settings.salaryHistory = [profile(gross)];
  s.recurring.push({ id: 'aluguel', description: 'Aluguel', cents: 150000, dueDay: 10, startYM: '2026-01', endYM: null, freq: 'monthly', tags: [] });
  return s;
}
const inst = (id, parcel, count, first, extra = {}) => ({
  id, description: id, totalCents: parcel * count, count, firstDueDate: first, dueDay: Number(first.slice(8)), paid: [], paidOn: {},
  categoryId: null, subcategoryId: null, creditorId: null, notes: '', tags: [], ...extra,
});

// ---------- Modelo e migração ----------

test('schema 9: backup antigo ganha recurringIncomes vazio e limites padrão, sem perder nada', () => {
  const old = { schema: 8, settings: { salaryDay: 5 }, expenses: [{ id: 'e1', description: 'Luz', cents: 12000, dueDate: '2026-10-10', paidAt: null }], extraIncomes: [{ id: 'x', ym: '2026-10', description: 'Freela', cents: 50000, date: '2026-10-03', payroll: false }] };
  const s = sanitizeState(old);
  assert.equal(SCHEMA_VERSION, 9);
  assert.deepEqual(s.recurringIncomes, []);
  assert.deepEqual(s.settings.alerts, DEFAULT_ALERTS);
  assert.equal(s.expenses.length, 1);
  assert.equal(s.extraIncomes[0].cents, 50000);
});

test('sanitização: limites fora da faixa voltam ao padrão; recorrente de plantão vira "extra"', () => {
  const s = sanitizeState({
    schema: 9, settings: { alerts: { tightPct: 99, overspendPct: 5, bigPct: 20, push: false } }, expenses: [],
    recurringIncomes: [
      { id: 'r1', description: 'Aluguel recebido', cents: 80000, day: 40, startYM: '2026-01', endYM: '2025-01', kind: 'plantao', skipped: ['2026-03', 'x', '2026-03'] },
      { id: 'r2', cents: -1, startYM: '2026-01' },
    ],
  });
  assert.deepEqual(s.settings.alerts, { tightPct: DEFAULT_ALERTS.tightPct, overspendPct: DEFAULT_ALERTS.overspendPct, bigPct: 20, push: false });
  assert.equal(s.recurringIncomes.length, 1);
  const r = s.recurringIncomes[0];
  assert.equal(r.kind, 'extra');
  assert.equal(r.endYM, null); // fim antes do início é descartado
  assert.equal(r.day, 5);
  assert.deepEqual(r.skipped, ['2026-03']);
});

test('merge entre aparelhos: receita recorrente criada em um lado entra no outro', () => {
  const b = emptyState();
  const local = structuredClone(b);
  local.recurringIncomes.push({ id: 'r1', description: 'Pensão', cents: 60000, day: 10, startYM: '2026-10', endYM: null, kind: 'extra', accountId: null, skipped: [] });
  const remote = structuredClone(b);
  remote.settings.alerts = { ...remote.settings.alerts, tightPct: 20 };
  const m = mergeStates(b, local, remote);
  assert.equal(m.recurringIncomes.length, 1);
  assert.equal(m.settings.alerts.tightPct, 20);
});

// ---------- Ganhos extras recorrentes ----------

test('receita recorrente entra todo mês fora da folha, respeita mês pulado e fim', () => {
  const s = base();
  s.recurringIncomes.push({ id: 'r1', description: 'Aluguel recebido', cents: 80000, day: 8, startYM: '2026-10', endYM: '2026-12', kind: 'extra', accountId: null, skipped: ['2026-11'] });
  const oct = computeMonth(s, '2026-10', TODAY);
  const sep = computeMonth(s, '2026-09', TODAY);
  assert.equal(oct.income.total - sep.income.total, 80000); // líquido, não passa por INSS/IR
  assert.equal(extrasOf(s, '2026-11', TODAY).length, 0);
  assert.equal(extrasOf(s, '2026-12').length, 1);
  assert.equal(extrasOf(s, '2027-01').length, 0);
  assert.equal(extrasOf(s, '2026-10')[0].date, '2026-10-08');
});

test('receita recorrente com conta bancária soma no saldo da conta', () => {
  const s = base();
  s.accounts.push({ id: 'a1', name: 'Banco', kind: 'corrente', institution: '', color: '#000000', anchor: { cents: 10000, date: '2026-09-30' }, archived: false });
  s.recurringIncomes.push({ id: 'r1', description: 'Pensão', cents: 30000, day: 5, startYM: '2026-09', endYM: null, kind: 'extra', accountId: 'a1', skipped: [] });
  assert.equal(accountBalance(s, s.accounts[0], '2026-10-15'), 40000); // set/26 fica antes do saldo de partida
});

// ---------- Os três saldos ----------

test('monthMoney: salário + fora da folha + outros = ganhos; saldo igual ao do mês', () => {
  const s = base();
  s.extraIncomes.push({ id: 'p', ym: '2026-10', description: 'Plantão', cents: 100000, date: '2026-10-12', payroll: true, kind: 'plantao' });
  s.extraIncomes.push({ id: 'f', ym: '2026-10', description: 'Freela', cents: 70000, date: '2026-10-20', payroll: false, kind: 'freela' });
  s.expenses.push({ id: 'e', description: 'Mercado', cents: 40000, dueDate: '2026-10-05', paidAt: '2026-10-05' });
  const mm = monthMoney(s, '2026-10', TODAY);
  const m = computeMonth(s, '2026-10', TODAY);
  assert.equal(mm.salary.net + mm.extras.total + mm.others.total, mm.earnings);
  assert.equal(mm.earnings, m.income.total);
  assert.equal(mm.extras.total, 70000);
  assert.equal(mm.balance, m.balance);
  assert.equal(mm.spending.total, m.totals.all);
  assert.equal(mm.spending.paid, 40000);
  // plantão na folha aparece como adição e o líquido bate com bruto − descontos
  assert.ok(mm.salary.additions.some((a) => a.label === 'Plantão' && a.cents === 100000));
  assert.equal(mm.salary.gross - mm.salary.deductionsTotal, mm.salary.net);
});

// ---------- Situação dos meses ----------

test('monthStatus usa a folga mínima de Ajustes', () => {
  const settings = { alerts: { ...DEFAULT_ALERTS, tightPct: 10 } };
  assert.equal(monthStatus(-1, 100000, settings), 'short');
  assert.equal(monthStatus(9999, 100000, settings), 'tight');
  assert.equal(monthStatus(10000, 100000, settings), 'ok');
  assert.equal(monthStatus(0, 0, settings, 0), 'none');
  assert.equal(monthStatus(15000, 100000, { alerts: { ...DEFAULT_ALERTS, tightPct: 20 } }), 'tight');
});

test('previsão: 12 meses e projeção usam a MESMA renda (com 13º e benefícios) e a mesma sobra', () => {
  const s = base();
  s.settings.benefits = [{ id: 'plr', kind: 'plr', name: 'PLR', cents: 200000, month: 3, monthly: false }];
  const proj = projection(s, '2026-10', 12, TODAY);
  const plan = yearPlan(s, '2026-10', 12, TODAY);
  for (let i = 0; i < 12; i++) {
    assert.equal(plan.months[i].balance, proj[i].balance);
    assert.equal(plan.months[i].income, proj[i].income);
  }
  const nov = proj.find((p) => p.ym === '2026-11');
  assert.ok(nov.thirteenth > 0, '13º em novembro');
  assert.equal(nov.income, computeMonth(s, '2026-11', TODAY).income.total + nov.thirteenth);
});

test('mês que não fecha: status, quantos meses e o porquê', () => {
  const s = base(300000);
  s.installments.push(inst('Carro', 200000, 3, '2027-01-10'));
  const plan = yearPlan(s, '2026-10', 12, TODAY);
  const jan = plan.months.find((m) => m.ym === '2027-01');
  assert.equal(jan.status, 'short');
  assert.ok(plan.shortMonths.includes('2027-01'));
  assert.equal(plan.months.find((m) => m.ym === '2027-04').status, 'ok');
  const why = monthWhy(s, '2027-01', TODAY);
  assert.equal(why.balance, jan.balance);
  assert.equal(why.gap, -jan.balance);
  assert.equal(why.causes[0].label, 'Carro');
  assert.equal(shortMonthsAhead(s, TODAY).count, 3);
  const off = structuredClone(s);
  off.settings.alerts = { ...DEFAULT_ALERTS, push: false };
  assert.equal(shortMonthsAhead(off, TODAY).count, 0);
});

test('gasto grande e pontual soma por cima do dia a dia estimado', () => {
  const s = base();
  for (const ym of ['2026-07', '2026-08', '2026-09']) s.expenses.push({ id: `m${ym}`, description: 'Mercado', cents: 80000, dueDate: `${ym}-05`, paidAt: `${ym}-05` });
  const before = yearPlan(s, '2026-10', 12, TODAY).months[1]; // nov: só a estimativa
  assert.equal(before.variable, 80000);
  const big = bigThreshold(computeMonth(s, '2026-11', TODAY).income.total, s.settings);
  const s2 = structuredClone(s); // cada mudança gera um estado novo (como store.commit)
  s2.expenses.push({ id: 'tv', description: 'TV', cents: big + 100000, dueDate: '2026-11-20', paidAt: null });
  const after = yearPlan(s2, '2026-10', 12, TODAY).months[1];
  assert.equal(after.variable, 80000 + big + 100000);
});

// ---------- Prévia de impacto = o que a previsão mostra depois de salvar ----------

test('prévia do parcelamento bate com a previsão depois de salvar', () => {
  const s = base(300000);
  const draft = { kind: 'installment', parcelCents: 90000, count: 4, paidCount: 0, nextDueDate: '2026-12-10', dueDay: 10 };
  const prev = impactPreview(s, draft, TODAY);
  const saved = structuredClone(s);
  saved.installments.push(inst('Geladeira', 90000, 4, '2026-12-10'));
  const plan = yearPlan(saved, '2026-10', 12, TODAY);
  for (const r of prev.months.slice(0, 12)) assert.equal(r.after, plan.months.find((m) => m.ym === r.ym).balance, r.ym);
  assert.equal(prev.affected.filter((r) => r.has).length, 4);
  assert.match(prev.headline.text, /parcelamento|Cabe/);
});

test('prévia de avulsa grande: mês negativo, frase clara e efeito até o salário', () => {
  const s = base(300000);
  const prev = impactPreview(s, { kind: 'expense', cents: 400000, dueDate: '2026-10-20' }, TODAY);
  const oct = prev.months[0];
  assert.equal(oct.statusAfter, 'short');
  assert.equal(prev.headline.tone, 'bad');
  assert.match(prev.headline.text, /outubro de 2026 fica negativo em/);
  const saved = structuredClone(s);
  saved.expenses.push({ id: 'x', description: 'Viagem', cents: 400000, dueDate: '2026-10-20', paidAt: null });
  assert.equal(oct.after, yearPlan(saved, '2026-10', 12, TODAY).months[0].balance);
  assert.ok(prev.untilPay, 'vence antes do próximo salário');
  assert.equal(prev.untilPay.after, prev.untilPay.free - 400000);
});

test('prévia ao EDITAR desconta o lançamento antigo (sem contar duas vezes)', () => {
  const s = base();
  s.installments.push(inst('Sofá', 50000, 3, '2026-11-10'));
  const same = impactPreview(s, { kind: 'installment', parcelCents: 50000, count: 3, paidCount: 0, nextDueDate: '2026-11-10', dueDay: 10, replace: { kind: 'installment', id: 'Sofá' } }, TODAY);
  assert.ok(same.months.every((r) => r.delta === 0));
});

test('prévia da compra no cartão segue as faturas; recorrente destaca só os meses que pesam', () => {
  const s = base(300000);
  s.cards.push({ id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10, limitCents: 0, color: '#000000', accountId: null, archived: false });
  const card = impactPreview(s, { kind: 'card', cardId: 'c1', date: '2026-10-15', cents: 60000, count: 3 }, TODAY);
  assert.deepEqual(card.affected.filter((r) => r.has).map((r) => r.ym), ['2026-11', '2026-12', '2027-01']);
  const rec = impactPreview(s, { kind: 'recurring', cents: 150000, dueDay: 5, freq: 'monthly', startYM: '2026-11', endYM: null }, TODAY);
  assert.ok(rec.weighs.length > 0 && rec.weighs.every((r) => r.statusAfter !== 'ok'));
  assert.ok(rec.weighs.length < rec.affected.length || rec.weighs.length === rec.affected.filter((r) => r.has).length);
});

test('"Posso comprar?" usa a mesma prévia do editor', () => {
  const s = base(300000);
  const r = canIBuy(s, { cents: 360000, count: 3 }, 12, TODAY);
  const p = impactPreview(s, { kind: 'installment', parcelCents: 120000, count: 3, paidCount: 0, nextDueDate: '2026-11-10', dueDay: 10 }, TODAY);
  assert.deepEqual(r.months.map((m) => m.after), p.months.slice(0, 12).map((m) => m.after));
  assert.equal(r.verdict, r.months.some((m) => m.after < 0) ? 'nao' : r.verdict);
});

// ---------- Peso no futuro e selos ----------

test('peso no futuro: parcelas restantes, compra parcelada no cartão e recorrente nova', () => {
  const s = base();
  s.installments.push(inst('Notebook', 30000, 5, '2026-09-10'));
  s.cards.push({ id: 'c1', name: 'Cartão', closingDay: 3, dueDay: 10, limitCents: 0, color: '#000000', accountId: null, archived: false });
  s.cardPurchases.push({ id: 'p1', cardId: 'c1', description: 'Celular', date: '2026-09-20', cents: 120000, count: 4, tags: [] });
  s.recurring.push({ id: 'gym', description: 'Academia', cents: 9000, dueDay: 15, startYM: '2026-10', endYM: null, freq: 'monthly', tags: [] });
  const fw = futureWeight(s, '2026-10', TODAY);
  const by = Object.fromEntries(fw.list.map((w) => [w.kind, w]));
  assert.equal(by.installment.months.length, 3); // nov, dez, jan
  assert.equal(by.installment.until, '2027-01');
  assert.equal(by.card.until, '2027-01'); // 1ª fatura out/26 → 4ª jan/27
  assert.equal(by.recurring.endless, true);
  assert.equal(fw.byMonth['2026-11'], 30000 + 30000 + 9000);
  assert.match(futureWeightSummary(fw), /2 gastos deste mês ainda vão pesar até jan\/27 e 1 compromisso novo/);
  const flags = itemFlags(s, '2026-10', TODAY);
  assert.ok(flags.get('installment:Notebook:2').some((f) => f.type === 'future'));
  assert.ok(flags.get('invoice:c1:2026-10').some((f) => f.type === 'future'));
  assert.equal(purchaseFlags(s, s.cardPurchases[0], TODAY)[0].type, 'future');
});

test('selos: conta bem acima da própria média é "exagerada"; avulsa grande é "fora do comum"', () => {
  const s = base();
  s.recurring.push({ id: 'luz', description: 'Luz', cents: 20000, dueDay: 12, startYM: '2026-01', endYM: null, freq: 'monthly', variable: true, tags: [] });
  for (const ym of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) s.recurringEntries[`luz|${ym}`] = { paidAt: `${ym}-12`, cents: 20000, skipped: false };
  s.recurringEntries['luz|2026-10'] = { paidAt: null, cents: 30000, skipped: false };
  s.expenses.push({ id: 'tv', description: 'TV', cents: 200000, dueDate: '2026-10-18', paidAt: null });
  const flags = itemFlags(s, '2026-10', TODAY);
  const luz = flags.get('recurring:luz:2026-10').find((f) => f.type === 'over');
  assert.equal(Math.round(luz.pct), 50);
  assert.equal(luz.avg, 20000);
  assert.ok(flags.get('expense:tv').some((f) => f.type === 'unusual'));
  // limite configurável: 60% → a luz deixa de ser exagerada
  const s2 = structuredClone(s);
  s2.settings.alerts = { ...DEFAULT_ALERTS, overspendPct: 60 };
  assert.ok(!(itemFlags(s2, '2026-10', TODAY).get('recurring:luz:2026-10') || []).some((f) => f.type === 'over'));
});

// ---------- Dicas ----------

test('dicas em três níveis com números concretos', () => {
  const s = base(300000);
  s.installments.push(inst('Carro', 120000, 6, '2027-01-10'));
  s.recurring.push({ id: 'ipva', description: 'IPVA', cents: 180000, dueDay: 15, startYM: '2027-02', endYM: null, freq: 'annual', tags: [] });
  s.recurring.push({ id: 'luz', description: 'Luz', cents: 20000, dueDay: 12, startYM: '2026-01', endYM: null, freq: 'monthly', tags: [] });
  for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) s.recurringEntries[`luz|${ym}`] = { paidAt: `${ym}-12`, cents: 20000, skipped: false };
  s.recurringEntries['luz|2026-10'] = { paidAt: null, cents: 28000, skipped: false };
  const a = adviceFor(s, '2026-10', TODAY);
  assert.ok(a.simples.some((t) => /Luz: 40% acima da média/.test(t.title)), 'simples: luz 40% acima');
  assert.ok(a.media.some((t) => /Antecipe a parcela de Carro/.test(t.title) && /passa de −R\$/.test(t.text.replace(/\s/g, ' '))), 'média: antecipar parcela');
  assert.ok(a.complexa.some((t) => t.id.startsWith('seasonal:')), 'complexa: IPVA');
  assert.ok(a.all.every((t) => ['simples', 'media', 'complexa'].includes(t.level)));
  // nextActions recebe a dica mais urgente
  const m = computeMonth(s, '2026-10', TODAY);
  const actions = nextActions(s, m, TODAY, { advice: a });
  assert.ok(actions.some((x) => x.level === 'media' || x.level === 'complexa' || x.id?.startsWith('over:')));
  assert.ok(insightsFor(s, m, TODAY).every((i) => i.level === 'simples'));
});

test('dica "cabe uma parcela nova" respeita a folga mínima em todos os meses', () => {
  const s = base();
  const a = adviceFor(s, '2026-10', TODAY);
  const room = a.complexa.find((t) => t.id === 'room');
  assert.match(room.title, /Cabe uma parcela nova de até/);
  const cents = Number(room.title.match(/R\$\s?([\d.]+),00/)[1].replace(/\./g, '')) * 100;
  const prev = impactPreview(s, { kind: 'installment', parcelCents: cents, count: 12, paidCount: 0, nextDueDate: '2026-10-20', dueDay: 20 }, TODAY);
  assert.ok(prev.months.slice(0, 12).every((r) => r.statusAfter === 'ok'));
});
