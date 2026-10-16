// @ts-check
// =============================================================
// actions.js — Todas as operações de escrita, com validação
// -------------------------------------------------------------
// As telas nunca alteram `store.data` diretamente: chamam uma
// função daqui. Cada função valida a entrada e lança
// ValidationError (com o campo) quando algo está errado.
//
// O código fica dividido por assunto em domain/actions/:
//   core.js         validadores e utilidades
//   settings.js     perfil, aparência, painel, lembretes, onboarding
//   payroll.js      salário, holerite, férias, afastamentos, plantões,
//                   benefícios, vínculos, FGTS, tabelas de IR
//   bills.js        contas, recorrentes, parcelamentos, pagamento,
//                   ações em lote, a receber, dívidas
//   wallet.js       cartões, compras no cartão, contas e carteiras
//   planning.js     metas, desejos, envelopes, orçamentos, cenários,
//                   fechamento de mês
//   investments.js  investimentos, taxas do BC e cotações
//   categories.js   credores, categorias, regras e importação
// Este arquivo só reexporta: `import * as A from './actions.js'`
// continua funcionando em todo o app.
// =============================================================

export { ValidationError } from './actions/core.js';
export * from './actions/settings.js';
export * from './actions/payroll.js';
export * from './actions/bills.js';
export * from './actions/wallet.js';
export * from './actions/planning.js';
export * from './actions/investments.js';
export * from './actions/categories.js';
