// @ts-check
// =============================================================
// benefits.js — Benefícios separados e outros vínculos de trabalho
// -------------------------------------------------------------
// Benefícios (settings.benefits):
//   va / vr  vale-alimentação/refeição: crédito no cartão do benefício,
//            NÃO é dinheiro na conta (mostrado à parte; abate gastos
//            de Alimentação no planejamento).
//   plr      Participação nos Lucros: tributada EXCLUSIVAMENTE pela
//            tabela própria da PLR, no mês em que é paga.
//   abono    Abono salarial (PIS/PASEP): até 1 salário mínimo, isento.
//   outro    Qualquer outro valor recebido no mês (já líquido).
//
// Vínculos (settings.jobs): segundo emprego, CLT + PJ, servidor +
// plantão em outro hospital. Cada um calcula o próprio líquido:
//   clt       INSS progressivo + IRRF
//   servidor  previdência com alíquota fixa + IRRF
//   pj        bruto − impostos da empresa (% informado, ex.: Simples 6%)
//   autonomo  INSS de 20% (até o teto) + IR mensal (carnê-leão)
// Observação: com dois vínculos CLT, o INSS total tem teto; o app avisa
// quando a soma dos salários passa do teto (o excesso pode ser restituído).
// =============================================================

import { tablesForYM } from './taxTables.js';
import { inssFor, irrfFor } from './payroll.js';

/**
 * Tabela exclusiva da PLR (Lei 10.101/2000, valores anuais em reais).
 * [até, alíquota, parcela a deduzir]. Atualize se a Receita publicar outra.
 */
export const PLR_TABLE = [
  [7640.80, 0, 0],
  [9922.28, 0.075, 573.06],
  [13167.00, 0.15, 1317.23],
  [16380.38, 0.225, 2304.76],
  [Infinity, 0.275, 3123.78],
];

export function plrTax(grossCents) {
  const v = grossCents / 100;
  for (const [upto, rate, ded] of PLR_TABLE) if (v <= upto) return Math.max(0, Math.round((v * rate - ded) * 100));
  return 0;
}

export const BENEFIT_LABELS = { va: 'Vale-alimentação', vr: 'Vale-refeição', plr: 'PLR', abono: 'Abono salarial (PIS)', outro: 'Outro benefício' };

/**
 * Benefícios do mês.
 * → { cash: [{ id, name, kind, gross, tax, net }], card: [{ id, name, kind, cents }], cashNet, cardTotal }
 */
export function benefitsIn(settings, ym) {
  const [y, m] = ym.split('-').map(Number);
  const cash = [];
  const card = [];
  for (const b of settings.benefits || []) {
    if (!b.cents) continue;
    if (b.kind === 'va' || b.kind === 'vr') {
      if (b.monthly !== false) card.push({ id: b.id, name: b.name, kind: b.kind, cents: b.cents });
      continue;
    }
    const inMonth = b.monthly || (b.month === m && (!b.year || b.year === y));
    if (!inMonth) continue;
    const tax = b.kind === 'plr' ? plrTax(b.cents) : 0;
    cash.push({ id: b.id, name: b.name, kind: b.kind, gross: b.cents, tax, net: b.cents - tax });
  }
  return {
    cash, card,
    cashNet: cash.reduce((s, x) => s + x.net, 0),
    cardTotal: card.reduce((s, x) => s + x.cents, 0),
  };
}

export const JOB_KIND_LABELS = { clt: 'CLT', servidor: 'Servidor público', pj: 'PJ', autonomo: 'Autônomo' };

/** Líquido de um vínculo no mês. → { gross, inss, ir, tax, net, note } */
export function jobNet(job, ym) {
  if ((job.from && ym < job.from) || (job.to && ym > job.to) || !job.grossCents) return null;
  const table = tablesForYM(ym);
  const gross = job.grossCents;
  if (job.kind === 'pj') {
    const tax = Math.round((gross * (job.pjTaxBp || 0)) / 10000);
    return { gross, inss: 0, ir: 0, tax, net: gross - tax, note: `${(job.pjTaxBp / 100).toLocaleString('pt-BR')}% de impostos da empresa` };
  }
  let inss;
  if (job.kind === 'servidor' || job.regime === 'fixed') inss = Math.round((gross * (job.fixedRateBp || 1400)) / 10000);
  else if (job.kind === 'autonomo') {
    const ceiling = Math.round(table.inss[table.inss.length - 1][0] * 100);
    inss = Math.round(Math.min(gross, ceiling) * 0.2);
  } else inss = inssFor(gross, table);
  const ir = irrfFor({ taxableCents: gross, inssCents: inss }, table).value;
  return { gross, inss, ir, tax: 0, net: gross - inss - ir, note: job.kind === 'autonomo' ? 'INSS 20% + carnê-leão (estimativa)' : '' };
}

/** Todos os vínculos extras do mês. → { list: [{ job, ...jobNet }], net, overCeiling } */
export function jobsIn(settings, ym, mainGross = 0) {
  const list = (settings.jobs || []).map((job) => ({ job, r: jobNet(job, ym) })).filter((x) => x.r).map(({ job, r }) => ({ job, ...r }));
  const table = tablesForYM(ym);
  const ceiling = Math.round(table.inss[table.inss.length - 1][0] * 100);
  const cltGross = mainGross + list.filter((x) => x.job.kind === 'clt').reduce((s, x) => s + x.gross, 0);
  return { list, net: list.reduce((s, x) => s + x.net, 0), overCeiling: list.some((x) => x.job.kind === 'clt') && cltGross > ceiling };
}
