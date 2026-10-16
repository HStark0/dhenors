// @ts-check
// =============================================================
// sanitizePayroll.js — Limpeza do salário no backup: perfil,
// adicionais por horas, variáveis, vínculo, sobreaviso, líquidos
// conferidos, férias, descontos, plantões, benefícios, empregos e
// tabelas de impostos do usuário.
// -------------------------------------------------------------
// Parte de domain/schema.js (reexportado por lá).
// =============================================================

import { isValidISO, isValidYM } from '../core/dates.js';
import { newId } from './stateShape.js';
import { isObj, isInt, str, optId, arr, cents, day, color, pick } from './sanitizeUtil.js';

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
  // Sobreaviso por horas é salvo com value 0 (as horas reais vêm de onCallHours do mês)
  const onCall = (x) => x.mode === 'hours' && x.hourKind === 'sobreaviso';
  const value = (x) => isInt(x.value) && (x.value > 0 || (x.value === 0 && onCall(x))) && x.value <= (x.mode === 'percent' ? 100000 : 1_000_000_000);
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
export function sanitizeVariable(v) {
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

export function sanitizeEmployment(e) {
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
export function sanitizeOnCall(a) {
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

export function sanitizeActual(a, anyKey = false) {
  const out = {};
  if (isObj(a)) {
    for (const [k, v] of Object.entries(a)) {
      if ((anyKey ? /^[\w-]{1,40}$/.test(k) : isValidYM(k)) && isInt(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

export function sanitizeShiftType(t) {
  if (!isObj(t) || !str(t.name)) return null;
  return {
    id: optId(t.id) || newId(), name: str(t.name, 40), hours: isInt(t.hours) && t.hours > 0 && t.hours <= 48 ? t.hours : 12,
    cents: cents(t.cents, { zero: true }) ? t.cents : 0, payroll: t.payroll !== false, night: t.night === true, weekend: t.weekend === true,
    color: color(t.color, '#0D9488'),
  };
}

export function sanitizeBenefit(b) {
  if (!isObj(b) || !str(b.name)) return null;
  return {
    id: optId(b.id) || newId(), kind: pick(b.kind, ['va', 'vr', 'plr', 'abono', 'outro'], 'outro'), name: str(b.name, 60),
    cents: cents(b.cents, { zero: true }) ? b.cents : 0, month: isInt(b.month) && b.month >= 1 && b.month <= 12 ? b.month : null,
    year: isInt(b.year) ? b.year : null, monthly: b.monthly === true,
  };
}

export function sanitizeJob(j) {
  if (!isObj(j) || !str(j.name)) return null;
  return {
    id: optId(j.id) || newId(), name: str(j.name, 60), kind: pick(j.kind, ['clt', 'pj', 'servidor', 'autonomo'], 'clt'),
    grossCents: cents(j.grossCents, { zero: true }) ? j.grossCents : 0, regime: j.regime === 'fixed' ? 'fixed' : 'inss',
    fixedRateBp: isInt(j.fixedRateBp) && j.fixedRateBp >= 0 && j.fixedRateBp <= 5000 ? j.fixedRateBp : 1400,
    pjTaxBp: isInt(j.pjTaxBp) && j.pjTaxBp >= 0 && j.pjTaxBp <= 5000 ? j.pjTaxBp : 600,
    day: day(j.day, 5), from: isValidYM(j.from) ? j.from : null, to: isValidYM(j.to) ? j.to : null,
  };
}

export function sanitizeTaxTables(t) {
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

export function sanitizeVacation(v) {
  if (!isObj(v) || !isValidISO(v.start) || !isInt(v.days) || v.days < 5 || v.days > 30) return null;
  const sell = isInt(v.sellDays) && v.sellDays >= 0 && v.sellDays <= 10 ? v.sellDays : 0;
  return { id: optId(v.id) || newId(), start: v.start, days: v.days, sellDays: sell, advance13: v.advance13 === true };
}

/** Limpa um desconto em folha (com ou sem parcelamento). */
export function sanitizeDeduction(d) {
  if (!isObj(d) || !isInt(d.value) || d.value <= 0 || d.value > (d.mode === 'percent' ? 100000 : 1_000_000_000)) return null;
  return {
    id: optId(d.id) || newId(), description: str(d.description, 60) || 'Desconto',
    mode: d.mode === 'percent' ? 'percent' : 'fixed', value: d.value,
    base: d.base === 'gross' ? 'gross' : 'salary', irDeductible: d.irDeductible === true,
    ...(isObj(d.loan) && isInt(d.loan.count) && d.loan.count >= 1 && d.loan.count <= 420 && isValidYM(d.loan.startYM)
      ? { loan: { count: d.loan.count, startYM: d.loan.startYM } } : {}),
  };
}
