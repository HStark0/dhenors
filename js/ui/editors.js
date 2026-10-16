// =============================================================
// editors.js — Janelas de cadastro/edição de cada tipo de dado
// -------------------------------------------------------------
// Qualquer tela pode abrir estes formulários. Toda gravação
// passa por domain/actions.js (que valida).
//
// Divididos por assunto em ui/editors/:
//   bills.js       contas, recorrentes, parcelamentos, anexos, boleto/Pix, "Novo"
//   income.js      receitas e meta de gastos
//   planning.js    metas, desejos, envelopes
//   wallet.js      cartões, compras, faturas, contas, transferências
//   people.js      credores, "quem me deve", dívidas
//   categories.js  categorias e subcategorias
// Este arquivo só reexporta (import * as E from './editors.js').
// =============================================================

export * from './editors/bills.js';
export * from './editors/income.js';
export * from './editors/planning.js';
export * from './editors/wallet.js';
export * from './editors/people.js';
export * from './editors/categories.js';
export { editSalaryBase, editPayrollLine } from './payrollEditor.js';
