// @ts-check
// =============================================================
// schema.js — Formato dos dados salvos
// -------------------------------------------------------------
// Todo o estado do app é UM objeto JSON. Ele é salvo no
// navegador (IndexedDB) e é exatamente o que vai no backup.
//
// Formato (schema 8):
// {
//   schema: 8,
//   settings: {
//     profileName, salaryDay, theme, accent, density, motion,
//     payday: { mode: 'fixed'|'business', nth, saturday, nextMonth },
//     salaryHistory: [perfil salarial BRUTO — ver domain/payroll.js], // vale a partir de `from`
//     payrollLoans: [desconto parcelado/consignado — ver domain/payroll.js],
//     payrollVariable: [adicional/desconto VARIÁVEL de um mês — ver domain/payroll.js],
//     employment: { admission, regime: 'inss'|'fixed', fixedRateBp, thirteenth, hoursDivisor, familyChildren },
//     actualNet: { "AAAA-MM": centavos },                     // líquido conferido no holerite real
//     onCallHours: { "AAAA-MM": { idDaLinha: minutos } },      // horas de sobreaviso do mês
//     vacations: [{ id, start, days, sellDays, advance13 }],  // férias
//     absences: [{ id, ym, kind: 'atestado'|'inss'|'falta', days, note }],
//     budgets: { idCategoria: centavos },                     // orçamento mensal por categoria
//     reminders: { enabled, daysBefore, mode: 'each'|'daily'|'weekly', push },
//     rules: [{ id, pattern, categoryId, subcategoryId }],    // categorização automática
//     spendingLimitCents,                                      // meta (limite) de gastos mensal
//     investing: { cdiBp, ipcaBp, selicBp, monthlyTargetCents, targets: { classe: % }, ratesUpdatedAt },
//     indices: { ipca12Bp, igpm12Bp, ipcaMonthly: { "AAAA-MM": bp }, igpmMonthly, updatedAt }, // BCB
//     quotes: { TICKER: { price (centavos), at } },           // cotações (brapi)
//     shiftTypes: [{ id, name, hours, cents, payroll, night, weekend }], // tipos de plantão
//     benefits: [{ id, kind: 'va'|'vr'|'plr'|'abono'|'outro', name, cents, month, monthly }],
//     jobs: [{ id, name, kind: 'clt'|'pj'|'servidor'|'autonomo', grossCents, regime, fixedRateBp, pjTaxBp, day, from, to }],
//     fgts: { balanceCents, date },                            // saldo do FGTS informado
//     taxTables: { "2027": tabela },                            // tabelas de INSS/IR adicionadas por você
//     irpf: { otherDeductibleCents, educationCents, pensionCents, dependents },
//     rule503020: { needs, wants, savings, enabled },
//     envelopes: [{ id, name, icon, monthlyCents, categoryIds, rollover }],
//     scenarios: [{ id, name, scenario, createdAt }],          // simulações salvas
//     savedSearches: [{ id, name, query }],
//     dashboard: { order: [ids], hidden: [ids], pinned: [ids] },
//     tabbar: [ids],                                            // atalhos da barra do celular
//     onboardingSteps: { salary, bills, card, goal, cloud },
//     help: { dismissed: [ids] },
//     lastSeenVersion,                                          // para a tela "Novidades"
//     salaryAccountId,                                          // conta onde o salário cai
//   },
//   importFingerprints: [ "data|valor|descrição" ],              // evita importar 2× o mesmo extrato
//   investments:  [{ id, name, type, institution, rate: { kind, bp }, liquidity, maturity, emergency, notes,
//                    ticker, quantity, avgPriceCents,
//                    movements: [{ id, date, kind: 'aporte'|'resgate'|'provento'|'saldo'|'venda', cents, qty, note, expenseId }] }],
//   extraIncomes: [{ id, ym, description, cents, date, payroll, kind, accountId }],  // plantões, freelas, reembolsos…
//   expenses:     [{ id, description, cents, dueDate, paidAt, categoryId, subcategoryId, creditorId, notes,
//                    accountId, tags, splits: [{ categoryId, subcategoryId, cents }], attachments: [{ id, name, type, size }], boleto, pix }],
//   recurring:    [{ id, description, cents, dueDay, startYM, endYM, categoryId, subcategoryId, creditorId, notes,
//                    freq, anchorDate, variable, subscription, renewal, adjust: { index, month, lastYM }, priceHistory, accountId, cardId, tags }],
//   recurringEntries: { "idRecorrente|AAAA-MM" ou "idRecorrente|AAAA-MM-DD": { paidAt, cents, skipped } },
//   installments: [{ id, description, totalCents, count, firstDueDate, dueDay, paid: [nºs pagos], paidOn: { n: data },
//                    categoryId, subcategoryId, creditorId, notes, tags }],
//   cards:        [{ id, name, closingDay, dueDay, limitCents, color, accountId, archived }],
//   cardPurchases:[{ id, cardId, description, date, cents, count, categoryId, subcategoryId, tags, notes }],
//   cardInvoices: { "idCartão|AAAA-MM": { paidAt, cents } },   // pagamento da fatura
//   accounts:     [{ id, name, kind, institution, color, anchor: { cents, date }, archived }],
//   transfers:    [{ id, fromId, toId, cents, date, note }],
//   balanceChecks:[{ id, accountId, date, cents }],             // saldo real informado (banco)
//   shifts:       [{ id, date, typeId, note, cents }],          // escala de plantões
//   receivables:  [{ id, creditorId, person, description, cents, date, dueDate, receivedAt, notes }],
//   debts:        [{ id, name, creditorId, balanceCents, rateMonthlyBp, paymentCents, notes }],
//   wishlist:     [{ id, name, targetPriceCents, currentPriceCents, url, goalId, priority, boughtAt }],
//   goals:        [{ id, description, targetCents, deadline, icon, emergency, investmentIds, contributions: [{ id, date, cents }] }],
//   creditors:    [{ id, name, notes }],
//   categories:   [{ id, name, icon, color, group: 'needs'|'wants'|'savings', subcategories: [{ id, name }] }],
//   closedMonths: { "AAAA-MM": snapshot },                       // fotografia do mês fechado
//   scoreHistory: { "AAAA-MM": pontuação },                      // nota de saúde no fechamento
// }
//
// Histórico de versões do formato (migração em sanitizeState):
//   1 → salário líquido · 2 → perfil bruto · 3 → consignados próprios
//   4–6 → férias, afastamentos, investimentos · 7 → regras/orçamentos
//   8 → cartões, contas, plantões, dívidas…; data REAL do pagamento das
//       parcelas; reserva de emergência só por marcação (não pelo nome);
//       cores de categoria que conflitavam com as cores de estado.
// =============================================================

import { DEFAULT_CATEGORIES, CATEGORY_COLORS, LEGACY_STATE_COLORS, groupOfCategory } from './defaults.js';
import { isValidISO, isValidYM } from '../core/dates.js';
import { INVEST_TYPES, RATE_KINDS, LIQUIDITY, MOVEMENT_KINDS, CLASS_KEYS, DEFAULT_INVESTING } from './investments.js';

export const SCHEMA_VERSION = 8;

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 13).replace('-', '');
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createDefaultCategories() {
  return DEFAULT_CATEGORIES.map((cat, i) => ({
    id: newId(),
    name: cat.name,
    icon: cat.icon,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    group: cat.group || 'needs',
    subcategories: cat.subcategories.map((name) => ({ id: newId(), name })),
  }));
}

export const DEFAULT_SHIFT_TYPES = [
  { id: 'plantao12', name: 'Plantão 12h', hours: 12, cents: 0, payroll: true, night: false, weekend: false },
  { id: 'plantao24', name: 'Plantão 24h', hours: 24, cents: 0, payroll: true, night: false, weekend: false },
  { id: 'noturno12', name: 'Plantão noturno 12h', hours: 12, cents: 0, payroll: true, night: true, weekend: false },
  { id: 'fds12', name: 'Plantão fim de semana 12h', hours: 12, cents: 0, payroll: true, night: false, weekend: true },
];

export function createEmptyState() {
  const now = new Date().toISOString();
  return {
    schema: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    lastBackupAt: null,
    onboarded: false,
    settings: {
      profileName: '',
      salaryDay: 5,
      payday: { mode: 'fixed', nth: 5, saturday: true, nextMonth: false },
      salaryHistory: [],
      payrollLoans: [],
      payrollVariable: [],
      employment: { admission: null, regime: 'inss', fixedRateBp: 1400, thirteenth: true, hoursDivisor: 220, familyChildren: 0 },
      actualNet: {},
      onCallHours: {},
      vacations: [],
      absences: [],
      budgets: {},
      reminders: { enabled: false, daysBefore: 1, mode: 'daily', push: false },
      rules: [],
      spendingLimitCents: 0,
      investing: structuredClone(DEFAULT_INVESTING),
      indices: { ipca12Bp: 450, igpm12Bp: 400, ipcaMonthly: {}, igpmMonthly: {}, updatedAt: null },
      quotes: {},
      shiftTypes: structuredClone(DEFAULT_SHIFT_TYPES),
      benefits: [],
      jobs: [],
      fgts: { balanceCents: 0, date: null },
      taxTables: {},
      irpf: { otherDeductibleCents: 0, educationCents: 0, pensionCents: 0 },
      rule503020: { enabled: false, needs: 50, wants: 30, savings: 20 },
      envelopes: [],
      scenarios: [],
      savedSearches: [],
      dashboard: { order: [], hidden: [], pinned: [] },
      tabbar: ['painel', 'agenda', 'contas'],
      onboardingSteps: {},
      help: { dismissed: [] },
      lastSeenVersion: null,
      salaryAccountId: null,
      theme: 'auto',
      accent: 'azul',
      density: 'comfortable',
      motion: 'full',
    },
    extraIncomes: [],
    expenses: [],
    recurring: [],
    recurringEntries: {},
    installments: [],
    cards: [],
    cardPurchases: [],
    cardInvoices: {},
    accounts: [],
    transfers: [],
    balanceChecks: [],
    shifts: [],
    receivables: [],
    debts: [],
    wishlist: [],
    goals: [],
    investments: [],
    creditors: [],
    categories: createDefaultCategories(),
    closedMonths: {},
    scoreHistory: {},
    importFingerprints: [],
  };
}

// ---------- Validação de backup importado ----------

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const optId = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const cents = (v, { zero = false, neg = false } = {}) => isInt(v) && (neg || (zero ? v >= 0 : v > 0)) && Math.abs(v) <= 10_000_000_000;
const day = (v, def = 1) => (isInt(v) && v >= 1 && v <= 31 ? v : def);
const color = (v, def) => (/^#[0-9a-f]{6}$/i.test(v) ? v : def);
const tags = (v) => [...new Set(arr(v).filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 30)).filter(Boolean))].slice(0, 12);
const pick = (v, list, def) => (list.includes(v) ? v : def);

export const FREQS = ['monthly', 'weekly', 'biweekly', 'bimonthly', 'quarterly', 'semiannual', 'annual'];
export const INCOME_KINDS = ['extra', 'plantao', 'reembolso', 'venda', 'presente', 'rendimento', 'freela', 'outro'];
export const ACCOUNT_KINDS = ['corrente', 'salario', 'poupanca', 'digital', 'carteira', 'investimento', 'outro'];

/**
 * Recebe um JSON qualquer (ex.: backup importado) e devolve
 * um estado limpo e válido. Itens inválidos são descartados.
 * Lança erro se o arquivo claramente não é um backup do app.
 */
export function sanitizeState(raw) {
  if (!isObj(raw) || !isObj(raw.settings) || !Array.isArray(raw.expenses)) {
    throw new Error('Arquivo não reconhecido como backup do Dhenors.');
  }
  if (raw.schema > SCHEMA_VERSION) {
    throw new Error('Backup criado por uma versão mais nova do app.');
  }
  const fromSchema = isInt(raw.schema) ? raw.schema : 1;

  const base = createEmptyState();
  const s = raw.settings;

  const state = {
    ...base,
    createdAt: str(raw.createdAt, 40) || base.createdAt,
    updatedAt: str(raw.updatedAt, 40) || base.updatedAt,
    lastBackupAt: str(raw.lastBackupAt, 40) || null,
    onboarded: true,
    settings: {
      ...base.settings,
      profileName: str(s.profileName, 60),
      salaryDay: isInt(s.salaryDay) && s.salaryDay >= 1 && s.salaryDay <= 31 ? s.salaryDay : 5,
      payday: {
        mode: isObj(s.payday) && s.payday.mode === 'business' ? 'business' : 'fixed',
        nth: isObj(s.payday) && isInt(s.payday.nth) && s.payday.nth >= 1 && s.payday.nth <= 10 ? s.payday.nth : 5,
        saturday: !(isObj(s.payday) && s.payday.saturday === false),
        nextMonth: isObj(s.payday) && s.payday.nextMonth === true,
      },
      salaryHistory: arr(s.salaryHistory)
        .map(sanitizeProfile).filter(Boolean)
        .sort((a, b) => a.from.localeCompare(b.from)),
      payrollLoans: [],
      payrollVariable: arr(s.payrollVariable).map(sanitizeVariable).filter(Boolean),
      employment: sanitizeEmployment(s.employment),
      actualNet: sanitizeActual(s.actualNet),
      onCallHours: sanitizeOnCall(s.onCallHours),
      vacations: arr(s.vacations).map(sanitizeVacation).filter(Boolean),
      absences: arr(s.absences)
        .filter((a) => isObj(a) && isValidYM(a.ym) && isInt(a.days) && a.days >= 1 && a.days <= 30)
        .map((a) => ({ id: optId(a.id) || newId(), ym: a.ym, kind: ['atestado', 'inss', 'falta'].includes(a.kind) ? a.kind : 'atestado', days: a.days, note: str(a.note, 80) })),
      budgets: sanitizeActual(s.budgets, true),
      reminders: {
        enabled: isObj(s.reminders) && s.reminders.enabled === true,
        daysBefore: isObj(s.reminders) && isInt(s.reminders.daysBefore) && s.reminders.daysBefore >= 0 && s.reminders.daysBefore <= 7 ? s.reminders.daysBefore : 1,
        mode: pick(s.reminders?.mode, ['each', 'daily', 'weekly'], 'daily'),
        push: s.reminders?.push === true,
      },
      rules: arr(s.rules).filter((r) => isObj(r) && str(r.pattern, 60).trim()).slice(0, 500)
        .map((r) => ({ id: optId(r.id) || newId(), pattern: str(r.pattern, 60).trim(), categoryId: optId(r.categoryId), subcategoryId: optId(r.subcategoryId) })),
      spendingLimitCents: isInt(s.spendingLimitCents) && s.spendingLimitCents >= 0 ? s.spendingLimitCents : 0,
      investing: sanitizeInvesting(s.investing),
      indices: sanitizeIndices(s.indices),
      quotes: sanitizeQuotes(s.quotes),
      shiftTypes: Array.isArray(s.shiftTypes) ? s.shiftTypes.map(sanitizeShiftType).filter(Boolean).slice(0, 30) : structuredClone(DEFAULT_SHIFT_TYPES),
      benefits: arr(s.benefits).map(sanitizeBenefit).filter(Boolean).slice(0, 30),
      jobs: arr(s.jobs).map(sanitizeJob).filter(Boolean).slice(0, 10),
      fgts: { balanceCents: cents(s.fgts?.balanceCents, { zero: true }) ? s.fgts.balanceCents : 0, date: isValidISO(s.fgts?.date) ? s.fgts.date : null },
      taxTables: sanitizeTaxTables(s.taxTables),
      irpf: {
        otherDeductibleCents: cents(s.irpf?.otherDeductibleCents, { zero: true }) ? s.irpf.otherDeductibleCents : 0,
        educationCents: cents(s.irpf?.educationCents, { zero: true }) ? s.irpf.educationCents : 0,
        pensionCents: cents(s.irpf?.pensionCents, { zero: true }) ? s.irpf.pensionCents : 0,
      },
      rule503020: sanitizeRule(s.rule503020),
      envelopes: arr(s.envelopes).filter((e) => isObj(e) && str(e.name)).slice(0, 30)
        .map((e) => ({ id: optId(e.id) || newId(), name: str(e.name, 40), icon: str(e.icon, 24) || '🫙', monthlyCents: cents(e.monthlyCents, { zero: true }) ? e.monthlyCents : 0, categoryIds: arr(e.categoryIds).map(optId).filter(Boolean), rollover: e.rollover !== false })),
      scenarios: arr(s.scenarios).filter((x) => isObj(x) && str(x.name) && isObj(x.scenario)).slice(0, 30)
        .map((x) => ({ id: optId(x.id) || newId(), name: str(x.name, 60), scenario: x.scenario, createdAt: str(x.createdAt, 40) })),
      savedSearches: arr(s.savedSearches).filter((x) => isObj(x) && str(x.name) && isObj(x.query)).slice(0, 30)
        .map((x) => ({ id: optId(x.id) || newId(), name: str(x.name, 60), query: x.query })),
      dashboard: {
        order: arr(s.dashboard?.order).filter((x) => typeof x === 'string').slice(0, 40),
        hidden: arr(s.dashboard?.hidden).filter((x) => typeof x === 'string').slice(0, 40),
        pinned: arr(s.dashboard?.pinned).filter((x) => typeof x === 'string').slice(0, 40),
      },
      tabbar: arr(s.tabbar).filter((x) => typeof x === 'string').slice(0, 4).length ? arr(s.tabbar).filter((x) => typeof x === 'string').slice(0, 4) : base.settings.tabbar,
      onboardingSteps: isObj(s.onboardingSteps) ? Object.fromEntries(Object.entries(s.onboardingSteps).filter(([, v]) => typeof v === 'boolean')) : {},
      help: { dismissed: arr(s.help?.dismissed).filter((x) => typeof x === 'string').slice(0, 100) },
      lastSeenVersion: str(s.lastSeenVersion, 20) || null,
      salaryAccountId: optId(s.salaryAccountId),
      theme: ['auto', 'light', 'dark', 'oled'].includes(s.theme) ? s.theme : 'auto',
      accent: pick(s.accent, ['azul', 'verde', 'roxo', 'laranja', 'rosa'], 'azul'),
      density: pick(s.density, ['comfortable', 'compact'], 'comfortable'),
      motion: pick(s.motion, ['full', 'calm', 'off'], 'full'),
    },
  };

  // Descontos parcelados: lista própria. No formato antigo ficavam dentro dos perfis.
  const loans = new Map();
  for (const l of arr(s.payrollLoans)) {
    const clean = sanitizeDeduction(l);
    if (clean?.loan) loans.set(clean.id, clean);
  }
  for (const profile of state.settings.salaryHistory) {
    for (const d of profile.deductions) if (d.loan && !loans.has(d.id)) loans.set(d.id, d);
    profile.deductions = profile.deductions.filter((d) => !d.loan);
  }
  state.settings.payrollLoans = [...loans.values()];

  const common = (x) => ({
    categoryId: optId(x.categoryId),
    subcategoryId: optId(x.subcategoryId),
    creditorId: optId(x.creditorId),
    notes: str(x.notes, 500),
    tags: tags(x.tags),
  });

  state.extraIncomes = arr(raw.extraIncomes)
    .filter((x) => isObj(x) && isValidYM(x.ym) && isInt(x.cents) && x.cents > 0)
    // Na versão 1 as rendas extras eram líquidas (payroll = false)
    .map((x) => ({
      id: optId(x.id) || newId(), ym: x.ym, description: str(x.description, 120) || 'Renda extra', cents: x.cents,
      date: isValidISO(x.date) ? x.date : null, payroll: x.payroll === true,
      kind: pick(x.kind, INCOME_KINDS, x.payroll ? 'plantao' : 'extra'), accountId: optId(x.accountId),
    }));

  state.expenses = raw.expenses
    .filter((x) => isObj(x) && isInt(x.cents) && x.cents > 0 && isValidISO(x.dueDate))
    .map((x) => ({
      id: optId(x.id) || newId(), description: str(x.description, 120) || 'Despesa', cents: x.cents, dueDate: x.dueDate,
      paidAt: isValidISO(x.paidAt) ? x.paidAt : null, ...common(x), accountId: optId(x.accountId),
      splits: sanitizeSplits(x.splits, x.cents),
      attachments: arr(x.attachments).filter((a) => isObj(a) && optId(a.id)).slice(0, 10)
        .map((a) => ({ id: optId(a.id), name: str(a.name, 120) || 'anexo', type: str(a.type, 80), size: isInt(a.size) ? a.size : 0 })),
      ...(isObj(x.boleto) ? { boleto: { line: str(x.boleto.line, 60).replace(/\D/g, ''), bank: str(x.boleto.bank, 40) } } : {}),
      ...(isObj(x.pix) ? { pix: { key: str(x.pix.key, 120), name: str(x.pix.name, 60), city: str(x.pix.city, 40) } } : {}),
      ...(x.cardInvoice ? { cardInvoice: str(x.cardInvoice, 60) } : {}),
    }));

  state.recurring = arr(raw.recurring)
    .filter((x) => isObj(x) && isInt(x.cents) && x.cents > 0 && isInt(x.dueDay) && isValidYM(x.startYM))
    .map((x) => ({
      id: optId(x.id) || newId(), description: str(x.description, 120) || 'Recorrente', cents: x.cents,
      dueDay: Math.min(31, Math.max(1, x.dueDay)), startYM: x.startYM, endYM: isValidYM(x.endYM) ? x.endYM : null, ...common(x),
      freq: pick(x.freq, FREQS, 'monthly'),
      anchorDate: isValidISO(x.anchorDate) ? x.anchorDate : null,
      variable: x.variable === true,
      subscription: x.subscription === true,
      renewal: isValidISO(x.renewal) ? x.renewal : null,
      adjust: isObj(x.adjust) && ['ipca', 'igpm', 'fixo'].includes(x.adjust.index)
        ? { index: x.adjust.index, month: isInt(x.adjust.month) && x.adjust.month >= 1 && x.adjust.month <= 12 ? x.adjust.month : 1, pctBp: isInt(x.adjust.pctBp) ? x.adjust.pctBp : 0, lastYM: isValidYM(x.adjust.lastYM) ? x.adjust.lastYM : null }
        : null,
      priceHistory: arr(x.priceHistory).filter((p) => isObj(p) && isValidISO(p.date) && cents(p.cents)).slice(-50).map((p) => ({ date: p.date, cents: p.cents })),
      accountId: optId(x.accountId),
      cardId: optId(x.cardId),
    }));

  state.recurringEntries = {};
  if (isObj(raw.recurringEntries)) {
    for (const [key, e] of Object.entries(raw.recurringEntries)) {
      if (!isObj(e) || !/^[\w-]+\|\d{4}-\d{2}(-\d{2})?$/.test(key)) continue;
      state.recurringEntries[key] = {
        paidAt: isValidISO(e.paidAt) ? e.paidAt : null,
        cents: isInt(e.cents) && e.cents > 0 ? e.cents : null,
        skipped: e.skipped === true,
      };
    }
  }

  state.installments = arr(raw.installments)
    .filter((x) => isObj(x) && isInt(x.totalCents) && x.totalCents > 0 && isInt(x.count) && x.count >= 1 && isValidISO(x.firstDueDate))
    .map((x) => {
      const paid = [...new Set(arr(x.paid).filter((n) => isInt(n) && n >= 1 && n <= x.count))].sort((a, b) => a - b);
      const paidOn = {};
      if (isObj(x.paidOn)) for (const [n, d] of Object.entries(x.paidOn)) if (paid.includes(Number(n)) && isValidISO(d)) paidOn[n] = d;
      return {
        id: optId(x.id) || newId(), description: str(x.description, 120) || 'Parcelamento',
        totalCents: x.totalCents, count: Math.min(x.count, 420), firstDueDate: x.firstDueDate,
        dueDay: isInt(x.dueDay) && x.dueDay >= 1 && x.dueDay <= 31 ? x.dueDay : +x.firstDueDate.slice(8),
        paid, paidOn,
        ...common(x),
      };
    });

  state.cards = arr(raw.cards).filter((c) => isObj(c) && str(c.name)).map((c) => ({
    id: optId(c.id) || newId(), name: str(c.name, 60), closingDay: day(c.closingDay, 1), dueDay: day(c.dueDay, 10),
    limitCents: cents(c.limitCents, { zero: true }) ? c.limitCents : 0, color: color(c.color, '#7C3AED'),
    accountId: optId(c.accountId), archived: c.archived === true,
  }));
  const cardIds = new Set(state.cards.map((c) => c.id));
  state.cardPurchases = arr(raw.cardPurchases)
    .filter((p) => isObj(p) && cardIds.has(p.cardId) && isValidISO(p.date) && cents(p.cents, { neg: true }) && p.cents !== 0)
    .map((p) => ({
      id: optId(p.id) || newId(), cardId: p.cardId, description: str(p.description, 120) || 'Compra', date: p.date, cents: p.cents,
      count: isInt(p.count) && p.count >= 1 && p.count <= 48 ? p.count : 1,
      categoryId: optId(p.categoryId), subcategoryId: optId(p.subcategoryId), tags: tags(p.tags), notes: str(p.notes, 500),
      splits: sanitizeSplits(p.splits, Math.abs(p.cents)),
    }));
  state.cardInvoices = {};
  if (isObj(raw.cardInvoices)) {
    for (const [k, v] of Object.entries(raw.cardInvoices)) {
      if (!isObj(v) || !/^[\w-]+\|\d{4}-\d{2}$/.test(k) || !cardIds.has(k.split('|')[0])) continue;
      state.cardInvoices[k] = { paidAt: isValidISO(v.paidAt) ? v.paidAt : null, cents: cents(v.cents) ? v.cents : null };
    }
  }

  state.accounts = arr(raw.accounts).filter((a) => isObj(a) && str(a.name)).map((a) => ({
    id: optId(a.id) || newId(), name: str(a.name, 60), kind: pick(a.kind, ACCOUNT_KINDS, 'corrente'), institution: str(a.institution, 60),
    color: color(a.color, '#0891B2'),
    anchor: { cents: cents(a.anchor?.cents, { neg: true }) ? a.anchor.cents : 0, date: isValidISO(a.anchor?.date) ? a.anchor.date : null },
    archived: a.archived === true,
  }));
  const accIds = new Set(state.accounts.map((a) => a.id));
  if (!accIds.has(state.settings.salaryAccountId)) state.settings.salaryAccountId = null;
  state.transfers = arr(raw.transfers).filter((t) => isObj(t) && accIds.has(t.fromId) && accIds.has(t.toId) && t.fromId !== t.toId && cents(t.cents) && isValidISO(t.date))
    .map((t) => ({ id: optId(t.id) || newId(), fromId: t.fromId, toId: t.toId, cents: t.cents, date: t.date, note: str(t.note, 120) }));
  state.balanceChecks = arr(raw.balanceChecks).filter((b) => isObj(b) && accIds.has(b.accountId) && isValidISO(b.date) && cents(b.cents, { neg: true }))
    .map((b) => ({ id: optId(b.id) || newId(), accountId: b.accountId, date: b.date, cents: b.cents })).slice(-500);

  const shiftTypeIds = new Set(state.settings.shiftTypes.map((t) => t.id));
  state.shifts = arr(raw.shifts).filter((x) => isObj(x) && isValidISO(x.date) && shiftTypeIds.has(x.typeId))
    .map((x) => ({ id: optId(x.id) || newId(), date: x.date, typeId: x.typeId, note: str(x.note, 80), ...(cents(x.cents) ? { cents: x.cents } : {}) }));

  state.receivables = arr(raw.receivables).filter((x) => isObj(x) && cents(x.cents) && isValidISO(x.date))
    .map((x) => ({
      id: optId(x.id) || newId(), creditorId: optId(x.creditorId), person: str(x.person, 80), description: str(x.description, 120) || 'Empréstimo',
      cents: x.cents, date: x.date, dueDate: isValidISO(x.dueDate) ? x.dueDate : null, receivedAt: isValidISO(x.receivedAt) ? x.receivedAt : null,
      partials: arr(x.partials).filter((p) => isObj(p) && cents(p.cents) && isValidISO(p.date)).map((p) => ({ id: optId(p.id) || newId(), date: p.date, cents: p.cents })),
      notes: str(x.notes, 500),
    }));

  state.debts = arr(raw.debts).filter((x) => isObj(x) && str(x.name) && cents(x.balanceCents, { zero: true }))
    .map((x) => ({
      id: optId(x.id) || newId(), name: str(x.name, 80), creditorId: optId(x.creditorId), balanceCents: x.balanceCents,
      rateMonthlyBp: isInt(x.rateMonthlyBp) && x.rateMonthlyBp >= 0 && x.rateMonthlyBp <= 5000 ? x.rateMonthlyBp : 0,
      paymentCents: cents(x.paymentCents, { zero: true }) ? x.paymentCents : 0, notes: str(x.notes, 500),
      installmentId: optId(x.installmentId),
    }));

  state.wishlist = arr(raw.wishlist).filter((x) => isObj(x) && str(x.name))
    .map((x) => ({
      id: optId(x.id) || newId(), name: str(x.name, 80), targetPriceCents: cents(x.targetPriceCents, { zero: true }) ? x.targetPriceCents : 0,
      currentPriceCents: cents(x.currentPriceCents, { zero: true }) ? x.currentPriceCents : 0, url: /^https?:\/\//.test(x.url) ? str(x.url, 300) : '',
      goalId: optId(x.goalId), priority: pick(x.priority, ['alta', 'media', 'baixa'], 'media'), boughtAt: isValidISO(x.boughtAt) ? x.boughtAt : null,
      priceHistory: arr(x.priceHistory).filter((p) => isObj(p) && isValidISO(p.date) && cents(p.cents)).slice(-30).map((p) => ({ date: p.date, cents: p.cents })),
    }));

  state.goals = arr(raw.goals)
    .filter((x) => isObj(x) && isInt(x.targetCents) && x.targetCents > 0)
    .map((x) => ({
      id: optId(x.id) || newId(), description: str(x.description, 120) || 'Meta', targetCents: x.targetCents,
      deadline: isValidISO(x.deadline) ? x.deadline : null, icon: str(x.icon, 24) || '🎯',
      // No formato antigo a reserva era reconhecida pelo NOME. Agora vale só a marcação;
      // na migração, metas antigas com "reserva"/"emergência" no nome ganham a marcação uma vez.
      emergency: x.emergency === true || (fromSchema < 8 && /reserva|emerg/i.test(x.description || '')),
      investmentIds: arr(x.investmentIds).map(optId).filter(Boolean),
      contributions: arr(x.contributions).filter((c) => isObj(c) && isInt(c.cents) && isValidISO(c.date))
        .map((c) => ({ id: optId(c.id) || newId(), date: c.date, cents: c.cents })),
    }));

  state.investments = arr(raw.investments).map(sanitizeInvestment).filter(Boolean);
  const invIds = new Set(state.investments.map((i) => i.id));
  for (const g of state.goals) g.investmentIds = g.investmentIds.filter((id) => invIds.has(id));

  state.creditors = arr(raw.creditors)
    .filter((x) => isObj(x) && str(x.name))
    .map((x) => ({ id: optId(x.id) || newId(), name: str(x.name, 80), notes: str(x.notes, 500) }));

  if (Array.isArray(raw.categories) && raw.categories.length) {
    state.categories = raw.categories
      .filter((c) => isObj(c) && str(c.name))
      .map((c, i) => {
        let col = color(c.color, CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
        // Formato antigo: cores de categoria que imitavam as cores de estado (atraso/vence logo) são trocadas
        if (fromSchema < 8 && LEGACY_STATE_COLORS.includes(col.toUpperCase())) col = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
        return {
          id: optId(c.id) || newId(), name: str(c.name, 60), icon: str(c.icon, 24) || '🏷️', color: col,
          group: pick(c.group, ['needs', 'wants', 'savings'], groupOfCategory(c.name)),
          subcategories: arr(c.subcategories).filter((sc) => isObj(sc) && str(sc.name))
            .map((sc) => ({ id: optId(sc.id) || newId(), name: str(sc.name, 60) })),
        };
      });
  }

  state.importFingerprints = arr(raw.importFingerprints)
    .filter((f) => typeof f === 'string' && f.length < 200).slice(-5000);

  state.closedMonths = {};
  if (isObj(raw.closedMonths)) {
    for (const [ym, snap] of Object.entries(raw.closedMonths)) {
      if (isValidYM(ym) && isValidSnapshot(snap)) state.closedMonths[ym] = snap;
    }
  }
  state.scoreHistory = {};
  if (isObj(raw.scoreHistory)) {
    for (const [ym, v] of Object.entries(raw.scoreHistory)) if (isValidYM(ym) && isInt(v) && v >= 0 && v <= 100) state.scoreHistory[ym] = v;
  }

  return state;
}

/**
 * Perfil salarial limpo. Aceita o formato antigo ({ from, cents },
 * salário já LÍQUIDO), que vira um perfil `legacyNet` sem cálculo de impostos.
 */
export function sanitizeProfile(h) {
  if (!isObj(h) || !isValidYM(h.from)) return null;
  if (!('grossCents' in h)) {
    return isInt(h.cents) && h.cents >= 0
      ? { from: h.from, grossCents: h.cents, dependents: 0, additions: [], deductions: [], legacyNet: true }
      : null;
  }
  if (!isInt(h.grossCents) || h.grossCents < 0) return null;
  const mode = (m) => (m === 'percent' ? 'percent' : 'fixed');
  const value = (x) => isInt(x.value) && x.value > 0 && x.value <= (x.mode === 'percent' ? 100000 : 1_000_000_000);
  const addition = (a) => (a.mode === 'hours'
    ? hoursLine(a)
    : { id: optId(a.id) || newId(), description: str(a.description, 60) || 'Adicional', mode: mode(a.mode), value: a.value, base: a.base === 'minimum' ? 'minimum' : 'salary', taxable: a.taxable !== false });
  return {
    from: h.from,
    grossCents: h.grossCents,
    dependents: isInt(h.dependents) && h.dependents >= 0 && h.dependents <= 20 ? h.dependents : 0,
    additions: arr(h.additions).filter((a) => isObj(a) && value(a)).slice(0, 20).map(addition),
    deductions: arr(h.deductions).filter((d) => isObj(d) && value(d)).slice(0, 20).map(sanitizeDeduction).filter(Boolean),
    ...(h.legacyNet === true ? { legacyNet: true } : {}),
    ...(str(h.note, 120) ? { note: str(h.note, 120) } : {}),
  };
}

/** Adicional por horas (value = minutos). */
function hoursLine(a) {
  const hourKind = ['he50', 'he100', 'sobreaviso', 'noturno', 'custom'].includes(a.hourKind) ? a.hourKind : 'custom';
  return {
    id: optId(a.id) || newId(), description: str(a.description, 60) || 'Horas', mode: 'hours', value: a.value, hourKind,
    ...(hourKind === 'custom' ? { hourPct: isInt(a.hourPct) && a.hourPct > 0 && a.hourPct <= 100000 ? a.hourPct : 10000 } : {}),
    dsr: a.dsr === true, taxable: a.taxable !== false,
  };
}

/** Linha variável (só vale no mês `ym`). */
function sanitizeVariable(v) {
  if (!isObj(v) || !isValidYM(v.ym) || !['add', 'ded'].includes(v.kind)) return null;
  if (v.kind === 'add' && v.mode === 'hours') {
    return isInt(v.value) && v.value > 0 && v.value <= 744 * 60 ? { ...hoursLine(v), kind: 'add', ym: v.ym } : null;
  }
  if (!isInt(v.value) || v.value <= 0 || v.value > (v.mode === 'percent' ? 100000 : 1_000_000_000)) return null;
  const line = { id: optId(v.id) || newId(), kind: v.kind, ym: v.ym, description: str(v.description, 60) || (v.kind === 'add' ? 'Adicional' : 'Desconto'), mode: v.mode === 'percent' ? 'percent' : 'fixed', value: v.value };
  return v.kind === 'add'
    ? { ...line, base: v.base === 'minimum' ? 'minimum' : 'salary', taxable: v.taxable !== false }
    : { ...line, base: v.base === 'gross' ? 'gross' : 'salary', irDeductible: v.irDeductible === true };
}

function sanitizeEmployment(e) {
  const o = isObj(e) ? e : {};
  return {
    admission: isValidISO(o.admission) ? o.admission : null,
    regime: o.regime === 'fixed' ? 'fixed' : 'inss',
    fixedRateBp: isInt(o.fixedRateBp) && o.fixedRateBp > 0 && o.fixedRateBp <= 5000 ? o.fixedRateBp : 1400,
    thirteenth: o.thirteenth !== false,
    hoursDivisor: isInt(o.hoursDivisor) && o.hoursDivisor >= 100 && o.hoursDivisor <= 300 ? o.hoursDivisor : 220,
    familyChildren: isInt(o.familyChildren) && o.familyChildren >= 0 && o.familyChildren <= 20 ? o.familyChildren : 0,
  };
}

/** { "AAAA-MM": centavos } — ou, com anyKey, { id: centavos } (orçamentos). */
/** { "AAAA-MM": { id: minutos } } — até 744 h (31 dias) por linha */
function sanitizeOnCall(a) {
  const out = {};
  if (!isObj(a)) return out;
  for (const [ym, lines] of Object.entries(a)) {
    if (!isValidYM(ym) || !isObj(lines)) continue;
    const clean = {};
    for (const [id, min] of Object.entries(lines)) if (/^[\w-]{1,40}$/.test(id) && isInt(min) && min >= 0 && min <= 744 * 60) clean[id] = min;
    if (Object.keys(clean).length) out[ym] = clean;
  }
  return out;
}

function sanitizeActual(a, anyKey = false) {
  const out = {};
  if (isObj(a)) {
    for (const [k, v] of Object.entries(a)) {
      if ((anyKey ? /^[\w-]{1,40}$/.test(k) : isValidYM(k)) && isInt(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

function sanitizeInvesting(v) {
  const o = isObj(v) ? v : {};
  const bp = (x, def, max) => (isInt(x) && x >= 0 && x <= max ? x : def);
  const targets = {};
  if (isObj(o.targets)) {
    for (const k of CLASS_KEYS) if (isInt(o.targets[k]) && o.targets[k] > 0 && o.targets[k] <= 100) targets[k] = o.targets[k];
  }
  return {
    cdiBp: bp(o.cdiBp, DEFAULT_INVESTING.cdiBp, 10000),
    ipcaBp: bp(o.ipcaBp, DEFAULT_INVESTING.ipcaBp, 10000),
    selicBp: bp(o.selicBp, DEFAULT_INVESTING.selicBp, 10000),
    monthlyTargetCents: bp(o.monthlyTargetCents, 0, 1_000_000_000),
    targets: Object.values(targets).reduce((a, n) => a + n, 0) === 100 ? targets : {},
    ratesUpdatedAt: str(o.ratesUpdatedAt, 40) || null,
    fi: isObj(o.fi) ? { age: bp(o.fi.age, 30, 120), targetAge: bp(o.fi.targetAge, 60, 120), monthlyCostCents: bp(o.fi.monthlyCostCents, 0, 1_000_000_000), withdrawalBp: bp(o.fi.withdrawalBp, 400, 2000) } : null,
  };
}

function sanitizeIndices(v) {
  const o = isObj(v) ? v : {};
  const monthly = (m) => {
    const out = {};
    if (isObj(m)) for (const [k, x] of Object.entries(m)) if (isValidYM(k) && isInt(x) && Math.abs(x) <= 10000) out[k] = x;
    return out;
  };
  return {
    ipca12Bp: isInt(o.ipca12Bp) ? o.ipca12Bp : 450,
    igpm12Bp: isInt(o.igpm12Bp) ? o.igpm12Bp : 400,
    ipcaMonthly: monthly(o.ipcaMonthly),
    igpmMonthly: monthly(o.igpmMonthly),
    cdiMonthly: monthly(o.cdiMonthly),
    ibovMonthly: monthly(o.ibovMonthly),
    updatedAt: str(o.updatedAt, 40) || null,
  };
}

function sanitizeQuotes(q) {
  const out = {};
  if (isObj(q)) {
    for (const [k, v] of Object.entries(q)) {
      if (/^[A-Z0-9^.]{2,12}$/.test(k) && isObj(v) && isInt(v.price) && v.price >= 0) out[k] = { price: v.price, at: str(v.at, 40) };
    }
  }
  return out;
}

function sanitizeShiftType(t) {
  if (!isObj(t) || !str(t.name)) return null;
  return {
    id: optId(t.id) || newId(), name: str(t.name, 40), hours: isInt(t.hours) && t.hours > 0 && t.hours <= 48 ? t.hours : 12,
    cents: cents(t.cents, { zero: true }) ? t.cents : 0, payroll: t.payroll !== false, night: t.night === true, weekend: t.weekend === true,
    color: color(t.color, '#0D9488'),
  };
}

function sanitizeBenefit(b) {
  if (!isObj(b) || !str(b.name)) return null;
  return {
    id: optId(b.id) || newId(), kind: pick(b.kind, ['va', 'vr', 'plr', 'abono', 'outro'], 'outro'), name: str(b.name, 60),
    cents: cents(b.cents, { zero: true }) ? b.cents : 0, month: isInt(b.month) && b.month >= 1 && b.month <= 12 ? b.month : null,
    year: isInt(b.year) ? b.year : null, monthly: b.monthly === true,
  };
}

function sanitizeJob(j) {
  if (!isObj(j) || !str(j.name)) return null;
  return {
    id: optId(j.id) || newId(), name: str(j.name, 60), kind: pick(j.kind, ['clt', 'pj', 'servidor', 'autonomo'], 'clt'),
    grossCents: cents(j.grossCents, { zero: true }) ? j.grossCents : 0, regime: j.regime === 'fixed' ? 'fixed' : 'inss',
    fixedRateBp: isInt(j.fixedRateBp) && j.fixedRateBp >= 0 && j.fixedRateBp <= 5000 ? j.fixedRateBp : 1400,
    pjTaxBp: isInt(j.pjTaxBp) && j.pjTaxBp >= 0 && j.pjTaxBp <= 5000 ? j.pjTaxBp : 600,
    day: day(j.day, 5), from: isValidYM(j.from) ? j.from : null, to: isValidYM(j.to) ? j.to : null,
  };
}

function sanitizeTaxTables(t) {
  const out = {};
  if (!isObj(t)) return out;
  for (const [y, tb] of Object.entries(t)) {
    if (!/^\d{4}$/.test(y) || !isObj(tb)) continue;
    const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    const inss = arr(tb.inss).filter((r) => Array.isArray(r) && r.length === 2 && r.every(num));
    const irrf = arr(tb.irrf).filter((r) => Array.isArray(r) && r.length === 3 && (num(r[0]) || r[0] === null) && num(r[1]) && num(r[2]))
      .map((r) => [r[0] === null ? Infinity : r[0], r[1], r[2]]);
    if (!inss.length || !irrf.length || !num(tb.minimumWage)) continue;
    out[y] = {
      minimumWage: tb.minimumWage, inss, irrf,
      dependent: num(tb.dependent) ? tb.dependent : 189.59, simplified: num(tb.simplified) ? tb.simplified : 607.2,
      family: isObj(tb.family) && num(tb.family.quota) && num(tb.family.limit) ? { quota: tb.family.quota, limit: tb.family.limit } : null,
      reduction: isObj(tb.reduction) && ['fullUpTo', 'fullMax', 'partialUpTo', 'a', 'b'].every((k) => num(tb.reduction[k])) ? { ...tb.reduction } : null,
      custom: true,
    };
  }
  return out;
}

function sanitizeRule(r) {
  const o = isObj(r) ? r : {};
  const n = (x, d) => (isInt(x) && x >= 0 && x <= 100 ? x : d);
  const out = { enabled: o.enabled === true, needs: n(o.needs, 50), wants: n(o.wants, 30), savings: n(o.savings, 20) };
  if (out.needs + out.wants + out.savings !== 100) Object.assign(out, { needs: 50, wants: 30, savings: 20 });
  return out;
}

/** Divisão de um gasto entre categorias: só vale se somar exatamente o valor. */
function sanitizeSplits(splits, total) {
  const list = arr(splits).filter((x) => isObj(x) && cents(x.cents)).slice(0, 10)
    .map((x) => ({ categoryId: optId(x.categoryId), subcategoryId: optId(x.subcategoryId), cents: x.cents }));
  return list.length >= 2 && list.reduce((a, x) => a + x.cents, 0) === total ? list : [];
}

function sanitizeInvestment(x) {
  if (!isObj(x) || !str(x.name).trim()) return null;
  const type = INVEST_TYPES[x.type] ? x.type : 'outro';
  const r = isObj(x.rate) ? x.rate : {};
  const kind = RATE_KINDS[r.kind] ? r.kind : 'none';
  return {
    id: optId(x.id) || newId(),
    name: str(x.name, 80).trim(),
    type,
    institution: str(x.institution, 60),
    rate: { kind, bp: kind === 'none' || kind === 'poup' ? 0 : (isInt(r.bp) && r.bp >= 0 && r.bp <= 50000 ? r.bp : 0) },
    liquidity: LIQUIDITY[x.liquidity] ? x.liquidity : 'none',
    maturity: isValidISO(x.maturity) ? x.maturity : null,
    emergency: x.emergency === true,
    notes: str(x.notes, 500),
    ticker: /^[A-Z0-9]{4,8}$/.test(String(x.ticker || '').toUpperCase()) ? String(x.ticker).toUpperCase() : '',
    pension: pick(x.pension, ['pgbl', 'vgbl', ''], ''),
    movements: arr(x.movements)
      .filter((m) => isObj(m) && MOVEMENT_KINDS[m.kind] && isValidISO(m.date) && isInt(m.cents)
        && (m.kind === 'saldo' ? m.cents >= 0 : m.cents > 0) && m.cents <= 1_000_000_000)
      .slice(0, 5000)
      .map((m) => ({
        id: optId(m.id) || newId(), date: m.date, kind: m.kind, cents: m.cents, note: str(m.note, 120),
        ...(typeof m.qty === 'number' && Number.isFinite(m.qty) && m.qty > 0 ? { qty: m.qty } : {}),
        ...(optId(m.expenseId) ? { expenseId: optId(m.expenseId) } : {}),
      })),
  };
}

function sanitizeVacation(v) {
  if (!isObj(v) || !isValidISO(v.start) || !isInt(v.days) || v.days < 5 || v.days > 30) return null;
  const sell = isInt(v.sellDays) && v.sellDays >= 0 && v.sellDays <= 10 ? v.sellDays : 0;
  return { id: optId(v.id) || newId(), start: v.start, days: v.days, sellDays: sell, advance13: v.advance13 === true };
}

/** Limpa um desconto em folha (com ou sem parcelamento). */
function sanitizeDeduction(d) {
  if (!isObj(d) || !isInt(d.value) || d.value <= 0 || d.value > (d.mode === 'percent' ? 100000 : 1_000_000_000)) return null;
  return {
    id: optId(d.id) || newId(), description: str(d.description, 60) || 'Desconto',
    mode: d.mode === 'percent' ? 'percent' : 'fixed', value: d.value,
    base: d.base === 'gross' ? 'gross' : 'salary', irDeductible: d.irDeductible === true,
    ...(isObj(d.loan) && isInt(d.loan.count) && d.loan.count >= 1 && d.loan.count <= 420 && isValidYM(d.loan.startYM)
      ? { loan: { count: d.loan.count, startYM: d.loan.startYM } } : {}),
  };
}

/** Confere se a fotografia de um mês fechado tem tudo que as telas leem. */
function isValidSnapshot(snap) {
  if (!isObj(snap) || !isObj(snap.income) || !isObj(snap.totals)) return false;
  const ints = [snap.income.total, snap.income.salary, snap.income.extrasCents, snap.balance,
    ...['all', 'paid', 'pending', 'overdue', 'expense', 'recurring', 'installment'].map((k) => snap.totals[k])];
  if (!ints.every(isInt)) return false;
  if (!Array.isArray(snap.items) || !Array.isArray(snap.categories) || !Array.isArray(snap.income.extras)) return false;
  for (const k of ['invoice']) if (!isInt(snap.totals[k])) snap.totals[k] = 0;
  snap.categories = snap.categories
    .filter((c) => isObj(c) && isInt(c.cents))
    .map((c) => ({ name: str(c.name, 60) || 'Sem categoria', icon: str(c.icon, 24) || '🏷️', color: color(c.color, '#64748B'), cents: c.cents }));
  snap.items = snap.items
    .filter((i) => isObj(i) && isInt(i.cents) && isValidISO(i.dueDate))
    .map((i) => ({ kind: str(i.kind, 20), description: str(i.description, 120), cents: i.cents, dueDate: i.dueDate, paid: i.paid === true, paidAt: isValidISO(i.paidAt) ? i.paidAt : null, category: str(i.category, 60), parcel: isObj(i.parcel) && isInt(i.parcel.n) && isInt(i.parcel.count) ? { n: i.parcel.n, count: i.parcel.count } : null }));
  snap.income.extras = snap.income.extras.filter((x) => isObj(x) && isInt(x.cents)).map((x) => ({ description: str(x.description, 120), cents: x.cents, payroll: x.payroll === true }));
  const t = snap.income.thirteenth;
  snap.income.thirteenth = isObj(t) && isInt(t.net) ? { label: str(t.label, 60), net: t.net } : null;
  const p = snap.income.payroll;
  snap.income.payroll = isObj(p) && ['gross', 'inss', 'ir', 'deductions', 'net'].every((k) => isInt(p[k]))
    ? { gross: p.gross, inss: p.inss, ir: p.ir, deductions: p.deductions, net: p.net } : null;
  if (snap.report != null && !isObj(snap.report)) delete snap.report;
  if (snap.score != null && !isInt(snap.score)) delete snap.score;
  return true;
}

/** Perfil salarial vigente no mês (reexportado de payroll.js por conveniência). */
export { payrollProfileFor } from './payroll.js';
