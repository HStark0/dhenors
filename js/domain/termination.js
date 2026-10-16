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
// FGTS: 8% do bruto todo mês, rende 3% a.a. (+ TR, quase zero)
// capitalizado mês a mês. A distribuição de lucros anual não entra.
// =============================================================

import { sumCents } from '../core/money.js';
import { parseISO, diffDays, addDaysISO, daysInMonth, ymOf, addMonthsYM, todayISO } from '../core/dates.js';
import { tablesFor } from './taxTables.js';
import { inssFor, irrfFor, payrollFor, payrollProfileFor, computePayroll, employmentOf } from './payroll.js';

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
 * input: { reason, lastDay, admission, salaryCents, fgtsCents, vacationsDueDays (0|30), noticeServed (bool) }
 * → { lines: [{ label, cents, taxable }], gross, inss, ir, net, fgts: { balance, deposit, fine, withdraw }, total, notes }
 */
export function simulateTermination(input) {
  const r = REASONS[input.reason] || REASONS.sem_justa;
  const salary = input.salaryCents;
  const perDay = salary / 30;
  const last = input.lastDay;
  const adm = input.admission || addDaysISO(last, -365);
  const years = Math.floor(diffDays(adm, last) / 365);
  const noticeDays = r.notice && !input.noticeServed ? Math.round(Math.min(90, 30 + 3 * years) * r.notice) : 0;
  const projected = addDaysISO(last, noticeDays); // o aviso indenizado projeta o contrato
  const lines = [];
  const add = (label, cents, taxable = false) => { if (cents) lines.push({ label, cents: Math.round(cents), taxable }); };

  add(`Saldo de salário (${parseISO(last).d} dias)`, perDay * parseISO(last).d, true);
  if (noticeDays) add(`Aviso prévio indenizado (${noticeDays} dias)`, perDay * noticeDays);
  if (r.prop) {
    const y = parseISO(projected).y;
    const start13 = adm > `${y}-01-01` ? adm : `${y}-01-01`;
    const a13 = avos(start13, projected);
    add(`13º proporcional (${a13}/12)`, (salary * a13) / 12, true);
    // período aquisitivo de férias: aniversário da admissão
    const admP = parseISO(adm);
    let aq = `${parseISO(projected).y}-${String(admP.m).padStart(2, '0')}-${String(admP.d).padStart(2, '0')}`;
    if (aq > projected) aq = `${parseISO(projected).y - 1}-${String(admP.m).padStart(2, '0')}-${String(admP.d).padStart(2, '0')}`;
    if (aq < adm) aq = adm;
    // meses do período aquisitivo: a cada 30 dias um avo; sobra de 15+ dias conta mais um
    const days = diffDays(aq, projected) + 1;
    const af = Math.min(12, Math.floor(days / 30) + (days % 30 >= 15 ? 1 : 0));
    const prop = (salary * af) / 12;
    add(`Férias proporcionais (${af}/12)`, prop);
    add('1/3 sobre férias proporcionais', prop / 3);
  }
  if (input.vacationsDueDays) {
    add('Férias vencidas', perDay * input.vacationsDueDays);
    add('1/3 sobre férias vencidas', (perDay * input.vacationsDueDays) / 3);
  }

  const table = tablesFor(parseISO(last).y);
  const salaryPart = sumCents(lines.filter((l) => l.taxable && !/13º/.test(l.label)).map((l) => l.cents));
  const t13 = sumCents(lines.filter((l) => /13º/.test(l.label)).map((l) => l.cents));
  const inssSal = inssFor(salaryPart, table);
  const inss13 = inssFor(t13, table);
  const irSal = irrfFor({ taxableCents: salaryPart, inssCents: inssSal }, table).value;
  const ir13 = irrfFor({ taxableCents: t13, inssCents: inss13 }, table).value;
  const gross = sumCents(lines.map((l) => l.cents));
  const inss = inssSal + inss13;
  const ir = irSal + ir13;

  const balance = input.fgtsCents || 0;
  const deposit = Math.round((salaryPart + t13 + (noticeDays ? perDay * noticeDays : 0)) * 0.08);
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
  let balance = anchor.cents;
  for (let ym = anchor.ym, guard = 0; ym <= untilYM && guard < 600; ym = addMonthsYM(ym, 1), guard++) {
    if (ym > anchor.ym || !s.fgts?.date) {
      const p = payrollFor(s, ym);
      let deposit = p.fgts || 0;
      if (ym.endsWith('-12') && emp.thirteenth) {
        const prof = payrollProfileFor(s, ym);
        if (prof && !prof.legacyNet) deposit += Math.round(computePayroll(prof, ym, { employment: emp }).taxable * 0.08);
      }
      balance = Math.round(balance * (1 + MONTHLY)) + deposit;
      out.push({ ym, deposit, balance });
    } else out.push({ ym, deposit: 0, balance });
  }
  return out;
}
