// =============================================================
// taxTables.js — Tabelas oficiais de INSS e Imposto de Renda
// -------------------------------------------------------------
// Valores em REAIS (como publicados). O cálculo converte para centavos.
// Para um ano novo: copie o último bloco, troque o ano e os valores.
// Meses de anos sem tabela usam a tabela mais próxima disponível.
//
// Fontes (2026):
//  • INSS: tabela de contribuição do empregado vigente desde jan/2026 —
//    salário mínimo R$ 1.621,00, teto R$ 8.475,55 (contribuição máx. R$ 988,09).
//  • IRRF: tabela progressiva mensal + redução da Lei 15.270/2025
//    (isenção efetiva até R$ 5.000; redução parcial até R$ 7.350).
//  • Salário-família 2026: R$ 67,54 por filho até 14 anos, para
//    remuneração até R$ 1.980,38 (portaria interministerial anual).
// =============================================================

export const TAX_TABLES = {
  2025: {
    minimumWage: 1518.00,
    inss: [ // faixas progressivas: [até, alíquota]
      [1518.00, 0.075],
      [2793.88, 0.09],
      [4190.83, 0.12],
      [8157.41, 0.14],
    ],
    irrf: [ // [base até, alíquota, parcela a deduzir]
      [2428.80, 0, 0],
      [2826.65, 0.075, 182.16],
      [3751.05, 0.15, 394.16],
      [4664.68, 0.225, 675.49],
      [Infinity, 0.275, 908.73],
    ],
    dependent: 189.59,
    simplified: 607.20,
    family: { quota: 65.00, limit: 1906.04 }, // salário-família: cota por filho e limite de remuneração
    reduction: null, // sem redutor em 2025
  },

  2026: {
    minimumWage: 1621.00,
    inss: [
      [1621.00, 0.075],
      [2902.84, 0.09],
      [4354.27, 0.12],
      [8475.55, 0.14],
    ],
    irrf: [
      [2428.80, 0, 0],
      [2826.65, 0.075, 182.16],
      [3751.05, 0.15, 394.16],
      [4664.68, 0.225, 675.49],
      [Infinity, 0.275, 908.73],
    ],
    dependent: 189.59,
    simplified: 607.20,
    family: { quota: 67.54, limit: 1980.38 },
    // Redução do imposto (Lei 15.270/2025), calculada sobre os
    // rendimentos tributáveis do mês (bruto tributável):
    //   até R$ 5.000      → reduz até R$ 312,89 (zera o imposto)
    //   R$ 5.000,01–7.350 → reduz R$ 978,62 − 0,133145 × rendimentos
    //   acima de 7.350    → sem redução
    // A redução nunca passa do imposto calculado.
    reduction: { fullUpTo: 5000, fullMax: 312.89, partialUpTo: 7350, a: 978.62, b: 0.133145 },
  },
};

/** Tabela do ano (ou do ano mais próximo disponível). */
export function tablesFor(year) {
  const years = Object.keys(TAX_TABLES).map(Number).sort((a, b) => a - b);
  const pick = years.filter((y) => y <= year).pop() ?? years[0];
  return { year: pick, ...TAX_TABLES[pick] };
}

export const LATEST_TAX_YEAR = Math.max(...Object.keys(TAX_TABLES).map(Number));
