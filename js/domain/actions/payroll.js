// =============================================================
// actions/payroll.js — Salário, holerite, férias, afastamentos,
// plantões, benefícios, outros vínculos, FGTS e tabelas de IR
// -------------------------------------------------------------
// O perfil salarial vale a partir de um mês (`from`). Editar o salário
// "a partir de outubro" cria/atualiza o perfil de outubro; os meses
// anteriores não mudam.
// =============================================================

import { store } from '../../core/store.js';
import { isValidISO, isValidYM, ymOf, addMonthsYM } from '../../core/dates.js';
import { newId, createEmptyState } from '../schema.js';
import { payrollProfileFor } from '../payroll.js';
import { friendlyName, normalizeName } from '../payslip.js';
import { ValidationError, text, cents, date, month, intRange, assertOpen, findOrThrow } from './core.js';

// ---------- Perfil salarial ----------

/** Valida uma linha de adicional ('add') ou desconto ('ded'). */
function payrollLine(x, kind) {
  const label = kind === 'add' ? 'o adicional' : 'o desconto';
  const description = text(x.description, 'description', `a descrição d${label.slice(1)}`, { max: 60 });
  if (x.mode === 'percent') {
    if (!Number.isInteger(x.value) || x.value <= 0 || x.value > 100000) throw new ValidationError('Percentual inválido.', 'value');
  } else if (x.mode === 'hours') {
    // Sobreaviso fixo: R$ 0,00 no perfil (as horas vêm a cada mês)
    const onCallFixed = x.hourKind === 'sobreaviso' && !x.ym && !x.variable;
    if (onCallFixed) x = { ...x, value: 0 };
    else if (!Number.isInteger(x.value) || x.value <= 0 || x.value > 744 * 60) throw new ValidationError('Informe as horas (ex.: 10 ou 10:30).', 'value');
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
export function savePayrollBase({ fromYM, grossCents, dependents = 0, salaryDay, note }) {
  return store.commit((d) => {
    if (!isValidYM(fromYM)) throw new ValidationError('Mês inválido.', 'fromYM');
    const profile = profileAt(d, fromYM);
    profile.grossCents = cents(grossCents, 'grossCents', { allowZero: true });
    profile.dependents = intRange(dependents, 'dependents', 0, 20, 'Dependentes');
    if (note !== undefined) {
      const n = text(note, 'note', 'o motivo', { max: 120, required: false });
      if (n) profile.note = n; else delete profile.note;
    }
    delete profile.legacyNet; // agora o salário é bruto e os impostos são calculados
    if (salaryDay != null) d.settings.salaryDay = intRange(salaryDay, 'salaryDay', 1, 31, 'O dia');
    putProfile(d, profile);
  });
}

/**
 * Cria ou edita um adicional ('add') ou desconto ('ded') a partir do mês `ym`.
 *  • Linhas comuns valem do mês `ym` em diante: entram no perfil de `ym`
 *    e também em todos os perfis posteriores.
 *  • Descontos parcelados (consignado) vão para settings.payrollLoans e
 *    valem em todo mês entre a 1ª e a última parcela.
 */
export function savePayrollLine(ym, kind, input) {
  return store.commit((d) => upsertPayrollLine(d, ym, kind, input));
}

/** Inclui/atualiza uma linha do contracheque no estado `d` (usado também na importação). */
function upsertPayrollLine(d, ym, kind, input) {
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
    return line;
  }
  if (line.loan) {
    for (const p of d.settings.salaryHistory) p.deductions = p.deductions.filter((x) => x.id !== line.id);
    d.settings.payrollLoans.push(line);
    return line;
  }

  for (const p of d.settings.salaryHistory) {
    if (p.from < ym) continue;
    const list = kind === 'add' ? p.additions : p.deductions;
    const i = list.findIndex((x) => x.id === line.id);
    if (i >= 0) list[i] = line; else list.push(line);
  }
  return line;
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
  }, 'change', { undo: 'Item do salário removido' });
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
  }, 'change', { undo: 'Registro de salário removido' });
}

/**
 * Apaga SÓ a parte do salário. Contas, cartões, metas, investimentos,
 * categorias e o resto do app ficam intactos. Pode ser desfeito.
 *   sempre      perfis salariais (bruto, adicionais, descontos), consignados,
 *               variáveis do mês, vínculo (admissão, regime, 13º), líquidos
 *               conferidos, horas de sobreaviso, dia do pagamento
 *   vacations   férias, faltas e afastamentos
 *   shifts      escala de plantões, tipos de plantão e rendas pagas na folha
 *   benefits    PLR/abono/VA-VR, outros vínculos, saldo do FGTS e dados do IR anual
 * As tabelas de INSS/IR que você adicionou continuam (servem para qualquer salário).
 */
export function clearSalaryData({ vacations = true, shifts = false, benefits = false } = {}) {
  const blank = createEmptyState().settings;
  return store.commit((d) => {
    const s = d.settings;
    s.salaryHistory = [];
    s.payrollLoans = [];
    s.payrollVariable = [];
    s.employment = blank.employment;
    s.actualNet = {};
    s.onCallHours = {};
    s.payday = blank.payday;
    s.salaryDay = blank.salaryDay;
    s.salaryAccountId = null;
    if (s.onboardingSteps) delete s.onboardingSteps.salary;
    if (vacations) { s.vacations = []; s.absences = []; }
    if (shifts) {
      d.shifts = [];
      s.shiftTypes = blank.shiftTypes;
      d.extraIncomes = d.extraIncomes.filter((x) => !x.payroll);
    }
    if (benefits) { s.benefits = []; s.jobs = []; s.fgts = blank.fgts; s.irpf = blank.irpf; }
  }, 'change', { undo: 'Dados do salário apagados' });
}

/** Horas de sobreaviso cumpridas no mês (minutos; null volta para as horas típicas). */
export function setOnCallHours(ym, lineId, minutes) {
  return store.commit((d) => {
    d.settings.onCallHours ||= {};
    const hours = (d.settings.onCallHours[ym] ||= {});
    if (minutes == null) delete hours[lineId];
    else hours[lineId] = Math.max(0, Math.min(744 * 60, Math.round(minutes)));
    if (!Object.keys(hours).length) delete d.settings.onCallHours[ym];
  }, 'Horas de sobreaviso');
}

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

// ---------- Renda extra / receitas ----------

const INCOME_KINDS = ['extra', 'plantao', 'reembolso', 'venda', 'presente', 'rendimento', 'freela', 'outro'];

export function saveExtraIncome(input) {
  return store.commit((d) => {
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: cents(input.cents, 'cents'),
      date: date(input.date, 'date'),
      payroll: Boolean(input.payroll), // pago na folha = valor bruto, sofre INSS/IR
      kind: INCOME_KINDS.includes(input.kind) ? input.kind : (input.payroll ? 'plantao' : 'extra'),
      accountId: (d.accounts || []).some((a) => a.id === input.accountId) ? input.accountId : null,
    };
    if (item.payroll && !['plantao', 'extra'].includes(item.kind)) item.payroll = false; // reembolso, venda… não passam pela folha
    item.ym = ymOf(item.date);
    assertOpen(d, item.ym, 'date');
    if (input.id) {
      const current = findOrThrow(d.extraIncomes, input.id, 'Renda');
      assertOpen(d, current.ym, 'date');
      Object.assign(current, item);
      return current;
    }
    const created = { id: newId(), ...item };
    d.extraIncomes.push(created);
    return created;
  });
}

export function deleteExtraIncome(id) {
  return store.commit((d) => {
    const item = findOrThrow(d.extraIncomes, id, 'Renda');
    assertOpen(d, item.ym);
    d.extraIncomes = d.extraIncomes.filter((x) => x.id !== id);
  }, 'change', { undo: 'Renda excluída' });
}

// ---------- Ganhos extras recorrentes (fora da folha) ----------

/**
 * Renda que se repete todo mês e NÃO vem do empregador (aluguel
 * recebido, pensão, freela fixo). Valor líquido: não passa pela folha.
 * input = { id?, description, cents, day, startYM, endYM?, kind, accountId? }
 */
export function saveRecurringIncome(input) {
  return store.commit((d) => {
    d.recurringIncomes ||= [];
    const startYM = month(input.startYM, 'startYM');
    const endYM = month(input.endYM, 'endYM', { required: false });
    if (endYM && endYM < startYM) throw new ValidationError('O fim precisa ser depois do início.', 'endYM');
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: cents(input.cents, 'cents'),
      day: intRange(input.day, 'day', 1, 31, 'O dia'),
      startYM,
      endYM,
      kind: INCOME_KINDS.includes(input.kind) && input.kind !== 'plantao' ? input.kind : 'extra',
      accountId: (d.accounts || []).some((a) => a.id === input.accountId) ? input.accountId : null,
    };
    if (input.id) {
      const current = findOrThrow(d.recurringIncomes, input.id, 'Renda recorrente');
      Object.assign(current, item);
      return current;
    }
    const created = { id: newId(), ...item, skipped: [] };
    d.recurringIncomes.push(created);
    return created;
  });
}

export function deleteRecurringIncome(id) {
  return store.commit((d) => {
    findOrThrow(d.recurringIncomes || [], id, 'Renda recorrente');
    d.recurringIncomes = d.recurringIncomes.filter((x) => x.id !== id);
  }, 'change', { undo: 'Renda recorrente excluída' });
}

/** Pula (ou volta a contar) a renda recorrente num mês. */
export function skipRecurringIncomeMonth(id, ym, skip = true) {
  return store.commit((d) => {
    const r = findOrThrow(d.recurringIncomes || [], id, 'Renda recorrente');
    assertOpen(d, month(ym, 'ym'), 'ym');
    const set = new Set(r.skipped || []);
    if (skip) set.add(ym); else set.delete(ym);
    r.skipped = [...set].sort();
  });
}

// ---------- Férias e afastamentos ----------

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
  return store.commit((d) => { d.settings.vacations = (d.settings.vacations || []).filter((x) => x.id !== id); }, 'change', { undo: 'Férias removidas' });
}

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
  return store.commit((d) => { d.settings.absences = (d.settings.absences || []).filter((x) => x.id !== id); }, 'change', { undo: 'Afastamento removido' });
}

// ---------- Escala de plantões ----------

export function saveShiftType(input) {
  return store.commit((d) => {
    const t = {
      id: input.id || newId(),
      name: text(input.name, 'name', 'o nome do plantão', { max: 40 }),
      hours: intRange(input.hours, 'hours', 1, 48, 'As horas'),
      cents: cents(input.cents, 'cents', { allowZero: true }),
      payroll: input.payroll !== false,
      night: Boolean(input.night),
      weekend: Boolean(input.weekend),
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#0D9488',
    };
    const list = d.settings.shiftTypes || [];
    const i = list.findIndex((x) => x.id === t.id);
    if (i >= 0) list[i] = t; else list.push(t);
    d.settings.shiftTypes = list;
    return t;
  });
}

export function deleteShiftType(id) {
  return store.commit((d) => {
    if ((d.shifts || []).some((s) => s.typeId === id)) throw new ValidationError('Há plantões desse tipo na escala. Remova-os antes.');
    d.settings.shiftTypes = (d.settings.shiftTypes || []).filter((t) => t.id !== id);
  }, 'change', { undo: 'Tipo de plantão removido' });
}

/** Marca um plantão (ou vários dias de uma vez). */
export function addShifts(dates, typeId, { note = '', cents: value = null } = {}) {
  return store.commit((d) => {
    findOrThrow(d.settings.shiftTypes, typeId, 'Tipo de plantão');
    const list = (Array.isArray(dates) ? dates : [dates]).map((x) => date(x, 'date'));
    for (const day of list) {
      assertOpen(d, ymOf(day), 'date');
      d.shifts.push({ id: newId(), date: day, typeId, note: String(note || '').slice(0, 80), ...(Number.isInteger(value) && value > 0 ? { cents: value } : {}) });
    }
    return list.length;
  });
}

export function deleteShift(id) {
  return store.commit((d) => {
    const s = findOrThrow(d.shifts, id, 'Plantão');
    assertOpen(d, ymOf(s.date), 'date');
    d.shifts = d.shifts.filter((x) => x.id !== id);
  }, 'change', { undo: 'Plantão removido' });
}

// ---------- Benefícios e outros vínculos ----------

export function saveBenefit(input) {
  return store.commit((d) => {
    const kind = ['va', 'vr', 'plr', 'abono', 'outro'].includes(input.kind) ? input.kind : 'outro';
    const b = {
      id: input.id || newId(), kind,
      name: text(input.name, 'name', 'o nome', { max: 60 }),
      cents: cents(input.cents, 'cents'),
      monthly: kind === 'va' || kind === 'vr' ? true : Boolean(input.monthly),
      month: kind === 'va' || kind === 'vr' || input.monthly ? null : intRange(input.month, 'month', 1, 12, 'O mês'),
      year: input.year ? intRange(input.year, 'year', 2000, 2100, 'O ano') : null,
    };
    d.settings.benefits = [...(d.settings.benefits || []).filter((x) => x.id !== b.id), b];
  });
}

export function deleteBenefit(id) {
  return store.commit((d) => { d.settings.benefits = (d.settings.benefits || []).filter((x) => x.id !== id); }, 'change', { undo: 'Benefício removido' });
}

export function saveJob(input) {
  return store.commit((d) => {
    const kind = ['clt', 'pj', 'servidor', 'autonomo'].includes(input.kind) ? input.kind : 'clt';
    const j = {
      id: input.id || newId(), kind,
      name: text(input.name, 'name', 'o nome do vínculo', { max: 60 }),
      grossCents: cents(input.grossCents, 'grossCents'),
      regime: kind === 'servidor' ? 'fixed' : 'inss',
      fixedRateBp: kind === 'servidor' ? intRange(input.fixedRateBp ?? 1400, 'fixedRate', 0, 5000, 'A alíquota') : 1400,
      pjTaxBp: kind === 'pj' ? intRange(input.pjTaxBp ?? 600, 'pjTax', 0, 5000, 'O imposto') : 0,
      day: intRange(input.day ?? 5, 'day', 1, 31, 'O dia do pagamento'),
      from: input.from && isValidYM(input.from) ? input.from : null,
      to: input.to && isValidYM(input.to) ? input.to : null,
    };
    if (j.from && j.to && j.to < j.from) throw new ValidationError('O fim deve ser depois do início.', 'to');
    d.settings.jobs = [...(d.settings.jobs || []).filter((x) => x.id !== j.id), j];
  });
}

export function deleteJob(id) {
  return store.commit((d) => { d.settings.jobs = (d.settings.jobs || []).filter((x) => x.id !== id); }, 'change', { undo: 'Vínculo removido' });
}

// ---------- FGTS, IR anual e tabelas ----------

export function saveFgts({ balanceCents, date: when }) {
  return store.commit((d) => {
    d.settings.fgts = { balanceCents: cents(balanceCents, 'balanceCents', { allowZero: true }), date: date(when, 'date') };
  });
}

export function saveIrpfSettings({ otherDeductibleCents = 0, educationCents = 0, pensionCents = 0 }) {
  return store.commit((d) => {
    d.settings.irpf = {
      otherDeductibleCents: cents(otherDeductibleCents, 'other', { allowZero: true }),
      educationCents: cents(educationCents, 'education', { allowZero: true }),
      pensionCents: cents(pensionCents, 'pension', { allowZero: true }),
    };
  });
}

/**
 * Cadastra (ou troca) as tabelas de INSS/IR de um ano. `table` no mesmo
 * formato de domain/taxTables.js. Vale só para você (fica nos seus dados).
 */
export function saveTaxTable(year, table) {
  return store.commit((d) => {
    const y = intRange(year, 'year', 2020, 2100, 'O ano');
    const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    if (!num(table.minimumWage) || table.minimumWage < 100) throw new ValidationError('Informe o salário mínimo.', 'minimumWage');
    if (!Array.isArray(table.inss) || table.inss.length < 2 || !table.inss.every((r) => r.length === 2 && r.every(num))) throw new ValidationError('Faixas do INSS inválidas.', 'inss');
    if (!Array.isArray(table.irrf) || table.irrf.length < 2) throw new ValidationError('Faixas do IR inválidas.', 'irrf');
    d.settings.taxTables = { ...(d.settings.taxTables || {}), [y]: {
      minimumWage: table.minimumWage,
      inss: table.inss.map((r) => [r[0], r[1]]),
      irrf: table.irrf.map((r, i, all) => [i === all.length - 1 ? null : r[0], r[1], r[2]]),
      dependent: num(table.dependent) ? table.dependent : 189.59,
      simplified: num(table.simplified) ? table.simplified : 607.2,
      family: table.family || null,
      reduction: table.reduction || null,
      custom: true,
    } };
  });
}

export function deleteTaxTable(year) {
  return store.commit((d) => {
    const t = { ...(d.settings.taxTables || {}) };
    delete t[year];
    d.settings.taxTables = t;
  }, 'change', { undo: 'Tabela removida' });
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
    const value = x.provento || x.desconto;
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
        upsertPayrollLine(d, ym, 'add', { id: old?.id, description: nameOf(x), mode: 'fixed', value, taxable: true, variable: x.params.variable });
        break;
      }
      case 'deduction': {
        const old = x.params.variable ? findVar('ded', x) : findFixed('ded', x);
        upsertPayrollLine(d, ym, 'ded', { id: old?.id, description: nameOf(x), mode: 'fixed', value, irDeductible: x.params.irDeductible, variable: x.params.variable });
        break;
      }
      case 'loan': {
        const existing = (s.payrollLoans || []).find((l) => l.id === x.params.existingId);
        const count = Number(x.params.count) || existing?.loan?.count;
        const paid = x.params.paid === '' || x.params.paid == null ? null : Number(x.params.paid);
        if (!count) throw new ValidationError(`Informe o nº de parcelas de "${nameOf(x)}".`);
        const startYM = paid != null ? addMonthsYM(ym, -paid) : existing?.loan?.startYM || ym;
        upsertPayrollLine(d, ym, 'ded', { id: existing?.id, description: existing?.description || nameOf(x), mode: 'fixed', value, irDeductible: false, loan: { count, startYM } });
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
