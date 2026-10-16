// @ts-check
// =============================================================
// sanitizeState.js — Backup importado → estado limpo e válido
// -------------------------------------------------------------
// Parte de domain/schema.js (que reexporta sanitizeState).
// Os pedaços de salário e investimentos ficam em sanitizePayroll.js
// e sanitizeInvest.js.
// =============================================================

import { CATEGORY_COLORS, LEGACY_STATE_COLORS, groupOfCategory } from './defaults.js';
import { isValidISO, isValidYM } from '../core/dates.js';
import { SCHEMA_VERSION, newId, DEFAULT_SHIFT_TYPES, createEmptyState, FREQS, INCOME_KINDS, ACCOUNT_KINDS } from './stateShape.js';
import { isObj, isInt, str, optId, arr, cents, day, color, tags, pick } from './sanitizeUtil.js';
import {
  sanitizeProfile, sanitizeVariable, sanitizeEmployment, sanitizeOnCall, sanitizeActual,
  sanitizeShiftType, sanitizeBenefit, sanitizeJob, sanitizeTaxTables, sanitizeVacation, sanitizeDeduction,
} from './sanitizePayroll.js';
import { sanitizeInvesting, sanitizeIndices, sanitizeQuotes, sanitizeInvestment } from './sanitizeInvest.js';

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
