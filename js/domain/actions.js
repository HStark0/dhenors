// =============================================================
// actions.js — Todas as operações de escrita, com validação
// -------------------------------------------------------------
// As telas nunca alteram `store.data` diretamente: chamam uma
// função daqui. Cada função valida a entrada e lança
// ValidationError (com o campo) quando algo está errado.
// =============================================================

import { store } from '../core/store.js';
import { MAX_CENTS } from '../core/money.js';
import { isValidISO, isValidYM, ymOf, todayISO, currentYM, formatMonth, addMonthsYM } from '../core/dates.js';
import { newId, createDefaultCategories } from './schema.js';
import { payrollProfileFor } from './payroll.js';
import { entryKey, recurringActiveIn, planInstallment } from './ledger.js';
import { buildSnapshot } from './analysis.js';
import { CATEGORY_COLORS } from './defaults.js';
import { friendlyName, normalizeName } from './payslip.js';
import { INVEST_TYPES, RATE_KINDS, LIQUIDITY, MOVEMENT_KINDS, CLASS_KEYS, positionAt, investingOf } from './investments.js';

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.field = field;
  }
}

// ---------- Validadores ----------

function text(value, field, label, { max = 120, required = true } = {}) {
  const v = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (required && !v) throw new ValidationError(`Informe ${label}.`, field);
  if (v.length > max) throw new ValidationError(`${label[0].toUpperCase() + label.slice(1)} muito longo (máx. ${max}).`, field);
  return v;
}

function cents(value, field, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new ValidationError(allowZero ? 'Valor inválido.' : 'Informe um valor maior que zero.', field);
  }
  if (value > MAX_CENTS) throw new ValidationError('Valor alto demais.', field);
  return value;
}

function date(value, field, { required = true } = {}) {
  if (!value && !required) return null;
  if (!isValidISO(value)) throw new ValidationError('Data inválida.', field);
  return value;
}

function intRange(value, field, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label} deve ser entre ${min} e ${max}.`, field);
  }
  return n;
}

function refs(data, input) {
  const cat = data.categories.find((c) => c.id === input.categoryId);
  const sub = cat?.subcategories.find((s) => s.id === input.subcategoryId);
  const cred = data.creditors.find((c) => c.id === input.creditorId);
  return {
    categoryId: cat ? cat.id : null,
    subcategoryId: sub ? sub.id : null,
    creditorId: cred ? cred.id : null,
    notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }),
  };
}

function assertOpen(data, ym, field = 'dueDate') {
  if (data.closedMonths[ym]) {
    throw new ValidationError(`${formatMonth(ym)} está fechado. Reabra o mês no Histórico para alterar.`, field);
  }
}

const findOrThrow = (list, id, what) => {
  const item = list.find((x) => x.id === id);
  if (!item) throw new ValidationError(`${what} não encontrado(a).`);
  return item;
};

// ---------- Configurações ----------

export function updateProfile({ profileName }) {
  return store.commit((d) => {
    d.settings.profileName = text(profileName, 'profileName', 'o nome', { max: 60, required: false });
  });
}

/** Define o salário a partir de um mês (meses anteriores mantêm o valor antigo). */
// ---------- Salário (perfil salarial bruto) ----------
// O perfil vale a partir de um mês (`from`). Editar o salário "a partir de
// outubro" cria/atualiza o perfil de outubro; os meses anteriores não mudam.

/** Valida uma linha de adicional ('add') ou desconto ('ded'). */
function payrollLine(x, kind) {
  const label = kind === 'add' ? 'o adicional' : 'o desconto';
  const description = text(x.description, 'description', `a descrição d${label.slice(1)}`, { max: 60 });
  if (x.mode === 'percent') {
    if (!Number.isInteger(x.value) || x.value <= 0 || x.value > 100000) throw new ValidationError('Percentual inválido.', 'value');
  } else if (x.mode === 'hours') {
    if (!Number.isInteger(x.value) || x.value <= 0 || x.value > 744 * 60) throw new ValidationError('Informe as horas (ex.: 10 ou 10:30).', 'value');
  } else {
    cents(x.value, 'value');
  }
  if (x.mode === 'hours') {
    if (kind !== 'add') throw new ValidationError('Só adicionais podem ser por horas.');
    const hourKind = ['he50', 'he100', 'sobreaviso', 'noturno', 'custom'].includes(x.hourKind) ? x.hourKind : 'custom';
    const hourPct = hourKind === 'custom' ? intRange(x.hourPct, 'hourPct', 1, 100000, 'O percentual da hora') : null;
    return { id: x.id || newId(), description, mode: 'hours', value: x.value, hourKind, ...(hourPct ? { hourPct } : {}), dsr: Boolean(x.dsr), taxable: x.taxable !== false };
  }
  const line = { id: x.id || newId(), description, mode: x.mode === 'percent' ? 'percent' : 'fixed', value: x.value };
  if (kind === 'add') {
    return { ...line, base: x.base === 'minimum' ? 'minimum' : 'salary', taxable: x.taxable !== false };
  }
  const out = { ...line, base: x.base === 'gross' ? 'gross' : 'salary', irDeductible: Boolean(x.irDeductible) };
  if (x.loan) {
    const count = intRange(x.loan.count, 'loanCount', 1, 420, 'O nº de parcelas');
    if (!isValidYM(x.loan.startYM)) throw new ValidationError('Início inválido.', 'loanPaid');
    out.loan = { count, startYM: x.loan.startYM };
  }
  return out;
}

/** Cópia editável do perfil vigente em `ym` (já com from = ym). */
function profileAt(d, ym) {
  const current = payrollProfileFor(d.settings, ym);
  return current
    ? { ...structuredClone(current), from: ym }
    : { from: ym, grossCents: 0, dependents: 0, additions: [], deductions: [] };
}

function putProfile(d, profile) {
  const list = d.settings.salaryHistory.filter((h) => h.from !== profile.from);
  list.push(profile);
  list.sort((a, b) => a.from.localeCompare(b.from));
  d.settings.salaryHistory = list;
}

/** Salário base bruto, dependentes e dia do pagamento, a partir de `fromYM`. */
export function savePayrollBase({ fromYM, grossCents, dependents = 0, salaryDay }) {
  return store.commit((d) => {
    if (!isValidYM(fromYM)) throw new ValidationError('Mês inválido.', 'fromYM');
    const profile = profileAt(d, fromYM);
    profile.grossCents = cents(grossCents, 'grossCents', { allowZero: true });
    profile.dependents = intRange(dependents, 'dependents', 0, 20, 'Dependentes');
    delete profile.legacyNet; // agora o salário é bruto e os impostos são calculados
    if (salaryDay != null) d.settings.salaryDay = intRange(salaryDay, 'salaryDay', 1, 31, 'O dia');
    putProfile(d, profile);
  });
}

/**
 * Cria ou edita um adicional ('add') ou desconto ('ded') a partir do mês `ym`.
 *  • Linhas comuns valem do mês `ym` em diante: entram no perfil de `ym`
 *    e também em todos os perfis posteriores (ex.: um aumento cadastrado
 *    para dezembro não "apaga" o plano de saúde incluído em outubro).
 *  • Descontos parcelados (consignado) vão para settings.payrollLoans e
 *    valem em todo mês entre a 1ª e a última parcela.
 */
export function savePayrollLine(ym, kind, input) {
  return store.commit((d) => upsertPayrollLine(d, ym, kind, input));
}

/** Inclui/atualiza uma linha do contracheque no estado `d` (usado também na importação). */
function upsertPayrollLine(d, ym, kind, input) {
  {
    const current = payrollProfileFor(d.settings, ym);
    if (!current) throw new ValidationError('Cadastre primeiro o salário base deste mês.');
    if (current.legacyNet) throw new ValidationError('Informe primeiro o salário bruto (botão "Editar" do salário base).');
    const line = payrollLine(input, kind);
    // Garante um perfil próprio a partir de `ym` (os meses anteriores não mudam)
    putProfile(d, profileAt(d, ym));

    // Remove a versão antiga onde quer que esteja (pode ter mudado de tipo)
    d.settings.payrollLoans = (d.settings.payrollLoans || []).filter((x) => x.id !== line.id);
    d.settings.payrollVariable = (d.settings.payrollVariable || []).filter((x) => x.id !== line.id);
    for (const p of d.settings.salaryHistory) {
      if (p.from < ym) continue;
      p.additions = p.additions.filter((x) => x.id !== line.id);
      p.deductions = p.deductions.filter((x) => x.id !== line.id);
    }

    // Variável: vale só neste mês
    if (input.variable) {
      if (line.loan) throw new ValidationError('Um desconto parcelado não pode ser variável.');
      d.settings.payrollVariable.push({ ...line, kind, ym });
      return;
    }
    if (line.loan) {
      for (const p of d.settings.salaryHistory) p.deductions = p.deductions.filter((x) => x.id !== line.id);
      d.settings.payrollLoans.push(line);
      return;
    }

    for (const p of d.settings.salaryHistory) {
      if (p.from < ym) continue;
      const list = kind === 'add' ? p.additions : p.deductions;
      const i = list.findIndex((x) => x.id === line.id);
      if (i >= 0) list[i] = line; else list.push(line);
    }
    return line;
  }
}

/** Remove a linha do mês `ym` em diante (variável: só do mês; consignado: inteiro). */
export function deletePayrollLine(ym, kind, id) {
  return store.commit((d) => {
    const vars = d.settings.payrollVariable || [];
    if (vars.some((x) => x.id === id)) {
      d.settings.payrollVariable = vars.filter((x) => x.id !== id);
      return;
    }
    const loans = d.settings.payrollLoans || [];
    if (kind === 'ded' && loans.some((x) => x.id === id)) {
      d.settings.payrollLoans = loans.filter((x) => x.id !== id);
      return;
    }
    putProfile(d, profileAt(d, ym));
    for (const p of d.settings.salaryHistory) {
      if (p.from < ym) continue;
      if (kind === 'add') p.additions = p.additions.filter((x) => x.id !== id);
      else p.deductions = p.deductions.filter((x) => x.id !== id);
    }
  });
}

/** Copia as linhas variáveis do mês anterior para `ym` (ex.: adicional noturno parecido). */
export function copyVariablesFromPrevious(ym) {
  return store.commit((d) => {
    const prev = addMonthsYM(ym, -1);
    const list = (d.settings.payrollVariable || []).filter((x) => x.ym === prev);
    if (!list.length) throw new ValidationError('O mês anterior não tem lançamentos variáveis.');
    for (const x of list) d.settings.payrollVariable.push({ ...x, id: newId(), ym });
    return list.length;
  });
}

/** Vínculo: data de admissão, regime de previdência e 13º automático. */
export function saveEmployment({ admission, regime, fixedRateBp, thirteenth, hoursDivisor, familyChildren }) {
  return store.commit((d) => {
    const prev = d.settings.employment || {};
    const emp = {
      admission: date(admission, 'admission', { required: false }),
      regime: regime === 'fixed' ? 'fixed' : 'inss',
      fixedRateBp: 1400,
      thirteenth: Boolean(thirteenth),
      hoursDivisor: hoursDivisor == null ? (prev.hoursDivisor || 220) : intRange(hoursDivisor, 'hoursDivisor', 100, 300, 'O divisor de horas'),
      familyChildren: familyChildren == null ? (prev.familyChildren || 0) : intRange(familyChildren, 'familyChildren', 0, 20, 'O nº de filhos'),
    };
    if (emp.regime === 'fixed') {
      if (!Number.isInteger(fixedRateBp) || fixedRateBp <= 0 || fixedRateBp > 5000) throw new ValidationError('Alíquota inválida (até 50%).', 'fixedRate');
      emp.fixedRateBp = fixedRateBp;
    }
    d.settings.employment = emp;
  });
}

/** Líquido real do holerite no mês (null = voltar a usar a estimativa). */
export function setActualNet(ym, value) {
  return store.commit((d) => {
    if (!isValidYM(ym)) throw new ValidationError('Mês inválido.');
    d.settings.actualNet ||= {};
    if (value == null) delete d.settings.actualNet[ym];
    else d.settings.actualNet[ym] = cents(value, 'actual', { allowZero: true });
  });
}

/** Remove um registro do histórico de salário. */
export function deleteSalaryEntry(fromYM) {
  return store.commit((d) => {
    d.settings.salaryHistory = d.settings.salaryHistory.filter((h) => h.from !== fromYM);
  });
}

export function setSalaryDay(day) {
  return store.commit((d) => { d.settings.salaryDay = intRange(day, 'salaryDay', 1, 31, 'O dia'); });
}

export function setSpendingLimit(value) {
  return store.commit((d) => { d.settings.spendingLimitCents = cents(value, 'spendingLimit', { allowZero: true }); });
}

export function setTheme(theme) {
  return store.commit((d) => { d.settings.theme = ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto'; });
}

export function completeOnboarding({ profileName, salaryCents, salaryDay, dependents = 0 }) {
  return store.commit((d) => {
    d.settings.profileName = text(profileName, 'profileName', 'o nome', { max: 60, required: false });
    cents(salaryCents, 'salary', { allowZero: true });
    d.settings.salaryDay = intRange(salaryDay, 'salaryDay', 1, 31, 'O dia');
    const deps = intRange(dependents, 'dependents', 0, 20, 'Dependentes');
    if (salaryCents > 0) {
      d.settings.salaryHistory = [{ from: currentYM(), grossCents: salaryCents, dependents: deps, additions: [], deductions: [] }];
    }
    d.onboarded = true;
  });
}

export function markBackupDone() {
  return store.commit((d) => { d.lastBackupAt = new Date().toISOString(); }, 'silent');
}

// ---------- Renda extra ----------

export function saveExtraIncome(input) {
  return store.commit((d) => {
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: cents(input.cents, 'cents'),
      date: date(input.date, 'date'),
      payroll: Boolean(input.payroll), // pago na folha = valor bruto, sofre INSS/IR
    };
    item.ym = ymOf(item.date);
    assertOpen(d, item.ym, 'date');
    if (input.id) {
      const current = findOrThrow(d.extraIncomes, input.id, 'Renda');
      assertOpen(d, current.ym, 'date');
      Object.assign(current, item);
    } else {
      d.extraIncomes.push({ id: newId(), ...item });
    }
  });
}

export function deleteExtraIncome(id) {
  return store.commit((d) => {
    const item = findOrThrow(d.extraIncomes, id, 'Renda');
    assertOpen(d, item.ym);
    d.extraIncomes = d.extraIncomes.filter((x) => x.id !== id);
  });
}

// ---------- Despesas avulsas ----------

export function saveExpense(input) {
  return store.commit((d) => {
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: cents(input.cents, 'cents'),
      dueDate: date(input.dueDate, 'dueDate'),
      paidAt: input.paid ? date(input.paidAt || input.dueDate, 'paidAt') : null,
      ...refs(d, input),
    };
    assertOpen(d, ymOf(item.dueDate));
    if (input.id) {
      const current = findOrThrow(d.expenses, input.id, 'Despesa');
      assertOpen(d, ymOf(current.dueDate));
      Object.assign(current, item);
      return current;
    }
    const created = { id: newId(), ...item };
    d.expenses.push(created);
    return created;
  });
}

export function deleteExpense(id) {
  return store.commit((d) => {
    const current = findOrThrow(d.expenses, id, 'Despesa');
    assertOpen(d, ymOf(current.dueDate));
    d.expenses = d.expenses.filter((x) => x.id !== id);
  });
}

/** Adia uma despesa avulsa para outra data. */
export function postponeExpense(id, newDate) {
  return store.commit((d) => {
    const current = findOrThrow(d.expenses, id, 'Despesa');
    assertOpen(d, ymOf(current.dueDate));
    date(newDate, 'dueDate');
    assertOpen(d, ymOf(newDate));
    current.dueDate = newDate;
  });
}

// ---------- Recorrentes ----------

export function saveRecurring(input) {
  return store.commit((d) => {
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: cents(input.cents, 'cents'),
      dueDay: intRange(input.dueDay, 'dueDay', 1, 31, 'O dia de vencimento'),
      startYM: isValidYM(input.startYM) ? input.startYM : (() => { throw new ValidationError('Mês de início inválido.', 'startYM'); })(),
      endYM: input.endYM ? (isValidYM(input.endYM) ? input.endYM : (() => { throw new ValidationError('Mês final inválido.', 'endYM'); })()) : null,
      ...refs(d, input),
    };
    if (item.endYM && item.endYM < item.startYM) throw new ValidationError('O fim deve ser depois do início.', 'endYM');
    if (input.id) Object.assign(findOrThrow(d.recurring, input.id, 'Recorrente'), item);
    else d.recurring.push({ id: newId(), ...item });
  });
}

/** Encerra a recorrente: deixa de aparecer a partir do mês seguinte a `lastYM`. */
export function endRecurring(id, lastYM = currentYM()) {
  return store.commit((d) => {
    const rec = findOrThrow(d.recurring, id, 'Recorrente');
    rec.endYM = lastYM < rec.startYM ? rec.startYM : lastYM;
  });
}

export function resumeRecurring(id) {
  return store.commit((d) => { findOrThrow(d.recurring, id, 'Recorrente').endYM = null; });
}

/** Apaga a recorrente e todo o histórico de pagamentos dela. */
export function deleteRecurring(id) {
  return store.commit((d) => {
    findOrThrow(d.recurring, id, 'Recorrente');
    d.recurring = d.recurring.filter((r) => r.id !== id);
    for (const key of Object.keys(d.recurringEntries)) {
      if (key.startsWith(`${id}|`)) delete d.recurringEntries[key];
    }
  });
}

function entry(d, id, ym) {
  const key = entryKey(id, ym);
  d.recurringEntries[key] ||= { paidAt: null, cents: null, skipped: false };
  return [key, d.recurringEntries[key]];
}

function cleanupEntry(d, key) {
  const e = d.recurringEntries[key];
  if (e && !e.paidAt && e.cents == null && !e.skipped) delete d.recurringEntries[key];
}

/** Ajusta o valor só deste mês (ex.: conta de luz variou). null = volta ao padrão. */
export function setRecurringMonthAmount(id, ym, value) {
  return store.commit((d) => {
    findOrThrow(d.recurring, id, 'Recorrente');
    assertOpen(d, ym, 'cents');
    const [key, e] = entry(d, id, ym);
    e.cents = value == null ? null : cents(value, 'cents');
    cleanupEntry(d, key);
  });
}

/** Pula a recorrente só neste mês. */
export function skipRecurringMonth(id, ym, skipped = true) {
  return store.commit((d) => {
    findOrThrow(d.recurring, id, 'Recorrente');
    assertOpen(d, ym);
    const [key, e] = entry(d, id, ym);
    e.skipped = skipped;
    if (skipped) e.paidAt = null;
    cleanupEntry(d, key);
  });
}

// ---------- Parcelamentos ----------

/**
 * Salva um parcelamento informando:
 *   parcelCents  valor de cada parcela
 *   count        nº de parcelas
 *   paidCount    quantas já foram pagas
 *   nextDueDate  vencimento da próxima parcela a pagar
 * O total, a data da 1ª e da última parcela são calculados (planInstallment).
 * `keepTotalCents` preserva o total original na edição (quando a parcela não mudou).
 */
export function saveInstallment(input) {
  return store.commit((d) => {
    const count = intRange(input.count, 'count', 1, 420, 'O número de parcelas');
    const parcelCents = cents(input.parcelCents, 'parcelCents');
    const paidCount = intRange(input.paidCount ?? 0, 'paidCount', 0, count, 'Parcelas já pagas');
    const nextDueDate = date(input.nextDueDate, 'nextDueDate');
    const dueDay = intRange(input.dueDay ?? Number(nextDueDate.slice(8, 10)), 'dueDay', 1, 31, 'O dia de vencimento');
    const plan = planInstallment({ parcelCents, count, paidCount, nextDueDate, dueDay });

    const item = {
      description: text(input.description, 'description', 'a descrição'),
      totalCents: Number.isInteger(input.keepTotalCents) ? input.keepTotalCents : plan.totalCents,
      count,
      firstDueDate: plan.firstDueDate,
      dueDay: plan.dueDay,
      ...refs(d, input),
    };
    if (item.totalCents > MAX_CENTS) throw new ValidationError('Valor total alto demais.', 'parcelCents');
    const firstN = Array.from({ length: paidCount }, (_, i) => i + 1);

    if (input.id) {
      const current = findOrThrow(d.installments, input.id, 'Parcelamento');
      // Mantém marcações individuais se a quantidade paga não mudou
      const keepPaid = current.paid.length === paidCount && current.paid.every((n) => n <= count);
      Object.assign(current, item);
      current.paid = keepPaid ? current.paid : firstN;
    } else {
      d.installments.push({ id: newId(), ...item, paid: firstN });
    }
  });
}

export function deleteInstallment(id) {
  return store.commit((d) => {
    findOrThrow(d.installments, id, 'Parcelamento');
    d.installments = d.installments.filter((x) => x.id !== id);
  });
}

/** Marca/desmarca UMA parcela específica (n = número da parcela). */
export function setParcelPaid(id, n, paid) {
  return store.commit((d) => {
    const inst = findOrThrow(d.installments, id, 'Parcelamento');
    const set = new Set(inst.paid);
    if (paid) set.add(n); else set.delete(n);
    inst.paid = [...set].filter((x) => x >= 1 && x <= inst.count).sort((a, b) => a - b);
  });
}

// ---------- Pagar / desfazer (qualquer item do mês) ----------

/**
 * Marca um item do mês como pago (ou desfaz).
 * `item` vem de ledger.monthItems().
 */
export function setItemPaid(item, paid, paidAt = todayISO()) {
  if (item.kind === 'expense') {
    return store.commit((d) => {
      const e = findOrThrow(d.expenses, item.refId, 'Despesa');
      e.paidAt = paid ? paidAt : null;
    });
  }
  if (item.kind === 'recurring') {
    return store.commit((d) => {
      const rec = findOrThrow(d.recurring, item.refId, 'Recorrente');
      const [key, e] = entry(d, item.refId, ymOf(item.dueDate));
      e.paidAt = paid ? paidAt : null;
      // Fixa o valor pago: editar a recorrente depois não altera meses já pagos
      if (paid) e.cents ??= rec.cents;
      cleanupEntry(d, key);
    });
  }
  if (item.kind === 'installment') {
    return setParcelPaid(item.refId, item.parcel.n, paid);
  }
  throw new ValidationError('Tipo de item desconhecido.');
}

// ---------- Metas ----------

export function saveGoal(input) {
  return store.commit((d) => {
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      targetCents: cents(input.targetCents, 'targetCents'),
      deadline: date(input.deadline, 'deadline', { required: false }),
      icon: text(input.icon || '🎯', 'icon', 'o ícone', { max: 8 }),
    };
    if (input.id) {
      Object.assign(findOrThrow(d.goals, input.id, 'Meta'), item);
    } else {
      const goal = { id: newId(), ...item, contributions: [] };
      if (Number.isInteger(input.initialCents) && input.initialCents > 0) {
        goal.contributions.push({ id: newId(), date: todayISO(), cents: cents(input.initialCents, 'initialCents') });
      }
      d.goals.push(goal);
    }
  });
}

export function deleteGoal(id) {
  return store.commit((d) => { d.goals = d.goals.filter((g) => g.id !== id); });
}

/** Guarda (positivo) ou retira (negativo) dinheiro de uma meta. */
export function addContribution(goalId, value, when = todayISO()) {
  return store.commit((d) => {
    const goal = findOrThrow(d.goals, goalId, 'Meta');
    if (!Number.isInteger(value) || value === 0 || Math.abs(value) > MAX_CENTS) throw new ValidationError('Informe um valor.', 'cents');
    date(when, 'date');
    const saved = goal.contributions.reduce((a, c) => a + c.cents, 0);
    if (saved + value < 0) throw new ValidationError('A retirada é maior que o valor guardado.', 'cents');
    goal.contributions.push({ id: newId(), date: when, cents: value });
  });
}

export function deleteContribution(goalId, contributionId) {
  return store.commit((d) => {
    const goal = findOrThrow(d.goals, goalId, 'Meta');
    const rest = goal.contributions.filter((c) => c.id !== contributionId);
    if (rest.reduce((a, c) => a + c.cents, 0) < 0) {
      throw new ValidationError('Remova antes as retiradas: o saldo da meta ficaria negativo.');
    }
    goal.contributions = rest;
  });
}

// ---------- Investimentos ----------

/** Cria ou edita um investimento. Novo: aceita um aporte inicial ({ initialCents, initialDate }). */
export function saveInvestment(input) {
  return store.commit((d) => {
    d.investments ||= [];
    if (!INVEST_TYPES[input.type]) throw new ValidationError('Escolha o tipo de investimento.', 'type');
    const kind = RATE_KINDS[input.rateKind] ? input.rateKind : 'none';
    const needsBp = kind === 'cdi' || kind === 'pre' || kind === 'ipca';
    if (needsBp && (!Number.isInteger(input.rateBp) || input.rateBp <= 0 || input.rateBp > 50000)) {
      throw new ValidationError('Informe a taxa (ex.: 100 para 100% do CDI).', 'rateBp');
    }
    const item = {
      name: text(input.name, 'name', 'o nome', { max: 80 }),
      type: input.type,
      institution: text(input.institution, 'institution', 'a instituição', { max: 60, required: false }),
      rate: { kind, bp: needsBp ? input.rateBp : 0 },
      liquidity: LIQUIDITY[input.liquidity] ? input.liquidity : 'none',
      maturity: date(input.maturity, 'maturity', { required: false }),
      emergency: input.emergency === true,
      notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }),
    };
    if (input.id) {
      Object.assign(findOrThrow(d.investments, input.id, 'Investimento'), item);
      return;
    }
    const inv = { id: newId(), ...item, movements: [] };
    if (Number.isInteger(input.initialCents) && input.initialCents > 0) {
      inv.movements.push({ id: newId(), kind: 'aporte', date: date(input.initialDate || todayISO(), 'initialDate'), cents: cents(input.initialCents, 'initialCents'), note: '' });
    }
    d.investments.push(inv);
    return inv;
  });
}

export function deleteInvestment(id) {
  return store.commit((d) => { d.investments = (d.investments || []).filter((x) => x.id !== id); });
}

/**
 * Registra um movimento: aporte, resgate, provento ou atualização de saldo.
 * Com `asExpense`, o aporte também vira um gasto pago no mês
 * (categoria Investimentos) e sai do saldo do mês.
 */
export function addInvestmentMovement(investmentId, input) {
  return store.commit((d) => {
    const inv = findOrThrow(d.investments || [], investmentId, 'Investimento');
    if (!MOVEMENT_KINDS[input.kind]) throw new ValidationError('Tipo de movimento inválido.');
    const when = date(input.date, 'date');
    if (when > todayISO()) throw new ValidationError('A data não pode ser no futuro.', 'date');
    const value = cents(input.cents, 'cents', { allowZero: input.kind === 'saldo' });
    if (input.kind === 'resgate') {
      const { value: available } = positionAt(inv, investingOf(d.settings), when);
      if (value > available) throw new ValidationError(`O resgate é maior que o saldo nessa data (${formatBRLPlain(available)}).`, 'cents');
    }
    const mov = { id: newId(), kind: input.kind, date: when, cents: value, note: text(input.note, 'note', 'a observação', { max: 120, required: false }) };
    if (input.kind === 'aporte' && input.asExpense) {
      assertOpen(d, ymOf(when), 'date');
      const cat = d.categories.find((c) => /investimento/i.test(c.name));
      const expense = {
        id: newId(), description: `Aporte: ${inv.name}`.slice(0, 120), cents: value, dueDate: when, paidAt: when,
        categoryId: cat?.id || null, subcategoryId: null, creditorId: null, notes: 'Lançado pela tela Investimentos',
      };
      d.expenses.push(expense);
      mov.expenseId = expense.id;
    }
    inv.movements.push(mov);
    return mov;
  });
}

/** Remove um movimento (e o gasto do mês ligado a ele, se o mês estiver aberto). */
export function deleteInvestmentMovement(investmentId, movementId) {
  return store.commit((d) => {
    const inv = findOrThrow(d.investments || [], investmentId, 'Investimento');
    const mov = findOrThrow(inv.movements, movementId, 'Movimento');
    inv.movements = inv.movements.filter((m) => m.id !== movementId);
    // Sem o aporte, um resgate posterior pode ficar maior que o saldo
    const investing = investingOf(d.settings);
    for (const m of inv.movements.filter((x) => x.kind === 'resgate')) {
      const before = positionAt({ ...inv, movements: inv.movements.filter((x) => x.id !== m.id) }, investing, m.date).value;
      if (m.cents > before + 1) throw new ValidationError('Remova antes os resgates feitos depois: o saldo ficaria negativo.');
    }
    if (mov.expenseId) {
      const exp = d.expenses.find((x) => x.id === mov.expenseId);
      if (exp && !d.closedMonths[ymOf(exp.dueDate)]) d.expenses = d.expenses.filter((x) => x.id !== exp.id);
    }
  });
}

/** Premissas da carteira: CDI, IPCA, meta de aporte e carteira ideal (% por classe, soma 100). */
export function saveInvestingSettings(input) {
  return store.commit((d) => {
    const bp = (v, field, label) => {
      if (!Number.isInteger(v) || v < 0 || v > 10000) throw new ValidationError(`${label} deve ser entre 0 e 100%.`, field);
      return v;
    };
    const targets = {};
    for (const [k, v] of Object.entries(input.targets || {})) {
      if (!CLASS_KEYS.includes(k) || !v) continue;
      if (!Number.isInteger(v) || v < 0 || v > 100) throw new ValidationError('Use percentuais inteiros entre 0 e 100.', `target-${k}`);
      targets[k] = v;
    }
    const total = Object.values(targets).reduce((a, n) => a + n, 0);
    if (total && total !== 100) throw new ValidationError(`A carteira ideal soma ${total}%: precisa somar 100% (ou deixe tudo vazio).`, 'targets');
    d.settings.investing = {
      cdiBp: bp(input.cdiBp, 'cdi', 'O CDI'),
      ipcaBp: bp(input.ipcaBp, 'ipca', 'O IPCA'),
      monthlyTargetCents: cents(input.monthlyTargetCents || 0, 'monthlyTargetCents', { allowZero: true }),
      targets,
    };
  });
}

const formatBRLPlain = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------- Credores ----------

export function saveCreditor(input) {
  return store.commit((d) => {
    const name = text(input.name, 'name', 'o nome', { max: 80 });
    const dup = d.creditors.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== input.id);
    if (dup) throw new ValidationError('Já existe um credor com esse nome.', 'name');
    const item = { name, notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }) };
    if (input.id) Object.assign(findOrThrow(d.creditors, input.id, 'Credor'), item);
    else { const c = { id: newId(), ...item }; d.creditors.push(c); return c; }
  });
}

/** Remove o credor e limpa a referência em todos os lançamentos. */
export function deleteCreditor(id) {
  return store.commit((d) => {
    d.creditors = d.creditors.filter((c) => c.id !== id);
    for (const list of [d.expenses, d.recurring, d.installments]) {
      for (const x of list) if (x.creditorId === id) x.creditorId = null;
    }
  });
}

// ---------- Categorias ----------

export function saveCategory(input) {
  return store.commit((d) => {
    const name = text(input.name, 'name', 'o nome', { max: 60 });
    const dup = d.categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== input.id);
    if (dup) throw new ValidationError('Já existe uma categoria com esse nome.', 'name');
    const item = {
      name,
      icon: text(input.icon || '🏷️', 'icon', 'o ícone', { max: 8 }),
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : CATEGORY_COLORS[d.categories.length % CATEGORY_COLORS.length],
    };
    if (input.id) Object.assign(findOrThrow(d.categories, input.id, 'Categoria'), item);
    else { const c = { id: newId(), ...item, subcategories: [] }; d.categories.push(c); return c; }
  });
}

/** Remove a categoria; lançamentos ficam "Sem categoria". */
export function deleteCategory(id) {
  return store.commit((d) => {
    d.categories = d.categories.filter((c) => c.id !== id);
    for (const list of [d.expenses, d.recurring, d.installments]) {
      for (const x of list) if (x.categoryId === id) { x.categoryId = null; x.subcategoryId = null; }
    }
  });
}

export function saveSubcategory(categoryId, input) {
  return store.commit((d) => {
    const cat = findOrThrow(d.categories, categoryId, 'Categoria');
    const name = text(input.name, 'name', 'o nome', { max: 60 });
    if (cat.subcategories.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== input.id)) {
      throw new ValidationError('Essa subcategoria já existe.', 'name');
    }
    if (input.id) findOrThrow(cat.subcategories, input.id, 'Subcategoria').name = name;
    else cat.subcategories.push({ id: newId(), name });
  });
}

export function deleteSubcategory(categoryId, subId) {
  return store.commit((d) => {
    const cat = findOrThrow(d.categories, categoryId, 'Categoria');
    cat.subcategories = cat.subcategories.filter((s) => s.id !== subId);
    for (const list of [d.expenses, d.recurring, d.installments]) {
      for (const x of list) if (x.subcategoryId === subId) x.subcategoryId = null;
    }
  });
}

/**
 * Restaura as categorias padrão. Categorias com o mesmo nome são
 * mantidas (mesmo id), então os lançamentos não perdem a categoria.
 * Categorias criadas por você também são mantidas.
 */
export function restoreDefaultCategories() {
  return store.commit((d) => {
    const defaults = createDefaultCategories();
    for (const def of defaults) {
      const existing = d.categories.find((c) => c.name.toLowerCase() === def.name.toLowerCase());
      if (!existing) { d.categories.push(def); continue; }
      for (const sub of def.subcategories) {
        if (!existing.subcategories.some((s) => s.name.toLowerCase() === sub.name.toLowerCase())) {
          existing.subcategories.push(sub);
        }
      }
    }
  });
}

// ---------- Fechamento de mês ----------

export function closeMonth(ym) {
  return store.commit((d) => {
    if (!isValidYM(ym)) throw new ValidationError('Mês inválido.');
    if (ym > currentYM()) throw new ValidationError('Só é possível fechar o mês atual ou meses anteriores.');
    if (d.closedMonths[ym]) throw new ValidationError(`${formatMonth(ym)} já está fechado.`);
    // Fixa o valor das recorrentes do mês: editar a recorrente depois não muda o mês fechado
    for (const r of d.recurring) {
      if (!recurringActiveIn(r, ym)) continue;
      const [, e] = entry(d, r.id, ym);
      if (!e.skipped) e.cents ??= r.cents;
    }
    d.closedMonths[ym] = buildSnapshot(d, ym);
  });
}

export function reopenMonth(ym) {
  return store.commit((d) => { delete d.closedMonths[ym]; });
}

// ---------- Data do pagamento ----------

/** Dia fixo (salaryDay) ou N-ésimo dia útil. */
export function savePayday({ mode, salaryDay, nth = 5, saturday = true, nextMonth = false }) {
  return store.commit((d) => {
    d.settings.payday = {
      mode: mode === 'business' ? 'business' : 'fixed',
      nth: intRange(nth, 'nth', 1, 10, 'O dia útil'),
      saturday: Boolean(saturday),
      nextMonth: Boolean(nextMonth),
    };
    if (salaryDay != null) d.settings.salaryDay = intRange(salaryDay, 'salaryDay', 1, 31, 'O dia');
  });
}

// ---------- Férias ----------

export function saveVacation(input) {
  return store.commit((d) => {
    const v = {
      id: input.id || newId(),
      start: date(input.start, 'start'),
      days: intRange(input.days, 'days', 5, 30, 'Os dias de férias'),
      sellDays: intRange(input.sellDays ?? 0, 'sellDays', 0, 10, 'Os dias vendidos'),
      advance13: Boolean(input.advance13),
    };
    if (v.days + v.sellDays > 30) throw new ValidationError('Férias + dias vendidos não podem passar de 30.', 'sellDays');
    const other = (d.settings.vacations || []).find((x) => x.id !== v.id && x.start.slice(0, 7) === v.start.slice(0, 7));
    if (other) throw new ValidationError('Já existem férias começando neste mês.', 'start');
    d.settings.vacations = [...(d.settings.vacations || []).filter((x) => x.id !== v.id), v].sort((a, b) => a.start.localeCompare(b.start));
  });
}

export function deleteVacation(id) {
  return store.commit((d) => { d.settings.vacations = (d.settings.vacations || []).filter((x) => x.id !== id); });
}

// ---------- Orçamento por categoria ----------

/** Limite mensal para a categoria (0 = sem orçamento). */
export function setBudget(categoryId, value) {
  return store.commit((d) => {
    findOrThrow(d.categories, categoryId, 'Categoria');
    d.settings.budgets ||= {};
    if (!value) delete d.settings.budgets[categoryId];
    else d.settings.budgets[categoryId] = cents(value, 'budget');
  });
}

// ---------- Regras de categorização ----------

export function saveRule(input) {
  return store.commit((d) => {
    const pattern = text(input.pattern, 'pattern', 'o texto da regra', { max: 60 });
    const cat = findOrThrow(d.categories, input.categoryId, 'Categoria');
    const rule = { id: input.id || newId(), pattern, categoryId: cat.id, subcategoryId: cat.subcategories.some((x) => x.id === input.subcategoryId) ? input.subcategoryId : null };
    d.settings.rules = [...(d.settings.rules || []).filter((r) => r.id !== rule.id && r.pattern.toLowerCase() !== pattern.toLowerCase()), rule];
  });
}

export function deleteRule(id) {
  return store.commit((d) => { d.settings.rules = (d.settings.rules || []).filter((r) => r.id !== id); });
}

// ---------- Importação de extrato ----------

/**
 * Importa transações revisadas na tela de importação.
 * rows: [{ date, description, cents (>0 gasto, <0 entrada), categoryId, subcategoryId, fingerprint }]
 * Gastos viram despesas JÁ PAGAS; entradas viram renda extra (fora da folha).
 * Meses fechados são ignorados. Retorna { expenses, incomes, skipped }.
 */
export function importTransactions(rows) {
  return store.commit((d) => {
    const seen = new Set(d.importFingerprints || []);
    const out = { expenses: 0, incomes: 0, skipped: 0 };
    for (const r of rows) {
      if (!isValidISO(r.date) || !Number.isInteger(r.cents) || !r.cents || seen.has(r.fingerprint) || d.closedMonths[ymOf(r.date)]) {
        out.skipped++;
        continue;
      }
      const description = String(r.description || 'Lançamento').trim().replace(/\s+/g, ' ').slice(0, 120);
      if (r.cents > 0) {
        const cat = d.categories.find((c) => c.id === r.categoryId);
        d.expenses.push({
          id: newId(), description, cents: Math.min(r.cents, MAX_CENTS), dueDate: r.date, paidAt: r.date,
          categoryId: cat ? cat.id : null, subcategoryId: cat?.subcategories.some((x) => x.id === r.subcategoryId) ? r.subcategoryId : null,
          creditorId: null, notes: 'Importado do extrato',
        });
        out.expenses++;
      } else {
        d.extraIncomes.push({ id: newId(), ym: ymOf(r.date), description, cents: Math.min(-r.cents, MAX_CENTS), date: r.date, payroll: false });
        out.incomes++;
      }
      if (r.fingerprint) seen.add(r.fingerprint);
    }
    d.importFingerprints = [...seen].slice(-5000);
    return out;
  });
}

// ---------- Lembretes ----------

export function setReminders({ enabled, daysBefore = 1 }) {
  return store.commit((d) => {
    d.settings.reminders = { enabled: Boolean(enabled), daysBefore: intRange(daysBefore, 'daysBefore', 0, 7, 'A antecedência') };
  });
}

// ---------- Afastamentos e faltas ----------

/** kind: 'atestado' (empresa paga até 15 dias) | 'inss' (afastado pelo INSS) | 'falta' */
export function saveAbsence(input) {
  return store.commit((d) => {
    if (!isValidYM(input.ym)) throw new ValidationError('Mês inválido.', 'ym');
    assertOpen(d, input.ym);
    const a = {
      id: input.id || newId(),
      ym: input.ym,
      kind: ['atestado', 'inss', 'falta'].includes(input.kind) ? input.kind : 'atestado',
      days: intRange(input.days, 'days', 1, 30, 'Os dias'),
      note: String(input.note || '').trim().slice(0, 80),
    };
    const others = (d.settings.absences || []).filter((x) => x.id !== a.id && x.ym === a.ym).reduce((s, x) => s + x.days, 0);
    if (others + a.days > 30) throw new ValidationError('O mês não tem tantos dias (máximo 30 somando tudo).', 'days');
    d.settings.absences = [...(d.settings.absences || []).filter((x) => x.id !== a.id), a];
  });
}

export function deleteAbsence(id) {
  return store.commit((d) => { d.settings.absences = (d.settings.absences || []).filter((x) => x.id !== id); });
}

// ---------- Importar holerite ----------

/**
 * Aplica um plano de importação (domain/payslip.js) no estado `d`.
 * Usado na prévia (numa cópia) e na importação de verdade.
 */
export function applyPayslipTo(d, plan) {
  const ym = plan.competence;
  if (!isValidYM(ym)) throw new ValidationError('Não encontrei a competência (mês/ano) do holerite. Informe o mês.');
  assertOpen(d, ym);
  const s = d.settings;
  const items = plan.items.filter((x) => x.include);
  const nameOf = (x) => friendlyName(x.description);
  const sameName = (a, b) => normalizeName(a) === normalizeName(b);

  // Salário base (vale a partir da competência)
  if (plan.baseSalary > 0) {
    const current = payrollProfileFor(s, ym);
    if (!current || current.legacyNet || current.grossCents !== plan.baseSalary) {
      const p = profileAt(d, ym);
      p.grossCents = plan.baseSalary;
      delete p.legacyNet;
      putProfile(d, p);
    }
  }
  if (plan.admission && isValidISO(plan.admission)) s.employment = { ...(s.employment || {}), admission: plan.admission };

  const profile = () => payrollProfileFor(s, ym);
  const findFixed = (kind, x, keyRe) => {
    const list = kind === 'add' ? profile()?.additions || [] : profile()?.deductions || [];
    return list.find((l) => sameName(l.description, nameOf(x)) || (keyRe && keyRe.test(normalizeName(l.description))));
  };
  const findVar = (kind, x) => (s.payrollVariable || []).find((l) => l.ym === ym && l.kind === kind && sameName(l.description, nameOf(x)));

  // Afastamentos do mês: substitui os do mesmo tipo
  const absences = [];
  for (const x of items) {
    if (x.action === 'sick') absences.push({ kind: 'atestado', days: x.params.days });
    if (x.action === 'inss-days') absences.push({ kind: 'inss', days: x.params.days });
    if (x.action === 'falta') absences.push({ kind: 'falta', days: x.params.days });
  }
  if (absences.length) {
    const kinds = new Set(absences.map((a) => a.kind));
    s.absences = [...(s.absences || []).filter((a) => !(a.ym === ym && kinds.has(a.kind))),
      ...absences.map((a) => ({ id: newId(), ym, kind: a.kind, days: Math.min(30, a.days), note: 'importado do holerite' }))];
  }

  for (const x of items) {
    const cents = x.provento || x.desconto;
    switch (x.action) {
      case 'percent': {
        const key = /periculosidade|insalubridade|gratifica/.exec(normalizeName(x.description));
        const old = findFixed('add', x, key ? new RegExp(key[0]) : null);
        upsertPayrollLine(d, ym, 'add', { id: old?.id, description: old?.description || nameOf(x), mode: 'percent', value: x.params.value, base: x.params.base, taxable: true, variable: false });
        break;
      }
      case 'hours': {
        const old = findVar('add', x);
        upsertPayrollLine(d, ym, 'add', { id: old?.id, description: nameOf(x), mode: 'hours', value: x.params.minutes, hourKind: x.params.hourKind, dsr: x.params.dsr, taxable: true, variable: true });
        break;
      }
      case 'addition': {
        const old = x.params.variable ? findVar('add', x) : findFixed('add', x);
        upsertPayrollLine(d, ym, 'add', { id: old?.id, description: nameOf(x), mode: 'fixed', value: cents, taxable: true, variable: x.params.variable });
        break;
      }
      case 'deduction': {
        const old = x.params.variable ? findVar('ded', x) : findFixed('ded', x);
        upsertPayrollLine(d, ym, 'ded', { id: old?.id, description: nameOf(x), mode: 'fixed', value: cents, irDeductible: x.params.irDeductible, variable: x.params.variable });
        break;
      }
      case 'loan': {
        const existing = (s.payrollLoans || []).find((l) => l.id === x.params.existingId);
        const count = Number(x.params.count) || existing?.loan?.count;
        const paid = x.params.paid === '' || x.params.paid == null ? null : Number(x.params.paid);
        if (!count) throw new ValidationError(`Informe o nº de parcelas de "${nameOf(x)}".`);
        const startYM = paid != null ? addMonthsYM(ym, -paid) : existing?.loan?.startYM || ym;
        upsertPayrollLine(d, ym, 'ded', { id: existing?.id, description: existing?.description || nameOf(x), mode: 'fixed', value: cents, irDeductible: false, loan: { count, startYM } });
        break;
      }
      case 'family':
        s.employment = { ...(s.employment || {}), familyChildren: x.params.children };
        break;
      default: break;
    }
  }

  d.settings.actualNet ||= {};
  if (plan.useNet && plan.net > 0) d.settings.actualNet[ym] = plan.net;
}

export function importPayslip(plan) {
  return store.commit((d) => applyPayslipTo(d, plan));
}
