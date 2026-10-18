// =============================================================
// termination.js — Simulação de rescisão e FGTS
// -------------------------------------------------------------
// Rescisão (CLT), por tipo de saída:
//                          sem justa  pedido  acordo  justa causa
//   saldo de salário          ✓         ✓       ✓         ✓
//   aviso prévio indenizado   ✓         —      metade      —
//   13º proporcional          ✓         ✓       ✓         —
//   férias proporcionais+1/3  ✓         ✓       ✓         —
//   férias vencidas + 1/3     ✓         ✓       ✓         ✓
//   multa do FGTS            40%        —      20%        —
//   saque do FGTS            100%       —      80%        —
//   seguro-desemprego         ✓         —       —         —
// Aviso prévio: 30 dias + 3 por ano completo (até 90) e o tempo dele
// conta para 13º e férias. Aviso e férias indenizadas não têm INSS
// nem IR; saldo de salário e 13º têm.
//
// FGTS: 8% do bruto todo mês (com plantões na folha, férias + 1/3 e 13º),
// rende 3% a.a. (+ TR, quase zero)
// capitalizado mês a mês. A distribuição de lucros anual não entra.
// =============================================================

import { sumCents } from '../core/money.js';
import { parseISO, diffDays, addDaysISO, daysInMonth, ymOf, addMonthsYM, todayISO, dateInMonth } from '../core/dates.js';
import { tablesFor } from './taxTables.js';
import { inssFor, irrfFor, thirteenthIrFor, payrollFor, thirteenthFor, vacationFor, variableAverageBetween, employmentOf } from './payroll.js';
import { payrollExtrasFor } from './ledger.js';

export const REASONS = {
  sem_justa: { label: 'Demissão sem justa causa', notice: 1, fine: 0.4, withdraw: 1, prop: true, unemployment: true },
  pedido: { label: 'Pedido de demissão', notice: 0, fine: 0, withdraw: 0, prop: true, unemployment: false },
  acordo: { label: 'Acordo (art. 484-A)', notice: 0.5, fine: 0.2, withdraw: 0.8, prop: true, unemployment: false },
  justa: { label: 'Justa causa', notice: 0, fine: 0, withdraw: 0, prop: false, unemployment: false },
};

/** Meses (avos) contando mês com 15+ dias trabalhados. */
function avos(from, to) {
  const a = parseISO(from), b = parseISO(to);
  if (!a || !b || to < from) return 0;
  let n = 0;
  for (let ym = ymOf(from); ym <= ymOf(to); ym = addMonthsYM(ym, 1)) {
    const [y, m] = ym.split('-').map(Number);
    const start = ym === ymOf(from) ? a.d : 1;
    const end = ym === ymOf(to) ? b.d : daysInMonth(y, m);
    if (end - start + 1 >= 15) n++;
  }
  return Math.min(12, n);
}

/**
 * Avos de férias do período aquisitivo: um por MÊS de calendário contado do
 * aniversário da admissão (ex.: 10/03 a 09/04 = 1 avo); a fração final com
 * 15 dias ou mais conta mais um (CLT art. 146, parágrafo único).
 */
export function vacationAvos(aq, until) {
  const day = parseISO(aq).d;
  let n = 0;
  let cur = aq;
  while (n < 12) {
    const next = dateInMonth(addMonthsYM(ymOf(aq), n + 1), day);
    if (addDaysISO(next, -1) > until) break;
    n++;
    cur = next;
  }
  if (n < 12 && diffDays(cur, until) + 1 >= 15) n++;
  return n;
}

/** Dias do saldo de salário no mês comercial (30 dias): o último dia do mês vale 30. */
export function salaryBalanceDays(lastDay) {
  const p = parseISO(lastDay);
  return p.d === daysInMonth(p.y, p.m) ? 30 : Math.min(30, p.d);
}

/**
 * Média das variáveis habituais (horas extras, sobreaviso, plantões na folha)
 * dos 12 meses antes da saída — entra no aviso, 13º e férias da rescisão.
 * Passe o resultado em `variableCents` de simulateTermination.
 */
export function terminationAverageFor(state, lastDay) {
  const ym = ymOf(lastDay);
  return variableAverageBetween(state.settings, addMonthsYM(ym, -12), addMonthsYM(ym, -1), payrollExtrasFor(state)).average;
}

/**
 * input: { reason, lastDay, admission, salaryCents, variableCents, dependents, fgtsCents, vacationsDueDays (0|30), noticeServed (bool) }
 *   salaryCents   salário + adicionais fixos
 *   variableCents média das variáveis habituais (terminationAverageFor); entra
 *                 no aviso, 13º e férias, como no 13º da folha
 * → { lines: [{ label, cents, taxable }], gross, inss, ir, net, fgts: { balance, deposit, fine, withdraw }, total, notes }
 */
export function simulateTermination(input) {
  const r = REASONS[input.reason] || REASONS.sem_justa;
  const salary = input.salaryCents;
  const perDay = salary / 30;
  const fullBase = salary + (input.variableCents || 0); // remuneração com a média das variáveis
  const fullPerDay = fullBase / 30;
  const last = input.lastDay;
  const adm = input.admission || addDaysISO(last, -365);
  const years = Math.floor(diffDays(adm, last) / 365);
  const noticeDays = r.notice && !input.noticeServed ? Math.round(Math.min(90, 30 + 3 * years) * r.notice) : 0;
  const projected = addDaysISO(last, noticeDays); // o aviso indenizado projeta o contrato
  const lines = [];
  const add = (label, cents, taxable = false) => { if (cents) lines.push({ label, cents: Math.round(cents), taxable }); };

  // mês comercial: 31 dias trabalhados não pagam 31/30 do salário
  const balanceDays = salaryBalanceDays(last);
  add(`Saldo de salário (${balanceDays} dias)`, perDay * balanceDays, true);
  const noticeCents = Math.round(fullPerDay * noticeDays);
  if (noticeDays) add(`Aviso prévio indenizado (${noticeDays} dias)`, noticeCents);
  if (r.prop) {
    const y = parseISO(projected).y;
    const start13 = adm > `${y}-01-01` ? adm : `${y}-01-01`;
    const a13 = avos(start13, projected);
    add(`13º proporcional (${a13}/12)`, (fullBase * a13) / 12, true);
    // período aquisitivo de férias: aniversário da admissão
    const admP = parseISO(adm);
    let aq = `${parseISO(projected).y}-${String(admP.m).padStart(2, '0')}-${String(admP.d).padStart(2, '0')}`;
    if (aq > projected) aq = `${parseISO(projected).y - 1}-${String(admP.m).padStart(2, '0')}-${String(admP.d).padStart(2, '0')}`;
    if (aq < adm) aq = adm;
    const af = vacationAvos(aq, projected);
    const prop = (fullBase * af) / 12;
    add(`Férias proporcionais (${af}/12)`, prop);
    add('1/3 sobre férias proporcionais', prop / 3);
  }
  if (input.vacationsDueDays) {
    add('Férias vencidas', fullPerDay * input.vacationsDueDays);
    add('1/3 sobre férias vencidas', (fullPerDay * input.vacationsDueDays) / 3);
  }

  const table = tablesFor(parseISO(last).y, parseISO(last).m);
  const dependents = input.dependents || 0;
  const salaryPart = sumCents(lines.filter((l) => l.taxable && !/13º/.test(l.label)).map((l) => l.cents));
  const t13 = sumCents(lines.filter((l) => /13º/.test(l.label)).map((l) => l.cents));
  const inssSal = inssFor(salaryPart, table);
  const inss13 = inssFor(t13, table);
  const irSal = irrfFor({ taxableCents: salaryPart, inssCents: inssSal, dependents }, table).value;
  // 13º: tributação exclusiva, só deduções legais (igual ao 13º da folha)
  const ir13 = thirteenthIrFor({ grossCents: t13, inssCents: inss13, dependents }, table).value;
  const gross = sumCents(lines.map((l) => l.cents));
  const inss = inssSal + inss13;
  const ir = irSal + ir13;

  const balance = input.fgtsCents || 0;
  const deposit = Math.round((salaryPart + t13 + noticeCents) * 0.08);
  const fine = Math.round((balance + deposit) * r.fine);
  const withdraw = Math.round((balance + deposit) * r.withdraw);
  const net = gross - inss - ir;
  return {
    reason: r, noticeDays, projected, lines, gross, inss, ir, net,
    fgts: { balance, deposit, fine, withdraw },
    total: net + fine + withdraw,
    notes: [
      r.unemployment ? 'Tem direito ao seguro-desemprego (se cumprir os requisitos de tempo de trabalho).' : '',
      input.reason === 'pedido' && !input.noticeServed ? 'Pedido de demissão sem cumprir o aviso: a empresa pode descontar 30 dias.' : '',
      input.reason === 'acordo' ? 'No acordo não há seguro-desemprego.' : '',
    ].filter(Boolean),
  };
}

// ---------- FGTS ----------

const MONTHLY = 1.03 ** (1 / 12) - 1;

/**
 * Saldo estimado do FGTS mês a mês: do saldo informado (settings.fgts)
 * ou da admissão até `untilYM`, somando 8% do bruto e o rendimento.
 * → [{ ym, deposit, balance }]
 */
export function fgtsSeries(state, untilYM = ymOf(todayISO())) {
  const s = state.settings;
  const emp = employmentOf(s);
  if (emp.regime !== 'inss') return [];
  const anchor = s.fgts?.date ? { ym: ymOf(s.fgts.date), cents: s.fgts.balanceCents } : emp.admission ? { ym: ymOf(emp.admission), cents: 0 } : null;
  if (!anchor) return [];
  const out = [];
  const extrasFor = payrollExtrasFor(state);
  let balance = anchor.cents;
  for (let ym = anchor.ym, guard = 0; ym <= untilYM && guard < 600; ym = addMonthsYM(ym, 1), guard++) {
    if (ym > anchor.ym || !s.fgts?.date) {
      // contracheque com os plantões/extras pagos na folha (também têm FGTS)
      const p = payrollFor(s, ym, extrasFor(ym) || 0);
      let deposit = p.fgts || 0;
      // férias gozadas + 1/3 também têm FGTS (o abono pecuniário não)
      const vac = vacationFor(s, ym, extrasFor);
      if (vac) deposit += Math.round((vac.pay + vac.third) * 0.08);
      // 13º: 8% sobre o valor total (salário + média das variáveis), em dezembro
      if (ym.endsWith('-12') && emp.thirteenth) {
        const t = thirteenthFor(s, ym, extrasFor);
        if (t) deposit += Math.round(t.gross * 0.08);
      }
      balance = Math.round(balance * (1 + MONTHLY)) + deposit;
      out.push({ ym, deposit, balance });
    } else out.push({ ym, deposit: 0, balance });
  }
  return out;
}
