// =============================================================
// payroll.js — Contracheque: do bruto ao líquido
// -------------------------------------------------------------
// Você informa tudo BRUTO; o app calcula:
//
//   Salário base
// + Adicionais FIXOS (todo mês) e VARIÁVEIS (só no mês lançado)
// + Plantões/extras pagos na folha
// = BRUTO
// − Previdência: INSS progressivo (CLT) ou alíquota fixa (servidor/RPPS)
// − IRRF   (tabela progressiva; usa o que for MELHOR entre deduções
//           legais e o desconto simplificado; redução da Lei 15.270/2025)
// − Descontos em folha: fixos, variáveis e parcelados (consignado)
// = LÍQUIDO
//
// Onde cada coisa fica (settings):
//   salaryHistory   perfis salariais, cada um vale a partir de `from`:
//     { from, grossCents, dependents, additions: [...], deductions: [...] }
//   payrollLoans    descontos parcelados (valem da 1ª à última parcela):
//     { ...desconto, loan: { count, startYM } }
//   payrollVariable linhas variáveis, só no mês `ym`:
//     { ...linha, kind: 'add'|'ded', ym }
//   employment      { admission, regime: 'inss'|'fixed', fixedRateBp, thirteenth,
//                     hoursDivisor (220), familyChildren (salário-família) }
//   absences        [{ id, ym, kind: 'atestado'|'inss'|'falta', days }]
//   onCallHours     { "AAAA-MM": { [idDaLinha]: minutos } } — horas de
//                   sobreaviso REALMENTE cumpridas no mês (ver abaixo)
//
// Sobreaviso (CLT art. 244 §2º e Súmula 428 do TST): taxa FIXA de 1/3 do
//   valor da hora normal. A linha fica no perfil e se repete em TODOS os
//   meses em que estiver ativa, com valor FIXO de R$ 0,00: só ganha valor
//   quando as horas do mês são informadas (pendingHours = ainda sem horas).
//
// Linha POR HORAS (só adicionais): { mode: 'hours', value: minutos,
//   hourKind: 'he50'|'he100'|'sobreaviso'|'noturno'|'custom', hourPct, dsr }
//   valor da hora = (salário [+ adicionais fixos]) ÷ divisor (220)
//
// Linha de adicional: { id, description, mode: 'percent'|'fixed', value, base: 'salary'|'minimum', taxable }
// Linha de desconto:  { id, description, mode, value, base: 'salary'|'gross', irDeductible }
//   mode 'percent' → value em centésimos de % (20% = 2000)
//   mode 'fixed'   → value em centavos
// =============================================================

import { tablesFor, tablesForYM } from './taxTables.js';
import { addMonthsYM, monthsBetween, daysInMonth, parseISO, dateInMonth, ymOf, todayISO, addDaysISO, diffDays } from '../core/dates.js';
import { nthBusinessDay, dsrDaysIn } from '../core/calendar.js';

const toCents = (reais) => Math.round(reais * 100);
const toReais = (cents) => cents / 100;

export const DEFAULT_EMPLOYMENT = { admission: null, regime: 'inss', fixedRateBp: 1400, thirteenth: true, hoursDivisor: 220, familyChildren: 0 };
export const employmentOf = (settings) => ({ ...DEFAULT_EMPLOYMENT, ...(settings.employment || {}) });

// ---------- Data do pagamento ----------
// settings.payday = { mode: 'fixed' | 'business', nth: 5, saturday: true }
//   fixed    → todo dia `settings.salaryDay`
//   business → N-ésimo dia útil (padrão: 5º). Pela regra da CLT o sábado
//              conta como dia útil; dá para desligar.

export const DEFAULT_PAYDAY = { mode: 'fixed', nth: 5, saturday: true, nextMonth: false };
export const paydayOf = (settings) => ({ ...DEFAULT_PAYDAY, ...(settings.payday || {}) });

/** Data em que o salário cai no mês `ym`. */
export function paydayIn(settings, ym) {
  const p = paydayOf(settings);
  if (p.mode === 'business') return nthBusinessDay(ym, p.nth, { saturdayCounts: p.saturday });
  return dateInMonth(ym, settings.salaryDay || 5);
}

/** Data em que cai o salário da COMPETÊNCIA `ym` (o mês trabalhado). */
export function paydayForCompetence(settings, ym) {
  return paydayIn(settings, paydayOf(settings).nextMonth ? addMonthsYM(ym, 1) : ym);
}

/** Próximo pagamento a partir de hoje (no próprio dia, é hoje). */
export function nextPaydayFrom(settings, today = todayISO()) {
  const thisMonth = paydayIn(settings, ymOf(today));
  return thisMonth >= today ? thisMonth : paydayIn(settings, addMonthsYM(ymOf(today), 1));
}

/** "todo dia 5" / "5º dia útil" */
export function paydayLabel(settings) {
  const p = paydayOf(settings);
  const when = p.mode === 'business' ? `no ${p.nth}º dia útil${p.saturday ? '' : ' (seg. a sex.)'}` : `todo dia ${settings.salaryDay || 5}`;
  return p.nextMonth ? `${when} do mês seguinte` : when;
}

/** Perfil salarial vigente no mês (o mais recente com from <= ym). */
export function payrollProfileFor(settings, ym) {
  let best = null;
  for (const p of settings.salaryHistory) {
    if (p.from <= ym && (!best || p.from >= best.from)) best = p;
  }
  return best;
}

// ---------- Descontos parcelados (consignado) ----------

/** Último mês de um desconto parcelado. */
export const loanEndYM = (loan) => addMonthsYM(loan.startYM, loan.count - 1);

/** Situação do parcelado no mês: { n, count, endYM, active, finished, notStarted } */
export function loanStatus(loan, ym) {
  const n = monthsBetween(loan.startYM, ym) + 1;
  const endYM = loanEndYM(loan);
  return { n, count: loan.count, endYM, active: n >= 1 && n <= loan.count, finished: n > loan.count, notStarted: n < 1 };
}

/** O desconto vale no mês? (parcelados só entre o início e o fim) */
export const deductionActiveIn = (d, ym) => !d.loan || loanStatus(d.loan, ym).active;

// ---------- Previdência ----------

/** INSS do empregado, progressivo por faixa, limitado ao teto. */
export function inssFor(grossCents, table) {
  // Como as folhas de pagamento fazem: cada faixa é calculada em
  // centavos e TRUNCADA (ex.: 121,575 → 121,57) antes de somar.
  // No teto, vale a contribuição máxima publicada (ex.: R$ 988,09 em 2026).
  const ceiling = toCents(table.inss[table.inss.length - 1][0]);
  if (grossCents >= ceiling) {
    let exact = 0;
    let low = 0;
    for (const [upper, rate] of table.inss) { exact += (upper - low) * rate; low = upper; }
    return toCents(exact);
  }
  let total = 0;
  let lower = 0;
  for (const [upper, rate] of table.inss) {
    const top = toCents(upper);
    if (grossCents <= lower) break;
    total += Math.floor((Math.min(grossCents, top) - lower) * rate + 1e-6);
    lower = top;
  }
  return total;
}

/**
 * Faixa (alíquota "nominal") em que o salário cai. É ESTE número que
 * muitos holerites mostram na coluna "referência" (ex.: 12%), embora o
 * valor descontado seja calculado faixa a faixa (alíquota efetiva menor).
 */
export function inssBandFor(grossCents, table) {
  const gross = toReais(grossCents);
  const pct = (rate) => Math.round(rate * 10000) / 100;
  for (const [upper, rate] of table.inss) if (gross <= upper) return pct(rate);
  return pct(table.inss[table.inss.length - 1][1]); // acima do teto
}

/** Previdência conforme o regime: INSS (CLT) ou alíquota fixa (servidor/RPPS). */
function pensionFor(taxableCents, table, employment) {
  if (employment.regime === 'fixed') {
    return { value: Math.round((taxableCents * employment.fixedRateBp) / 10000), band: employment.fixedRateBp / 100, label: 'Previdência (RPPS)' };
  }
  return { value: inssFor(taxableCents, table), band: inssBandFor(taxableCents, table), label: 'INSS' };
}

// ---------- Imposto de Renda ----------

// Coeficientes em milionésimos para fazer as contas em INTEIROS: a taxa ×
// centavos em ponto flutuante errava 1 centavo nos casos de meio centavo.
const micro = (x) => Math.round(x * 1e6);
/** a − b × centavos (a em reais, b decimal) → centavos, arredondado. */
export const linearCents = (aReais, b, cents) => Math.round((micro(aReais) * 100 - micro(b) * cents) / 1e6);

function tableTax(baseCents, table) {
  const base = toReais(baseCents);
  for (const [upper, rate, deduct] of table.irrf) {
    if (base <= upper) return Math.max(0, Math.round((micro(rate) * baseCents - micro(deduct) * 100) / 1e6));
  }
  return 0;
}

/** Redução do IR (Lei 15.270/2025) sobre os rendimentos tributáveis do mês. */
export function irReductionFor(taxableCents, taxCents, table) {
  const r = table.reduction;
  if (!r || taxCents <= 0) return 0;
  const income = toReais(taxableCents);
  let value = 0; // centavos (conta em inteiros: ver linearCents)
  if (income <= r.fullUpTo) value = toCents(r.fullMax);
  else if (income <= r.partialUpTo) value = Math.max(0, linearCents(r.a, r.b, taxableCents));
  return Math.min(taxCents, value);
}

/** IRRF mensal: escolhe o mais vantajoso entre deduções legais e o desconto simplificado. */
export function irrfFor({ taxableCents, inssCents, dependents = 0, deductibleCents = 0 }, table) {
  const legalBase = Math.max(0, taxableCents - inssCents - toCents(dependents * table.dependent) - deductibleCents);
  const simpleBase = Math.max(0, taxableCents - toCents(table.simplified));
  const useSimple = simpleBase < legalBase;
  const base = useSimple ? simpleBase : legalBase;
  const tax = tableTax(base, table);
  const reduction = irReductionFor(taxableCents, tax, table);
  return { base, method: useSimple ? 'simplificado' : 'deduções legais', tax, reduction, value: tax - reduction };
}

/**
 * IRRF do 13º: tributação EXCLUSIVA na fonte, separada do salário do mês.
 * Base = 13º − INSS do 13º − dependentes (deduções legais). O desconto
 * simplificado mensal NÃO vale para o 13º (regra da Receita: ele substitui
 * deduções só nos rendimentos do mês). A redução da Lei 15.270/2025 se
 * aplica, segundo a Receita. Usado no 13º da folha e na rescisão.
 */
export function thirteenthIrFor({ grossCents, inssCents, dependents = 0 }, table) {
  const base = Math.max(0, grossCents - inssCents - toCents(dependents * table.dependent));
  const tax = tableTax(base, table);
  const reduction = irReductionFor(grossCents, tax, table);
  return { base, method: 'deduções legais', tax, reduction, value: tax - reduction };
}

// ---------- Contracheque ----------

const pctLabel = (bp) => `${(bp / 100).toLocaleString('pt-BR')}%`;

// ---------- Linhas por horas ----------

/** Tipos de hora: fator sobre o valor da hora e base padrão. */
export const HOUR_KINDS = {
  he50: { label: 'Horas extras 50%', factor: 1.5, base: 'salaryAdds', dsr: true },
  he100: { label: 'Horas extras 100%', factor: 2, base: 'salaryAdds', dsr: true },
  sobreaviso: { label: 'Sobreaviso', factor: 1 / 3, base: 'salary', dsr: false },
  noturno: { label: 'Adicional noturno', factor: 0.2, base: 'salaryAdds', dsr: true, reduced: true },
  custom: { label: 'Outro', factor: null, base: 'salary', dsr: false },
};

/** 90 → "1h30"; 6000 → "100h" */
export function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const hourFactor = (line) => {
  const k = HOUR_KINDS[line.hourKind] || HOUR_KINDS.custom;
  return k.factor ?? (line.hourPct || 10000) / 10000;
};

// ---------- Afastamentos ----------

/**
 * Dias de afastamento da competência:
 *   sick  = atestado pago pela empresa (até 15 dias)
 *   inss  = dias pagos pelo INSS (16º dia em diante ou afastamento lançado)
 *   falta = faltas descontadas
 */
export function absencesIn(settings, ym) {
  const list = (settings.absences || []).filter((a) => a.ym === ym);
  const sum = (k) => list.filter((a) => a.kind === k).reduce((s, a) => s + a.days, 0);
  const atestado = sum('atestado');
  const sick = Math.min(15, atestado);
  return { sick, inss: Math.max(0, atestado - 15) + sum('inss'), falta: sum('falta'), list };
}

/**
 * Calcula o contracheque do mês.
 * @param {object|null} profile  perfil salarial (ou null)
 * @param {string} ym            "AAAA-MM" (define a tabela do ano)
 * @param {object} o
 * @param {number} o.extras      plantões/extras pagos NA FOLHA (bruto)
 * @param {Array}  o.loans       descontos parcelados
 * @param {Array}  o.variable    linhas variáveis do mês [{ kind, ... }]
 * @param {object} o.employment  regime, divisor de horas, salário-família
 * @param {number} o.workedDays  dias pagos pelo empregador (férias e INSS fora)
 * @param {object} o.absence     { sick, falta } — atestado pago e faltas
 * @param {object} o.hourOverrides  { [idDaLinha]: minutos } — horas de sobreaviso do mês
 */
export function computePayroll(profile, ym, { extras = 0, loans = [], variable = [], employment = DEFAULT_EMPLOYMENT, workedDays = 30, absence = null, hourOverrides = {} } = {}) {
  const table = tablesForYM(ym);
  const emp = { ...DEFAULT_EMPLOYMENT, ...employment };
  const empty = {
    year: table.year, base: 0, baseLines: [], additions: [], extras, gross: extras, taxable: extras,
    inss: 0, inssBand: 0, inssLabel: emp.regime === 'fixed' ? 'Previdência (RPPS)' : 'INSS',
    ir: { base: 0, method: '—', tax: 0, reduction: 0, value: 0 }, deductions: [], deductionsTotal: 0,
    fgts: 0, net: extras, legacyNet: false, hasProfile: false,
    bases: { salary: 0, inss: extras, fgts: extras, irrf: extras },
  };

  if (!profile) {
    if (!extras) return empty;
    // Só plantões, sem salário: ainda há previdência/IR sobre eles
    const pension = pensionFor(extras, table, emp);
    const ir = irrfFor({ taxableCents: extras, inssCents: pension.value }, table);
    return { ...empty, inss: pension.value, inssBand: pension.band, ir, net: extras - pension.value - ir.value };
  }

  // Perfis do formato antigo guardavam o salário já líquido: sem cálculo de impostos
  if (profile.legacyNet) {
    return { ...empty, base: profile.grossCents, gross: profile.grossCents + extras, taxable: 0, net: profile.grossCents + extras, legacyNet: true, hasProfile: true };
  }

  // Dias pagos pela empresa: férias e afastamento pelo INSS ficam de fora
  const paidDays = Math.max(0, Math.min(30, workedDays));
  const worked = paidDays / 30;
  const fullBase = profile.grossCents;
  const base = Math.round(fullBase * worked);
  const minimum = toCents(table.minimumWage);
  const varAdd = variable.filter((v) => v.kind === 'add');
  const varDed = variable.filter((v) => v.kind === 'ded');

  // Salário: separa dias trabalhados e atestado (como no holerite)
  const sickDays = Math.min(paidDays, absence?.sick || 0);
  const sickCents = sickDays ? Math.round((fullBase * sickDays) / 30) : 0;
  const baseLines = sickDays
    ? [
      { key: 'salary', description: 'Salário', detail: `${paidDays - sickDays} dias`, cents: base - sickCents },
      { key: 'sick', description: 'Atestado médico', detail: `${sickDays} dias · pago pela empresa`, cents: sickCents },
    ]
    : [{ key: 'salary', description: 'Salário base', detail: paidDays < 30 ? `${paidDays} dias` : '', cents: base }];

  const allAdds = [...(profile.additions || []), ...varAdd];
  const money = allAdds.filter((a) => a.mode !== 'hours').map((a) => {
    const over = a.base === 'minimum' ? minimum : fullBase;
    const full = a.mode === 'percent' ? Math.round((over * a.value) / 10000) : a.value;
    const cents = a.ym ? full : Math.round(full * worked); // fixos acompanham os dias pagos
    return {
      id: a.id, description: a.description, cents, taxable: a.taxable !== false, variable: Boolean(a.ym), fixedMonthly: !a.ym ? full : 0,
      detail: a.mode === 'percent' ? `${pctLabel(a.value)} ${a.base === 'minimum' ? 'do mínimo' : 'do salário'}` : '',
    };
  });

  // Valor da hora: salário (e, para horas extras, os adicionais fixos tributáveis — Súmula 132 do TST)
  const divisor = emp.hoursDivisor || 220;
  const addsForHour = money.filter((a) => a.taxable && !a.variable).reduce((s, a) => s + a.fixedMonthly, 0);
  const { rest, business } = dsrDaysIn(ym);
  const hours = [];
  for (const a of allAdds.filter((x) => x.mode === 'hours')) {
    const kind = HOUR_KINDS[a.hourKind] || HOUR_KINDS.custom;
    const hourBase = (a.hourBase || kind.base) === 'salaryAdds' ? fullBase + addsForHour : fullBase;
    const hourly = hourBase / divisor;
    const factor = hourFactor(a);
    // Sobreaviso do perfil: vale R$ 0,00 até as horas do mês serem informadas
    const onCall = a.hourKind === 'sobreaviso' && !a.ym;
    const minutes = onCall ? (Number.isInteger(hourOverrides[a.id]) ? hourOverrides[a.id] : 0) : a.value;
    const pendingHours = onCall && !Number.isInteger(hourOverrides[a.id]);
    const effMinutes = kind.reduced ? (minutes * 60) / 52.5 : minutes; // hora noturna reduzida (52min30s)
    const cents = Math.round((hourly * effMinutes / 60) * factor);
    const factorLabel = a.hourKind === 'sobreaviso' ? '1/3 da hora' : a.hourKind === 'noturno' ? '20% (hora reduzida)' : `${(factor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% da hora`;
    hours.push({
      // Horas que mudam todo mês (inclui o sobreaviso) são verbas VARIÁVEIS:
      // entram na média do 13º e das férias, não no salário fixo
      id: a.id, description: a.description, cents, taxable: a.taxable !== false, variable: Boolean(a.ym) || onCall, hours: minutes, pendingHours,
      detail: `${formatHours(minutes)} × ${factorLabel} · hora R$ ${(hourly / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${pendingHours ? ' · sem horas no mês' : ''}`,
    });
    if (a.dsr && business > 0 && cents > 0) {
      hours.push({
        id: `${a.id}-dsr`, description: `DSR s/ ${a.description}`, cents: Math.round((cents * rest) / business),
        taxable: a.taxable !== false, variable: Boolean(a.ym), auto: true,
        detail: `${rest} domingos/feriados ÷ ${business} dias úteis`,
      });
    }
  }

  const additions = [...money.map(({ fixedMonthly: _fixed, ...a }) => a), ...hours];
  const remuneration = base + extras + additions.filter((a) => a.taxable).reduce((s, a) => s + a.cents, 0);

  // Salário-família (não tributável): cota por filho até o limite de remuneração
  const children = emp.familyChildren || 0;
  if (children > 0 && table.family && emp.regime === 'inss' && remuneration <= toCents(table.family.limit)) {
    additions.push({
      id: 'salario-familia', description: 'Salário-família', cents: toCents(table.family.quota) * children,
      taxable: false, variable: false, auto: true, detail: `${children} × R$ ${table.family.quota.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    });
  }

  const additionsTotal = additions.reduce((s, a) => s + a.cents, 0);
  const gross = base + additionsTotal + extras;

  // Faltas: descontam o dia e saem da base de INSS/FGTS/IR
  const faltaDays = absence?.falta || 0;
  const faltaCents = faltaDays ? Math.round((fullBase * faltaDays) / 30) : 0;
  const taxable = Math.max(0, remuneration - faltaCents);

  const pension = pensionFor(taxable, table, emp);

  const deductions = [...(profile.deductions || []), ...loans, ...varDed]
    .filter((d) => deductionActiveIn(d, ym)) // consignado: só entre a 1ª e a última parcela
    .map((d) => {
      const over = d.base === 'gross' ? gross : base;
      const cents = d.mode === 'percent' ? Math.round((over * d.value) / 10000) : d.value;
      const pct = d.mode === 'percent' ? `${pctLabel(d.value)} ${d.base === 'gross' ? 'do bruto' : 'do salário'}` : '';
      const loan = d.loan ? loanStatus(d.loan, ym) : null;
      return {
        id: d.id, description: d.description, cents, irDeductible: Boolean(d.irDeductible), loan, variable: Boolean(d.ym),
        detail: [pct, loan ? `parcela ${loan.n}/${loan.count}` : ''].filter(Boolean).join(' · '),
      };
    });
  if (faltaCents) {
    deductions.unshift({ id: 'faltas', description: 'Faltas', cents: faltaCents, irDeductible: false, loan: null, variable: true, auto: true, detail: `${faltaDays} ${faltaDays === 1 ? 'dia' : 'dias'}` });
  }
  const deductibleCents = deductions.filter((d) => d.irDeductible).reduce((s, d) => s + d.cents, 0);
  const deductionsTotal = deductions.reduce((s, d) => s + d.cents, 0);

  const ir = irrfFor({ taxableCents: taxable, inssCents: pension.value, dependents: profile.dependents || 0, deductibleCents }, table);
  const fgts = emp.regime === 'inss' ? Math.round(taxable * 0.08) : 0;

  return {
    year: table.year, base, baseLines, workedDays: paidDays, additions, extras, gross, taxable,
    inss: pension.value, inssBand: pension.band, inssLabel: pension.label,
    ir, deductions, deductionsTotal,
    // FGTS: 8% depositado pela empresa (CLT). Não sai do salário; só informativo.
    fgts,
    bases: { salary: fullBase, inss: taxable, fgts: emp.regime === 'inss' ? taxable : 0, irrf: taxable },
    net: gross - pension.value - ir.value - deductionsTotal,
    legacyNet: false, hasProfile: true,
  };
}

/** Linhas variáveis lançadas no mês. */
export const variableFor = (settings, ym) => (settings.payrollVariable || []).filter((v) => v.ym === ym);

/** Contracheque do mês direto das configurações. */
export function payrollFor(settings, ym, extras = 0) {
  return computePayroll(payrollProfileFor(settings, ym), ym, {
    extras,
    loans: settings.payrollLoans || [],
    variable: variableFor(settings, ym),
    employment: employmentOf(settings),
    hourOverrides: settings.onCallHours?.[ym] || {},
    ...daysFor(settings, ym),
  });
}

/** Linhas de sobreaviso do perfil do mês, com as horas informadas (ou null = R$ 0,00). */
export function onCallLinesFor(settings, ym) {
  const profile = payrollProfileFor(settings, ym);
  if (!profile || profile.legacyNet) return [];
  const informed = settings.onCallHours?.[ym] || {};
  return (profile.additions || [])
    .filter((a) => a.mode === 'hours' && a.hourKind === 'sobreaviso')
    .map((a) => ({ id: a.id, description: a.description, minutes: Number.isInteger(informed[a.id]) ? informed[a.id] : null }));
}

/** Dias pagos pela empresa no mês e afastamentos (férias, INSS, atestado, faltas). */
export function daysFor(settings, ym) {
  const abs = absencesIn(settings, ym);
  return {
    // Férias que atravessam o mês: cada mês desconta só os SEUS dias
    workedDays: Math.max(0, 30 - vacationDaysIn(settings, ym) - abs.inss),
    absence: { sick: abs.sick, falta: abs.falta },
  };
}

// ---------- 13º salário ----------

/**
 * Meses (avos) com direito ao 13º no ano: conta o mês se trabalhou
 * 15 dias ou mais nele. Sem data de admissão (ou admissão em anos
 * anteriores) = 12 avos.
 */
export function thirteenthMonths(admission, year) {
  const a = parseISO(admission);
  if (!a || a.y < year) return 12;
  if (a.y > year) return 0;
  const firstCounts = daysInMonth(a.y, a.m) - a.d + 1 >= 15;
  return 12 - a.m + (firstCounts ? 1 : 0);
}

/**
 * Média mensal das verbas VARIÁVEIS habituais do ano (horas extras e DSR,
 * adicional noturno, sobreaviso, adicionais variáveis lançados e plantões
 * pagos na folha), de janeiro — ou do mês de admissão — até `lastMonth`.
 * Divide pelos meses com salário no período (meses trabalhados).
 * @param {(ym: string) => number} extrasFor  plantões/extras NA FOLHA do mês (bruto)
 */
export function variableAverageFor(settings, year, lastMonth, extrasFor = () => 0) {
  if (lastMonth < 1) return { average: 0, months: 0, total: 0 };
  return variableAverageBetween(settings, `${year}-01`, `${year}-${String(lastMonth).padStart(2, '0')}`, extrasFor);
}

/**
 * Mesma média de variableAverageFor, entre dois meses quaisquer (inclusive),
 * começando no mês de admissão se for depois de `fromYM`. Férias e rescisão
 * usam os 12 meses anteriores (o período aquisitivo).
 */
export function variableAverageBetween(settings, fromYM, toYM, extrasFor = () => 0) {
  const admission = employmentOf(settings).admission;
  const start = parseISO(admission) && ymOf(admission) > fromYM ? ymOf(admission) : fromYM;
  let total = 0;
  let months = 0;
  for (let mym = start; mym <= toYM; mym = addMonthsYM(mym, 1)) {
    const profile = payrollProfileFor(settings, mym);
    if (!profile || profile.legacyNet) continue;
    const p = payrollFor(settings, mym, extrasFor(mym) || 0);
    total += p.extras + p.additions.filter((a) => a.taxable && a.variable).reduce((s, a) => s + a.cents, 0);
    months++;
  }
  return { average: months ? Math.round(total / months) : 0, months, total };
}

/**
 * 13º salário (Lei 4.090/62 e 4.749/65):
 *   avos     1/12 por mês com 15 dias ou mais trabalhados (thirteenthMonths)
 *   base     salário + adicionais FIXOS tributáveis + MÉDIA das variáveis
 *   total    base × avos ÷ 12
 *   1ª parc. 50% do total (média até outubro), até 30/11, sem INSS/IR
 *   2ª parc. total (média até novembro) − 1ª parcela − INSS sobre o
 *            total − IRRF exclusivo sobre o total, até 20/12
 * Tudo em centavos inteiros (arredondamento a cada etapa).
 * → null nos outros meses ou se desligado.
 * @param {(ym: string) => number} [extrasFor]  plantões na folha por mês (para a média)
 */
export function thirteenthFor(settings, ym, extrasFor = () => 0) {
  const emp = employmentOf(settings);
  const month = Number(ym.slice(5, 7));
  if (!emp.thirteenth || (month !== 11 && month !== 12)) return null;
  const profile = payrollProfileFor(settings, ym);
  if (!profile || profile.legacyNet) return null;

  const year = Number(ym.slice(0, 4));
  const avos = thirteenthMonths(emp.admission, year);
  if (!avos) return null;
  const table = tablesFor(year);
  const fixed = computePayroll(profile, ym, { employment: emp }); // só o fixo: sem variáveis/plantões
  const fullBase = fixed.base + fixed.additions.filter((a) => a.taxable && !a.variable).reduce((s, a) => s + a.cents, 0);
  // 1ª parcela: média até outubro · total (2ª parcela): média até novembro
  const avgFirst = variableAverageFor(settings, year, 10, extrasFor);
  const avg = month === 11 ? avgFirst : variableAverageFor(settings, year, 11, extrasFor);
  const gross = Math.round(((fullBase + avg.average) * avos) / 12);
  const first = Math.round(Math.round(((fullBase + avgFirst.average) * avos) / 12) / 2);
  const parts = { avos, base: fullBase, average: avg.average, averageMonths: avg.months };

  const advanced = advanced13In(settings, year);
  if (month === 11) {
    if (advanced) return null; // a 1ª parcela já veio com as férias
    return { part: 1, label: '13º salário — 1ª parcela', ...parts, gross, first, inss: 0, ir: 0, net: first };
  }
  // Adiantado nas férias: desconta o valor que de fato foi pago no recibo de
  // férias (média das variáveis só até o mês anterior às férias), não a 1ª
  // parcela recalculada
  let paidFirst = first;
  if (advanced) {
    const v = (settings.vacations || []).find((x) => x.advance13 && x.start.startsWith(String(year)));
    const paid = v ? vacationFor(settings, v.start.slice(0, 7), extrasFor)?.advance13Cents : null;
    if (paid) paidFirst = paid;
  }
  const pension = pensionFor(gross, table, emp);
  const irValue = thirteenthIrFor({ grossCents: gross, inssCents: pension.value, dependents: profile.dependents || 0 }, table).value;
  return {
    part: 2, label: '13º salário — 2ª parcela', ...parts, gross, first: paidFirst, advanced,
    inss: pension.value, ir: irValue, net: gross - paidFirst - pension.value - irValue,
  };
}

// ---------- Férias ----------
//
// settings.vacations: [{ id, start: "AAAA-MM-DD", days, sellDays, advance13 }]
//   days       dias de descanso (5 a 30)
//   sellDays   dias vendidos (abono pecuniário, até 1/3 = 10 dias)
//   advance13  adiantar a 1ª parcela do 13º junto com as férias
//
// Estimativa no mês de início:
//   férias   = (salário + adicionais fixos + média das variáveis dos 12
//              meses anteriores) ÷ 30 × dias + 1/3
//   abono    = mesma base ÷ 30 × dias vendidos + 1/3  (sem INSS e sem IR)
//   INSS     sobre salário + férias + 1/3 de cada mês (o recibo desconta a diferença)
//   IR       sobre férias + 1/3, em separado do salário
//   O salário de cada mês paga só os dias trabalhados (férias que atravessam
//   o mês descontam os dias de cada mês).

/** Férias que começam no mês `ym` (ou null). */
export const vacationIn = (settings, ym) => (settings.vacations || []).find((v) => v.start.slice(0, 7) === ym) || null;

/** Dias de descanso das férias em cada mês do calendário: [{ ym, days }]. */
export function vacationSplit(v) {
  const out = [];
  if (!v?.start || !(v.days > 0)) return out;
  const end = addDaysISO(v.start, v.days - 1);
  for (let cur = v.start; cur <= end;) {
    const ym = ymOf(cur);
    const monthEnd = dateInMonth(ym, 31);
    const last = end < monthEnd ? end : monthEnd;
    out.push({ ym, days: diffDays(cur, last) + 1 });
    cur = addDaysISO(last, 1);
  }
  return out;
}

/** Dias de férias que caem no mês `ym` (somando todas as férias; no máximo 30). */
export function vacationDaysIn(settings, ym) {
  let total = 0;
  for (const v of settings.vacations || []) total += vacationSplit(v).find((x) => x.ym === ym)?.days || 0;
  return Math.min(30, total);
}

/**
 * Recibo de férias que começam no mês `ym`.
 * @param {(ym: string) => number} [extrasFor]  plantões na folha por mês (para a média e o INSS)
 */
export function vacationFor(settings, ym, extrasFor = () => 0) {
  const v = vacationIn(settings, ym);
  if (!v) return null;
  const profile = payrollProfileFor(settings, ym);
  if (!profile || profile.legacyNet) return null;
  const emp = employmentOf(settings);
  const table = tablesForYM(ym);
  const full = computePayroll(profile, ym, { employment: emp });
  const fixedMonthly = full.base + full.additions.filter((a) => a.taxable && !a.variable).reduce((s, a) => s + a.cents, 0);
  // Base das férias = fixo + média das variáveis habituais (horas extras,
  // sobreaviso, plantões na folha) dos 12 meses anteriores, como no 13º
  const average = variableAverageBetween(settings, addMonthsYM(ym, -12), addMonthsYM(ym, -1), extrasFor).average;
  const monthly = fixedMonthly + average;
  const perDay = monthly / 30;

  const pay = Math.round(perDay * v.days);
  const third = Math.round(pay / 3);
  const abonoPay = Math.round(perDay * (v.sellDays || 0));
  const abono = abonoPay + Math.round(abonoPay / 3);
  const taxable = pay + third;
  // INSS: incide sobre a remuneração TOTAL de cada competência (salário + férias
  // + 1/3 dos dias daquele mês). O recibo de férias desconta a diferença entre
  // o INSS do conjunto e o que o contracheque do salário já desconta.
  let inss = 0;
  let given = 0;
  const parts = vacationSplit(v);
  parts.forEach(({ ym: m, days }, i) => {
    const share = i === parts.length - 1 ? taxable - given : Math.round((taxable * days) / v.days);
    given += share;
    const salary = payrollFor(settings, m, extrasFor(m) || 0);
    const joint = pensionFor(salary.bases.inss + share, tablesForYM(m), emp).value;
    inss += Math.max(0, joint - salary.inss);
  });
  const pension = { value: inss };
  // IR das férias: em separado do salário (tributação própria no recibo)
  const ir = irrfFor({ taxableCents: taxable, inssCents: pension.value, dependents: profile.dependents || 0 }, table);

  let advance = 0;
  if (v.advance13 && emp.thirteenth) {
    const year = Number(ym.slice(0, 4));
    const avos = thirteenthMonths(emp.admission, year);
    // 1ª parcela do 13º: fixo + média das variáveis do ano até o mês anterior
    const avg13 = variableAverageFor(settings, year, Number(ym.slice(5, 7)) - 1, extrasFor).average;
    advance = Math.round(((fixedMonthly + avg13) * avos) / 12 / 2);
  }

  return {
    ...v,
    pay, third, abono, advance13Cents: advance, average,
    gross: pay + third + abono + advance,
    inss: pension.value, ir: ir.value,
    net: pay + third + abono + advance - pension.value - ir.value,
    workedDays: Math.max(0, 30 - v.days - (v.sellDays || 0)) + (v.sellDays || 0),
  };
}

/** O 13º já foi adiantado nas férias deste ano? */
export const advanced13In = (settings, year) =>
  (settings.vacations || []).some((v) => v.advance13 && v.start.startsWith(String(year)));
