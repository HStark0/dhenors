// @ts-check
// =============================================================
// irpf.js — Previsão do Imposto de Renda anual (declaração)
// -------------------------------------------------------------
// Soma o ano inteiro a partir do que o app já sabe:
//   rendimentos tributáveis  salário + adicionais + plantões na folha
//                            + férias + outros vínculos (CLT/servidor/autônomo)
//                            (13º e PLR são de tributação EXCLUSIVA: não entram)
//   IR já retido na fonte    IR de cada contracheque + férias + vínculos
//   deduções legais          INSS/previdência, dependentes (R$ 2.275,08 cada),
//                            despesas médicas (plano de saúde na folha +
//                            gastos de Saúde pagos no ano: consultas, exames,
//                            odontologia, terapias, plano), educação (limite
//                            de R$ 3.561,50 por pessoa), PGBL (até 12% da
//                            renda tributável), pensão alimentícia
// Calcula pelos dois modelos (completo e simplificado: 20% limitado a
// R$ 16.754,34) e escolhe o melhor, aplica a tabela anual (tabela
// mensal × 12) e a redução anual da Lei 15.270/2025 (a partir de 2026).
// Resultado: restituição (você recebe) ou imposto a pagar.
// É ESTIMATIVA: confira com o programa da Receita.
// =============================================================

import { sumCents } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import { payslipIncome } from './ledger.js';
import { tablesFor } from './taxTables.js';

export const IRPF_LIMITS = {
  dependent: 227508,        // R$ 2.275,08 por dependente/ano
  education: 356150,        // R$ 3.561,50 por pessoa/ano
  simplifiedCap: 1675434,   // R$ 16.754,34
  pgblPct: 12,
  // Redução anual (Lei 15.270/2025): até R$ 60 mil zera; até R$ 88,2 mil reduz parcialmente
  reduction: { fullUpTo: 6000000, fullMax: 269415, partialUpTo: 8820000, a: 842973, b: 0.095575 },
};

const MEDICAL = /consulta|exame|odonto|terapia|plano de sa[uú]de|psic|fisio|hospital/i;

/** Tabela anual = tabela mensal × 12. */
function annualTax(baseCents, year) {
  const t = tablesFor(year);
  const base = baseCents / 100;
  for (const [upto, rate, ded] of t.irrf) {
    if (base <= upto * 12) return Math.max(0, Math.round((base * rate - ded * 12) * 100));
  }
  return 0;
}

function annualReduction(taxable, tax, year) {
  if (year < 2026 || tax <= 0) return 0;
  const r = IRPF_LIMITS.reduction;
  let v = 0;
  if (taxable <= r.fullUpTo) v = r.fullMax;
  else if (taxable <= r.partialUpTo) v = Math.max(0, Math.round(r.a - r.b * taxable));
  return Math.min(tax, v);
}

/**
 * → { year, months, taxable, withheld, inss, deductions: {...}, legal, simplified, model,
 *     base, tax, reduction, due, result, refund, exclusive: { thirteenth, plr } }
 */
export function irpfForecast(state, year, today = todayISO()) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  let taxable = 0, withheld = 0, inss = 0, medicalPayroll = 0, thirteenthNet = 0, plrGross = 0, counted = 0;
  let dependents = 0;
  for (const ym of months) {
    const inc = payslipIncome(state, ym);
    const p = inc.payroll;
    if (p.hasProfile || p.extras) counted++;
    taxable += p.taxable || 0;
    withheld += p.ir?.value || 0;
    inss += p.inss || 0;
    medicalPayroll += sumCents((p.deductions || []).filter((d) => d.irDeductible).map((d) => d.cents));
    if (inc.vacation) {
      taxable += inc.vacation.pay + inc.vacation.third;
      withheld += inc.vacation.ir;
      inss += inc.vacation.inss;
    }
    for (const j of inc.jobs?.list || []) {
      if (j.job.kind === 'pj') continue; // distribuição de lucros: isenta
      taxable += j.gross;
      withheld += j.ir;
      inss += j.inss;
    }
    // rendas fora da folha com IR (ex.: aluguel recebido) ficam de fora: o app não sabe a natureza
    if (inc.thirteenth) thirteenthNet += inc.thirteenth.net;
    for (const b of inc.benefits?.cash || []) if (b.kind === 'plr') plrGross += b.gross;
    const prof = state.settings.salaryHistory.filter((h) => h.from <= ym).pop();
    if (prof) dependents = Math.max(dependents, prof.dependents || 0);
  }

  // Despesas médicas pagas no ano (categoria Saúde + subcategorias médicas)
  const health = state.categories.find((c) => /sa[uú]de/i.test(c.name));
  const medicalSubs = new Set((health?.subcategories || []).filter((s) => MEDICAL.test(s.name)).map((s) => s.id));
  const medicalExpenses = sumCents(state.expenses.filter((e) => e.paidAt?.startsWith(String(year)) && e.categoryId === health?.id && (!e.subcategoryId || medicalSubs.has(e.subcategoryId))).map((e) => e.cents))
    + sumCents(state.recurring.filter((r) => r.categoryId === health?.id && medicalSubs.has(r.subcategoryId)).flatMap((r) => Object.entries(state.recurringEntries).filter(([k, e]) => k.startsWith(`${r.id}|${year}`) && e.paidAt).map(([, e]) => e.cents ?? r.cents)));
  const irpf = state.settings.irpf || {};
  const pgbl = sumCents((state.investments || []).filter((i) => i.pension === 'pgbl').flatMap((i) => i.movements).filter((m) => m.kind === 'aporte' && m.date.startsWith(String(year))).map((m) => m.cents));
  const deductions = {
    inss,
    dependents: dependents * IRPF_LIMITS.dependent,
    medical: medicalPayroll + medicalExpenses,
    education: Math.min(irpf.educationCents || 0, IRPF_LIMITS.education * (1 + dependents)),
    pgbl: Math.min(pgbl, Math.round((taxable * IRPF_LIMITS.pgblPct) / 100)),
    pension: irpf.pensionCents || 0,
    other: irpf.otherDeductibleCents || 0,
  };
  const legal = sumCents(Object.values(deductions));
  const simplified = Math.min(Math.round(taxable * 0.2), IRPF_LIMITS.simplifiedCap);
  const model = legal > simplified ? 'completo' : 'simplificado';
  const base = Math.max(0, taxable - Math.max(legal, simplified));
  const tax = annualTax(base, year);
  const reduction = annualReduction(taxable, tax, year);
  const due = tax - reduction;
  const result = due - withheld; // > 0: pagar · < 0: restituir
  return {
    year, months: counted, partial: String(year) === today.slice(0, 4), taxable, withheld, inss, deductions, legal, simplified, model,
    base, tax, reduction, due, result, refund: result < 0 ? -result : 0, toPay: result > 0 ? result : 0,
    exclusive: { thirteenthNet, plrGross },
  };
}
