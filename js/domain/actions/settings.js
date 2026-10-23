// =============================================================
// actions/settings.js — Perfil, aparência, painel, lembretes e onboarding
// =============================================================

import { store } from '../../core/store.js';
import { currentYM } from '../../core/dates.js';
import { ValidationError, text, cents, intRange } from './core.js';
import { DEFAULT_ALERTS } from '../stateShape.js';

export function updateProfile({ profileName }) {
  return store.commit((d) => {
    d.settings.profileName = text(profileName, 'profileName', 'o nome', { max: 60, required: false });
  });
}

export function setSpendingLimit(value) {
  return store.commit((d) => { d.settings.spendingLimitCents = cents(value, 'spendingLimit', { allowZero: true }); });
}

/** Teto das parcelas do mês sobre os ganhos fixos: 10, 20 ou 30%. */
export function setParcelLimitPct(pct) {
  return store.commit((d) => { d.settings.parcelLimitPct = [10, 20, 30].includes(Number(pct)) ? Number(pct) : 10; });
}

/** Quanto guardar por mês na reserva de emergência: 10, 20 ou 30% dos ganhos fixos. */
export function setReservePct(pct) {
  return store.commit((d) => { d.settings.reservePct = [10, 20, 30].includes(Number(pct)) ? Number(pct) : 10; });
}

/** Mês em que os cálculos começam ('AAAA-MM'); null volta ao automático (ver tracking.js). */
export function setTrackingStart(ym) {
  return store.commit((d) => {
    if (ym == null || ym === '') { d.settings.trackingStartYM = null; return; }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new ValidationError('trackingStart', 'Informe o mês no formato AAAA-MM.');
    if (ym > currentYM()) throw new ValidationError('trackingStart', 'O início não pode ser depois do mês atual.');
    d.settings.trackingStartYM = ym;
  });
}

export function setTheme(theme) {
  return store.commit((d) => { d.settings.theme = ['auto', 'light', 'dark', 'oled'].includes(theme) ? theme : 'auto'; }, 'appearance');
}

/** Aparência: tema, cor de destaque, densidade e efeitos (animações). */
export function setAppearance(patch) {
  return store.commit((d) => {
    const s = d.settings;
    if (patch.theme != null) s.theme = ['auto', 'light', 'dark', 'oled'].includes(patch.theme) ? patch.theme : 'auto';
    if (patch.accent != null) s.accent = ['azul', 'verde', 'roxo', 'laranja', 'rosa'].includes(patch.accent) ? patch.accent : 'azul';
    if (patch.density != null) s.density = patch.density === 'compact' ? 'compact' : 'comfortable';
    if (patch.motion != null) s.motion = ['full', 'calm', 'off'].includes(patch.motion) ? patch.motion : 'full';
  }, 'appearance'); // vale também para o visitante (nada é salvo)
}

export function completeOnboarding({ profileName, salaryCents, salaryDay, dependents = 0 }) {
  return store.commit((d) => {
    d.settings.profileName = text(profileName, 'profileName', 'o nome', { max: 60, required: false });
    cents(salaryCents, 'salary', { allowZero: true });
    d.settings.salaryDay = intRange(salaryDay, 'salaryDay', 1, 31, 'O dia');
    const deps = intRange(dependents, 'dependents', 0, 20, 'Dependentes');
    if (salaryCents > 0) {
      d.settings.salaryHistory = [{ from: currentYM(), grossCents: salaryCents, dependents: deps, additions: [], deductions: [] }];
      d.settings.onboardingSteps = { ...(d.settings.onboardingSteps || {}), salary: true };
    }
    d.onboarded = true;
  });
}

/** Marca (ou desmarca) um passo do checklist "Complete seu perfil". */
export function setOnboardingStep(step, done = true) {
  return store.commit((d) => {
    d.settings.onboardingSteps = { ...(d.settings.onboardingSteps || {}), [step]: Boolean(done) };
  });
}

export function markBackupDone() {
  return store.commit((d) => { d.lastBackupAt = new Date().toISOString(); }, 'silent');
}

/**
 * Lembretes: ligados, antecedência e modo.
 * mode: 'each' (uma notificação por conta) | 'daily' (um resumo por dia) | 'weekly' (resumo no domingo)
 */
export function setReminders({ enabled, daysBefore = 1, mode, push }) {
  return store.commit((d) => {
    const prev = d.settings.reminders || {};
    d.settings.reminders = {
      enabled: Boolean(enabled),
      daysBefore: intRange(daysBefore, 'daysBefore', 0, 7, 'A antecedência'),
      mode: ['each', 'daily', 'weekly'].includes(mode) ? mode : prev.mode || 'daily',
      push: push == null ? Boolean(prev.push) : Boolean(push),
    };
  });
}

/**
 * Limites dos alertas e dicas (Ajustes → Geral → Alertas e dicas).
 * patch = { tightPct?, overspendPct?, bigPct?, push? } — ver DEFAULT_ALERTS.
 */
export function setAlerts(patch) {
  return store.commit((d) => {
    const cur = { ...DEFAULT_ALERTS, ...(d.settings.alerts || {}) };
    if (patch.tightPct != null) cur.tightPct = intRange(patch.tightPct, 'tightPct', 0, 50, 'A folga mínima (%)');
    if (patch.overspendPct != null) cur.overspendPct = intRange(patch.overspendPct, 'overspendPct', 10, 300, 'O limite de gasto exagerado (%)');
    if (patch.bigPct != null) cur.bigPct = intRange(patch.bigPct, 'bigPct', 1, 100, 'O limite de gasto grande (%)');
    if (patch.push != null) cur.push = Boolean(patch.push);
    d.settings.alerts = cur;
  });
}

// ---------- Painel personalizável ----------

/** order: ids dos cards na ordem; hidden: escondidos; pinned: fixados no topo. */
export function setDashboardLayout({ order, hidden, pinned }) {
  return store.commit((d) => {
    const ids = (l) => (Array.isArray(l) ? [...new Set(l.filter((x) => typeof x === 'string'))].slice(0, 40) : undefined);
    const cur = d.settings.dashboard || { order: [], hidden: [], pinned: [] };
    d.settings.dashboard = { order: ids(order) ?? cur.order, hidden: ids(hidden) ?? cur.hidden, pinned: ids(pinned) ?? cur.pinned };
  });
}

export function resetDashboardLayout() {
  return store.commit((d) => { d.settings.dashboard = { order: [], hidden: [], pinned: [] }; });
}

/** Atalhos da barra inferior do celular (3 telas + "Novo" + "Mais"). */
export function setTabbar(ids) {
  return store.commit((d) => {
    const list = [...new Set((ids || []).filter((x) => typeof x === 'string'))].slice(0, 3);
    if (list.length !== 3) throw new ValidationError('Escolha 3 atalhos.');
    d.settings.tabbar = list;
  });
}

// ---------- Ajuda e novidades ----------

export function dismissHelp(id) {
  return store.commit((d) => {
    const list = new Set(d.settings.help?.dismissed || []);
    list.add(String(id).slice(0, 40));
    d.settings.help = { dismissed: [...list] };
  });
}

export function markVersionSeen(version) {
  return store.commit((d) => { d.settings.lastSeenVersion = String(version).slice(0, 20); }, 'silent');
}

// ---------- Buscas salvas ----------

export function saveSearch(name, query) {
  return store.commit((d) => {
    const n = text(name, 'name', 'o nome da busca', { max: 60 });
    d.settings.savedSearches = [...(d.settings.savedSearches || []).filter((x) => x.name.toLowerCase() !== n.toLowerCase()), { id: crypto.randomUUID?.().slice(0, 12) || String(Date.now()), name: n, query: { ...query } }].slice(-30);
  });
}

export function deleteSearch(id) {
  return store.commit((d) => { d.settings.savedSearches = (d.settings.savedSearches || []).filter((x) => x.id !== id); });
}

// ---------- Regra 50/30/20 ----------

export function setRule503020({ enabled, needs, wants, savings }) {
  return store.commit((d) => {
    const n = intRange(needs, 'needs', 0, 100, 'Necessidades');
    const w = intRange(wants, 'wants', 0, 100, 'Desejos');
    const s = intRange(savings, 'savings', 0, 100, 'Poupança');
    if (n + w + s !== 100) throw new ValidationError(`Os três somam ${n + w + s}%: precisam somar 100%.`, 'needs');
    d.settings.rule503020 = { enabled: Boolean(enabled), needs: n, wants: w, savings: s };
  });
}

/** Conta onde o salário cai (para o saldo real das contas). */
export function setSalaryAccount(accountId) {
  return store.commit((d) => {
    d.settings.salaryAccountId = (d.accounts || []).some((a) => a.id === accountId) ? accountId : null;
  });
}
