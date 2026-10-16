// =============================================================
// sample.js — Dados de exemplo para experimentar o app
// -------------------------------------------------------------
// Um mês "de verdade" de quem vive de salário: salário CLT com
// insalubridade, plantões, contas fixas, cartão com compras
// parceladas, meta de reserva ligada a um CDB, um investimento em
// ações e uma conta atrasada. Gerado em volta da data de hoje.
// =============================================================

import { createEmptyState, newId } from './schema.js';
import { addMonthsYM, dateInMonth, ymOf, todayISO, addDaysISO } from '../core/dates.js';

export function createSampleState(today = todayISO()) {
  const s = createEmptyState();
  const ym = ymOf(today);
  const prev = addMonthsYM(ym, -1);
  const prev2 = addMonthsYM(ym, -2);
  const cat = (name) => s.categories.find((c) => c.name === name);
  const sub = (c, name) => c.subcategories.find((x) => x.name === name)?.id || null;
  s.onboarded = true;
  s.settings.profileName = 'Exemplo';
  s.settings.payday = { mode: 'business', nth: 5, saturday: true, nextMonth: false };
  s.settings.salaryHistory = [{
    from: addMonthsYM(ym, -6), grossCents: 520000, dependents: 1,
    additions: [{ id: newId(), description: 'Insalubridade', mode: 'percent', value: 2000, base: 'minimum', taxable: true }],
    deductions: [{ id: newId(), description: 'Plano de saúde', mode: 'fixed', value: 18000, base: 'salary', irDeductible: true }],
  }];
  s.settings.spendingLimitCents = 450000;
  s.settings.shiftTypes[0].cents = 70000;
  s.settings.shiftTypes[2].cents = 85000;
  for (const [m, days] of [[prev2, [4, 18]], [prev, [6, 13, 27]], [ym, [3, 17]]]) {
    for (const d of days) s.shifts.push({ id: newId(), date: dateInMonth(m, d), typeId: d % 2 ? 'plantao12' : 'noturno12', note: '' });
  }

  const nu = { id: newId(), name: 'Nubank', kind: 'digital', institution: 'Nubank', color: '#8A05BE', anchor: { cents: 182000, date: dateInMonth(ym, 1) }, archived: false };
  const wallet = { id: newId(), name: 'Dinheiro', kind: 'carteira', institution: '', color: '#0F766E', anchor: { cents: 15000, date: dateInMonth(ym, 1) }, archived: false };
  s.accounts.push(nu, wallet);
  s.settings.salaryAccountId = nu.id;

  const card = { id: newId(), name: 'Nubank Roxinho', closingDay: 3, dueDay: 10, limitCents: 600000, color: '#8A05BE', accountId: nu.id, archived: false };
  s.cards.push(card);
  const ali = cat('Alimentação');
  const lazer = cat('Lazer e viagens');
  const compras = cat('Compras pessoais');
  const transp = cat('Transporte');
  for (const [m, list] of [[prev, [['Supermercado', 42000, 6], ['iFood', 6890, 12], ['Uber', 2350, 15]]], [ym, [['Supermercado', 51000, 2], ['iFood', 8790, 5], ['Cinema', 6000, 8], ['Posto Shell', 25000, 11]]]]) {
    for (const [desc, cents, day] of list) {
      const c = /Super|iFood/.test(desc) ? ali : desc === 'Cinema' ? lazer : transp;
      s.cardPurchases.push({ id: newId(), cardId: card.id, description: desc, date: dateInMonth(m, day), cents, count: 1, categoryId: c.id, subcategoryId: desc === 'iFood' ? sub(c, 'Delivery') : desc === 'Supermercado' ? sub(c, 'Supermercado - Essenciais') : null, tags: [], notes: '', splits: [] });
    }
  }
  s.cardPurchases.push({ id: newId(), cardId: card.id, description: 'Celular', date: dateInMonth(prev2, 20), cents: 240000, count: 10, categoryId: compras.id, subcategoryId: sub(compras, 'Eletrônicos'), tags: [], notes: '', splits: [] });

  const mor = cat('Moradia');
  const ass = cat('Assinaturas');
  const rec = (description, cents, dueDay, c, subName, extra = {}) => s.recurring.push({
    id: newId(), description, cents, dueDay, startYM: addMonthsYM(ym, -6), endYM: null, categoryId: c.id, subcategoryId: subName ? sub(c, subName) : null,
    creditorId: null, notes: '', tags: [], freq: 'monthly', anchorDate: null, variable: false, subscription: false, renewal: null, adjust: null, priceHistory: [], accountId: nu.id, cardId: null, ...extra,
  });
  rec('Aluguel', 140000, 10, mor, 'Aluguel', { adjust: { index: 'igpm', month: Number(addMonthsYM(ym, 3).slice(5)), pctBp: 0, lastYM: null } });
  rec('Internet', 9990, 15, mor, 'Internet');
  rec('Luz', 16000, 20, mor, 'Energia elétrica', { variable: true });
  rec('Netflix', 5590, 18, ass, 'Streaming', { subscription: true, cardId: card.id });
  const luz = s.recurring.find((r) => r.description === 'Luz');
  s.recurringEntries[`${luz.id}|${prev2}`] = { paidAt: dateInMonth(prev2, 20), cents: 14800, skipped: false };
  s.recurringEntries[`${luz.id}|${prev}`] = { paidAt: dateInMonth(prev, 21), cents: 17900, skipped: false };
  for (const r of s.recurring) {
    if (r.cardId || r.variable) continue;
    for (const m of [prev2, prev]) s.recurringEntries[`${r.id}|${m}`] = { paidAt: dateInMonth(m, r.dueDay), cents: r.cents, skipped: false };
  }

  const saude = cat('Saúde e bem-estar');
  s.expenses.push(
    { id: newId(), description: 'Dentista', cents: 25000, dueDate: addDaysISO(today, -4), paidAt: null, categoryId: saude.id, subcategoryId: sub(saude, 'Odontologia'), creditorId: null, notes: '', tags: [], splits: [], attachments: [], accountId: null },
    { id: newId(), description: 'Farmácia', cents: 8740, dueDate: addDaysISO(today, -2), paidAt: addDaysISO(today, -2), categoryId: saude.id, subcategoryId: sub(saude, 'Medicamentos'), creditorId: null, notes: '', tags: [], splits: [], attachments: [], accountId: wallet.id },
  );

  const cdb = { id: newId(), name: 'CDB Liquidez Diária', type: 'cdb', institution: 'Nubank', rate: { kind: 'cdi', bp: 10000 }, liquidity: 'd0', maturity: null, emergency: true, notes: '', ticker: '', pension: '', movements: [{ id: newId(), date: dateInMonth(addMonthsYM(ym, -8), 10), kind: 'aporte', cents: 500000, note: '' }, { id: newId(), date: dateInMonth(prev, 10), kind: 'aporte', cents: 50000, note: '' }] };
  const fii = { id: newId(), name: 'HGLG11', type: 'fii', institution: 'Corretora', rate: { kind: 'none', bp: 0 }, liquidity: 'd2', maturity: null, emergency: false, notes: '', ticker: 'HGLG11', pension: '', movements: [{ id: newId(), date: dateInMonth(addMonthsYM(ym, -5), 12), kind: 'aporte', cents: 160000, qty: 10, note: '' }, { id: newId(), date: dateInMonth(prev, 15), kind: 'provento', cents: 1100, note: 'Rendimento' }] };
  s.investments.push(cdb, fii);
  s.goals.push(
    { id: newId(), description: 'Reserva de emergência', targetCents: 2400000, deadline: null, icon: '🛡️', emergency: true, investmentIds: [cdb.id], contributions: [] },
    { id: newId(), description: 'Viagem de fim de ano', targetCents: 500000, deadline: dateInMonth(addMonthsYM(ym, 2), 20), icon: '✈️', emergency: false, investmentIds: [], contributions: [{ id: newId(), date: dateInMonth(prev, 6), cents: 150000 }] },
  );
  s.receivables.push({ id: newId(), creditorId: null, person: 'Ana (irmã)', description: 'Empréstimo', cents: 30000, date: dateInMonth(prev, 22), dueDate: dateInMonth(ym, 28), receivedAt: null, partials: [], notes: '' });
  return s;
}
