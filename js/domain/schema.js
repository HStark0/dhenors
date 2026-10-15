// =============================================================
// schema.js — Formato dos dados salvos
// -------------------------------------------------------------
// Todo o estado do app é UM objeto JSON. Ele é salvo no
// navegador (IndexedDB) e é exatamente o que vai no backup.
//
// Formato:
// {
//   schema: 7,
//   settings: {
//     profileName, salaryDay, theme,
//     payday: { mode: 'fixed'|'business', nth, saturday, nextMonth },   // dia fixo ou N-ésimo dia útil; nextMonth = salário da competência cai no mês seguinte
//     salaryHistory: [perfil salarial BRUTO — ver domain/payroll.js], // vale a partir de `from`
//     payrollLoans: [desconto parcelado/consignado — ver domain/payroll.js],
//     payrollVariable: [adicional/desconto VARIÁVEL de um mês — ver domain/payroll.js],
//     employment: { admission, regime: 'inss'|'fixed', fixedRateBp, thirteenth },
//     actualNet: { "AAAA-MM": centavos }   // líquido conferido no holerite real
//     vacations: [{ id, start, days, sellDays, advance13 }],              // férias
//     absences: [{ id, ym, kind: 'atestado'|'inss'|'falta', days, note }], // afastamentos e faltas
//     budgets: { idCategoria: centavos },                                  // orçamento mensal por categoria
//     reminders: { enabled, daysBefore },                                  // lembretes de vencimento
//     rules: [{ id, pattern, categoryId, subcategoryId }],                 // categorização automática
//   importFingerprints: [ "data|valor|descrição" ]                         // evita importar 2× o mesmo extrato
//     spendingLimitCents                                               // meta (limite) de gastos mensal
//     investing: { cdiBp, ipcaBp, monthlyTargetCents, targets: { classe: % } } // premissas da carteira
//   },
//   investments:      [{ id, name, type, institution, rate: { kind, bp }, liquidity, maturity, emergency, notes,
//                        movements: [{ id, date, kind: 'aporte'|'resgate'|'provento'|'saldo', cents, note, expenseId }] }],
//   extraIncomes:     [{ id, ym, description, cents, date, payroll }],  // plantões, freelas…
//                     // payroll = true → pago na folha (bruto, sofre INSS/IR)
//   expenses:         [{ id, description, cents, dueDate, paidAt, categoryId, subcategoryId, creditorId, notes }],
//   recurring:        [{ id, description, cents, dueDay, startYM, endYM, categoryId, subcategoryId, creditorId, notes }],
//   recurringEntries: { "idRecorrente|AAAA-MM": { paidAt, cents, skipped } }, // pagamento/ajuste por mês
//   installments:     [{ id, description, totalCents, count, firstDueDate, dueDay, paid: [nºs pagos], categoryId, subcategoryId, creditorId, notes }],
//   goals:            [{ id, description, targetCents, deadline, icon, contributions: [{ id, date, cents }] }],
//   creditors:        [{ id, name, notes }],
//   categories:       [{ id, name, icon, color, subcategories: [{ id, name }] }],
//   closedMonths:     { "AAAA-MM": snapshot }   // fotografia do mês fechado
// }
// =============================================================

import { DEFAULT_CATEGORIES, CATEGORY_COLORS } from './defaults.js';
import { isValidISO, isValidYM } from '../core/dates.js';
import { INVEST_TYPES, RATE_KINDS, LIQUIDITY, MOVEMENT_KINDS, CLASS_KEYS, DEFAULT_INVESTING } from './investments.js';

export const SCHEMA_VERSION = 7;

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
    subcategories: cat.subcategories.map((name) => ({ id: newId(), name })),
  }));
}

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
      vacations: [],
      absences: [],
      budgets: {},
      reminders: { enabled: false, daysBefore: 1 },
      rules: [],
      spendingLimitCents: 0,
      investing: structuredClone(DEFAULT_INVESTING),
      theme: 'auto',
    },
    extraIncomes: [],
    expenses: [],
    recurring: [],
    recurringEntries: {},
    installments: [],
    goals: [],
    investments: [],
    creditors: [],
    categories: createDefaultCategories(),
    closedMonths: {},
    importFingerprints: [],
  };
}

// ---------- Validação de backup importado ----------

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const optId = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);

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

  const base = createEmptyState();
  const s = raw.settings;

  const state = {
    ...base,
    createdAt: str(raw.createdAt, 40) || base.createdAt,
    lastBackupAt: str(raw.lastBackupAt, 40) || null,
    onboarded: true,
    settings: {
      profileName: str(s.profileName, 60),
      salaryDay: isInt(s.salaryDay) && s.salaryDay >= 1 && s.salaryDay <= 31 ? s.salaryDay : 5,
      payday: {
        mode: isObj(s.payday) && s.payday.mode === 'business' ? 'business' : 'fixed',
        nth: isObj(s.payday) && isInt(s.payday.nth) && s.payday.nth >= 1 && s.payday.nth <= 10 ? s.payday.nth : 5,
        saturday: !(isObj(s.payday) && s.payday.saturday === false),
        nextMonth: isObj(s.payday) && s.payday.nextMonth === true,
      },
      salaryHistory: (Array.isArray(s.salaryHistory) ? s.salaryHistory : [])
        .map(sanitizeProfile).filter(Boolean)
        .sort((a, b) => a.from.localeCompare(b.from)),
      payrollLoans: [],
      payrollVariable: (Array.isArray(s.payrollVariable) ? s.payrollVariable : []).map(sanitizeVariable).filter(Boolean),
      employment: sanitizeEmployment(s.employment),
      actualNet: sanitizeActual(s.actualNet),
      vacations: (Array.isArray(s.vacations) ? s.vacations : []).map(sanitizeVacation).filter(Boolean),
      absences: (Array.isArray(s.absences) ? s.absences : [])
        .filter((a) => isObj(a) && isValidYM(a.ym) && isInt(a.days) && a.days >= 1 && a.days <= 30)
        .map((a) => ({ id: optId(a.id) || newId(), ym: a.ym, kind: ['atestado', 'inss', 'falta'].includes(a.kind) ? a.kind : 'atestado', days: a.days, note: str(a.note, 80) })),
      budgets: sanitizeActual(s.budgets, true),
      reminders: { enabled: isObj(s.reminders) && s.reminders.enabled === true, daysBefore: isObj(s.reminders) && isInt(s.reminders.daysBefore) && s.reminders.daysBefore >= 0 && s.reminders.daysBefore <= 7 ? s.reminders.daysBefore : 1 },
      rules: (Array.isArray(s.rules) ? s.rules : []).filter((r) => isObj(r) && str(r.pattern, 60).trim()).slice(0, 500)
        .map((r) => ({ id: optId(r.id) || newId(), pattern: str(r.pattern, 60).trim(), categoryId: optId(r.categoryId), subcategoryId: optId(r.subcategoryId) })),
      spendingLimitCents: isInt(s.spendingLimitCents) && s.spendingLimitCents >= 0 ? s.spendingLimitCents : 0,
      investing: sanitizeInvesting(s.investing),
      theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    },
  };

  // Descontos parcelados: lista própria (v3). Na v2 ficavam dentro dos perfis.
  const loans = new Map();
  for (const l of (Array.isArray(s.payrollLoans) ? s.payrollLoans : [])) {
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
  });

  state.extraIncomes = (raw.extraIncomes || [])
    .filter((x) => isObj(x) && isValidYM(x.ym) && isInt(x.cents) && x.cents > 0)
    // Na versão 1 as rendas extras eram líquidas (payroll = false)
    .map((x) => ({ id: optId(x.id) || newId(), ym: x.ym, description: str(x.description, 120) || 'Renda extra', cents: x.cents, date: isValidISO(x.date) ? x.date : null, payroll: x.payroll === true }));

  state.expenses = raw.expenses
    .filter((x) => isObj(x) && isInt(x.cents) && x.cents > 0 && isValidISO(x.dueDate))
    .map((x) => ({ id: optId(x.id) || newId(), description: str(x.description, 120) || 'Despesa', cents: x.cents, dueDate: x.dueDate, paidAt: isValidISO(x.paidAt) ? x.paidAt : null, ...common(x) }));

  state.recurring = (raw.recurring || [])
    .filter((x) => isObj(x) && isInt(x.cents) && x.cents > 0 && isInt(x.dueDay) && isValidYM(x.startYM))
    .map((x) => ({ id: optId(x.id) || newId(), description: str(x.description, 120) || 'Recorrente', cents: x.cents, dueDay: Math.min(31, Math.max(1, x.dueDay)), startYM: x.startYM, endYM: isValidYM(x.endYM) ? x.endYM : null, ...common(x) }));

  state.recurringEntries = {};
  if (isObj(raw.recurringEntries)) {
    for (const [key, e] of Object.entries(raw.recurringEntries)) {
      if (!isObj(e) || !/^[\w-]+\|\d{4}-\d{2}$/.test(key)) continue;
      state.recurringEntries[key] = {
        paidAt: isValidISO(e.paidAt) ? e.paidAt : null,
        cents: isInt(e.cents) && e.cents > 0 ? e.cents : null,
        skipped: e.skipped === true,
      };
    }
  }

  state.installments = (raw.installments || [])
    .filter((x) => isObj(x) && isInt(x.totalCents) && x.totalCents > 0 && isInt(x.count) && x.count >= 1 && isValidISO(x.firstDueDate))
    .map((x) => ({
      id: optId(x.id) || newId(), description: str(x.description, 120) || 'Parcelamento',
      totalCents: x.totalCents, count: Math.min(x.count, 420), firstDueDate: x.firstDueDate,
      dueDay: isInt(x.dueDay) && x.dueDay >= 1 && x.dueDay <= 31 ? x.dueDay : +x.firstDueDate.slice(8),
      paid: [...new Set((x.paid || []).filter((n) => isInt(n) && n >= 1 && n <= x.count))].sort((a, b) => a - b),
      ...common(x),
    }));

  state.goals = (raw.goals || [])
    .filter((x) => isObj(x) && isInt(x.targetCents) && x.targetCents > 0)
    .map((x) => ({
      id: optId(x.id) || newId(), description: str(x.description, 120) || 'Meta', targetCents: x.targetCents,
      deadline: isValidISO(x.deadline) ? x.deadline : null, icon: str(x.icon, 8) || '🎯', emergency: x.emergency === true,
      contributions: (x.contributions || []).filter((c) => isObj(c) && isInt(c.cents) && isValidISO(c.date))
        .map((c) => ({ id: optId(c.id) || newId(), date: c.date, cents: c.cents })),
    }));

  state.investments = (Array.isArray(raw.investments) ? raw.investments : []).map(sanitizeInvestment).filter(Boolean);

  state.creditors = (raw.creditors || [])
    .filter((x) => isObj(x) && str(x.name))
    .map((x) => ({ id: optId(x.id) || newId(), name: str(x.name, 80), notes: str(x.notes, 500) }));

  if (Array.isArray(raw.categories) && raw.categories.length) {
    state.categories = raw.categories
      .filter((c) => isObj(c) && str(c.name))
      .map((c, i) => ({
        id: optId(c.id) || newId(), name: str(c.name, 60), icon: str(c.icon, 8) || '🏷️',
        color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        subcategories: (c.subcategories || []).filter((sc) => isObj(sc) && str(sc.name))
          .map((sc) => ({ id: optId(sc.id) || newId(), name: str(sc.name, 60) })),
      }));
  }

  state.importFingerprints = (Array.isArray(raw.importFingerprints) ? raw.importFingerprints : [])
    .filter((f) => typeof f === 'string' && f.length < 200).slice(-5000);

  state.closedMonths = {};
  if (isObj(raw.closedMonths)) {
    for (const [ym, snap] of Object.entries(raw.closedMonths)) {
      if (isValidYM(ym) && isValidSnapshot(snap)) state.closedMonths[ym] = snap;
    }
  }

  return state;
}

/**
 * Perfil salarial limpo. Aceita o formato antigo (v1: { from, cents },
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
    additions: (Array.isArray(h.additions) ? h.additions : []).filter((a) => isObj(a) && value(a)).slice(0, 20)
      .map(addition),
    deductions: (Array.isArray(h.deductions) ? h.deductions : []).filter((d) => isObj(d) && value(d)).slice(0, 20)
      .map(sanitizeDeduction).filter(Boolean),
    ...(h.legacyNet === true ? { legacyNet: true } : {}),
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
    monthlyTargetCents: bp(o.monthlyTargetCents, 0, 1_000_000_000),
    targets: Object.values(targets).reduce((a, n) => a + n, 0) === 100 ? targets : {},
  };
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
    movements: (Array.isArray(x.movements) ? x.movements : [])
      .filter((m) => isObj(m) && MOVEMENT_KINDS[m.kind] && isValidISO(m.date) && isInt(m.cents)
        && (m.kind === 'saldo' ? m.cents >= 0 : m.cents > 0) && m.cents <= 1_000_000_000)
      .slice(0, 5000)
      .map((m) => ({ id: optId(m.id) || newId(), date: m.date, kind: m.kind, cents: m.cents, note: str(m.note, 120), ...(optId(m.expenseId) ? { expenseId: optId(m.expenseId) } : {}) })),
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
  snap.categories = snap.categories
    .filter((c) => isObj(c) && isInt(c.cents))
    .map((c) => ({ name: str(c.name, 60) || 'Sem categoria', icon: str(c.icon, 8) || '🏷️', color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#64748B', cents: c.cents }));
  snap.items = snap.items
    .filter((i) => isObj(i) && isInt(i.cents) && isValidISO(i.dueDate))
    .map((i) => ({ kind: str(i.kind, 20), description: str(i.description, 120), cents: i.cents, dueDate: i.dueDate, paid: i.paid === true, category: str(i.category, 60), parcel: isObj(i.parcel) && isInt(i.parcel.n) && isInt(i.parcel.count) ? { n: i.parcel.n, count: i.parcel.count } : null }));
  snap.income.extras = snap.income.extras.filter((x) => isObj(x) && isInt(x.cents)).map((x) => ({ description: str(x.description, 120), cents: x.cents, payroll: x.payroll === true }));
  const t = snap.income.thirteenth;
  snap.income.thirteenth = isObj(t) && isInt(t.net) ? { label: str(t.label, 60), net: t.net } : null;
  const p = snap.income.payroll;
  snap.income.payroll = isObj(p) && ['gross', 'inss', 'ir', 'deductions', 'net'].every((k) => isInt(p[k]))
    ? { gross: p.gross, inss: p.inss, ir: p.ir, deductions: p.deductions, net: p.net } : null;
  return true;
}

/** Perfil salarial vigente no mês (reexportado de payroll.js por conveniência). */
export { payrollProfileFor } from './payroll.js';
