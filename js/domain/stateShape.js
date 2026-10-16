// @ts-check
// =============================================================
// stateShape.js — Estado vazio, versão do formato e listas fixas
// -------------------------------------------------------------
// Parte de domain/schema.js (que reexporta tudo). O formato
// completo do estado está documentado no topo de schema.js.
// =============================================================

import { DEFAULT_CATEGORIES, CATEGORY_COLORS } from './defaults.js';
import { DEFAULT_INVESTING } from './investments.js';

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

export const FREQS = ['monthly', 'weekly', 'biweekly', 'bimonthly', 'quarterly', 'semiannual', 'annual'];
export const INCOME_KINDS = ['extra', 'plantao', 'reembolso', 'venda', 'presente', 'rendimento', 'freela', 'outro'];
export const ACCOUNT_KINDS = ['corrente', 'salario', 'poupanca', 'digital', 'carteira', 'investimento', 'outro'];
