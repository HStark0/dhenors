// @ts-check
// =============================================================
// schema.js — Formato dos dados salvos
// -------------------------------------------------------------
// Todo o estado do app é UM objeto JSON. Ele é salvo no
// navegador (IndexedDB) e é exatamente o que vai no backup.
//
// Formato (schema 9):
// {
//   schema: 9,
//   settings: {
//     profileName, salaryDay, theme, accent, density, motion,
//     payday: { mode: 'fixed'|'business', nth, saturday, nextMonth },
//     salaryHistory: [perfil salarial BRUTO — ver domain/payroll.js], // vale a partir de `from`
//     payrollLoans: [desconto parcelado/consignado — ver domain/payroll.js],
//     payrollVariable: [adicional/desconto VARIÁVEL de um mês — ver domain/payroll.js],
//     employment: { admission, regime: 'inss'|'fixed', fixedRateBp, thirteenth, hoursDivisor, familyChildren },
//     actualNet: { "AAAA-MM": centavos },                     // líquido conferido no holerite real
//     onCallHours: { "AAAA-MM": { idDaLinha: minutos } },      // horas de sobreaviso do mês
//     vacations: [{ id, start, days, sellDays, advance13 }],  // férias
//     absences: [{ id, ym, kind: 'atestado'|'inss'|'falta', days, note }],
//     budgets: { idCategoria: centavos },                     // orçamento mensal por categoria
//     reminders: { enabled, daysBefore, mode: 'each'|'daily'|'weekly', push },
//     rules: [{ id, pattern, categoryId, subcategoryId }],    // categorização automática
//     spendingLimitCents,                                      // meta (limite) de gastos mensal
//     parcelLimitPct: 10|20|30,                                // teto das parcelas sobre os ganhos fixos (painel)
//     reservePct: 10|20|30,                                    // quanto guardar na reserva de emergência (painel)
//     trackingStartYM: "AAAA-MM" | null,                       // mês em que os cálculos começam (null = automático, ver tracking.js)
//     alerts: { tightPct, overspendPct, bigPct, push },        // limites de "apertado", "exagerado", "grande"
//     investing: { cdiBp, ipcaBp, selicBp, monthlyTargetCents, targets: { classe: % }, ratesUpdatedAt },
//     indices: { ipca12Bp, igpm12Bp, ipcaMonthly: { "AAAA-MM": bp }, igpmMonthly, updatedAt }, // BCB
//     quotes: { TICKER: { price (centavos), at } },           // cotações (brapi)
//     shiftTypes: [{ id, name, hours, cents, payroll, night, weekend }], // tipos de plantão
//     benefits: [{ id, kind: 'va'|'vr'|'plr'|'abono'|'outro', name, cents, month, monthly }],
//     jobs: [{ id, name, kind: 'clt'|'pj'|'servidor'|'autonomo', grossCents, regime, fixedRateBp, pjTaxBp, day, from, to }],
//     fgts: { balanceCents, date },                            // saldo do FGTS informado
//     taxTables: { "2027": tabela },                            // tabelas de INSS/IR adicionadas por você
//     irpf: { otherDeductibleCents, educationCents, pensionCents, dependents },
//     rule503020: { needs, wants, savings, enabled },
//     envelopes: [{ id, name, icon, monthlyCents, categoryIds, rollover }],
//     scenarios: [{ id, name, scenario, createdAt }],          // simulações salvas
//     savedSearches: [{ id, name, query }],
//     dashboard: { order: [ids], hidden: [ids], pinned: [ids] },
//     tabbar: [ids],                                            // atalhos da barra do celular
//     onboardingSteps: { salary, bills, card, goal, cloud },
//     help: { dismissed: [ids] },
//     lastSeenVersion,                                          // para a tela "Novidades"
//     salaryAccountId,                                          // conta onde o salário cai
//   },
//   importFingerprints: [ "data|valor|descrição" ],              // evita importar 2× o mesmo extrato
//   investments:  [{ id, name, type, institution, rate: { kind, bp }, liquidity, maturity, emergency, notes,
//                    ticker, quantity, avgPriceCents,
//                    movements: [{ id, date, kind: 'aporte'|'resgate'|'provento'|'saldo'|'venda', cents, qty, note, expenseId }] }],
//   extraIncomes: [{ id, ym, description, cents, date, payroll, kind, accountId }],  // plantões, freelas, reembolsos…
//   recurringIncomes: [{ id, description, cents, day, startYM, endYM, kind, accountId, skipped: ["AAAA-MM"] }],
//                                                               // ganhos FORA da folha que se repetem todo mês
//   expenses:     [{ id, description, cents, dueDate, paidAt, categoryId, subcategoryId, creditorId, notes,
//                    accountId, tags, splits: [{ categoryId, subcategoryId, cents }], attachments: [{ id, name, type, size, k }], boleto, pix }],
//   recurring:    [{ id, description, cents, dueDay, startYM, endYM, categoryId, subcategoryId, creditorId, notes,
//                    freq, anchorDate, variable, subscription, renewal, adjust: { index, month, lastYM }, priceHistory, accountId, cardId, tags }],
//   recurringEntries: { "idRecorrente|AAAA-MM" ou "idRecorrente|AAAA-MM-DD": { paidAt, cents, skipped } },
//   installments: [{ id, description, totalCents, count, firstDueDate, dueDay, paid: [nºs pagos], paidOn: { n: data },
//                    categoryId, subcategoryId, creditorId, notes, tags }],
//   cards:        [{ id, name, closingDay, dueDay, limitCents, color, accountId, archived }],
//   cardPurchases:[{ id, cardId, description, date, cents, count, categoryId, subcategoryId, tags, notes }],
//   cardInvoices: { "idCartão|AAAA-MM": { paidAt, cents } },   // pagamento da fatura
//   accounts:     [{ id, name, kind, institution, color, anchor: { cents, date }, archived }],
//   transfers:    [{ id, fromId, toId, cents, date, note }],
//   balanceChecks:[{ id, accountId, date, cents }],             // saldo real informado (banco)
//   shifts:       [{ id, date, typeId, note, cents }],          // escala de plantões
//   receivables:  [{ id, creditorId, person, description, cents, date, dueDate, receivedAt, notes }],
//   debts:        [{ id, name, creditorId, balanceCents, rateMonthlyBp, paymentCents, notes }],
//   wishlist:     [{ id, name, targetPriceCents, currentPriceCents, url, goalId, priority, boughtAt }],
//   goals:        [{ id, description, kind, targetCents, autoTarget, system, deadline, icon, emergency, investmentIds, contributions: [{ id, date, cents }] }],
//                 // "Reservas" na tela. kind: ver GOAL_KINDS (goals.js); system = a Reserva de emergência padrão (não exclui);
//                 // autoTarget = alvo de 6 meses de gastos calculado sozinho (targetCents fica 0)
//   creditors:    [{ id, name, notes }],
//   categories:   [{ id, name, icon, color, group: 'needs'|'wants'|'savings', subcategories: [{ id, name }] }],
//   closedMonths: { "AAAA-MM": snapshot },                       // fotografia do mês fechado
//   scoreHistory: { "AAAA-MM": pontuação },                      // nota de saúde no fechamento
// }
//
// Histórico de versões do formato (migração em sanitizeState):
//   1 → salário líquido · 2 → perfil bruto · 3 → consignados próprios
//   4–6 → férias, afastamentos, investimentos · 7 → regras/orçamentos
//   8 → cartões, contas, plantões, dívidas…; data REAL do pagamento das
//       parcelas; reserva de emergência só por marcação (não pelo nome);
//       cores de categoria que conflitavam com as cores de estado.
//   9 → ganhos extras recorrentes (recurringIncomes) e limites dos
//       alertas (settings.alerts). Nada muda nos dados antigos: os
//       campos novos começam vazios / com o padrão.
//
// O código está dividido em módulos coesos; este arquivo mantém a
// MESMA API pública (reexporta tudo):
//   stateShape.js       versão, newId, estado vazio, listas fixas
//   sanitizeState.js    backup → estado limpo (sanitizeState)
//   sanitizePayroll.js  limpeza do salário (sanitizeProfile…)
//   sanitizeInvest.js   limpeza dos investimentos
//   sanitizeUtil.js     validadores básicos
// =============================================================

export { SCHEMA_VERSION, newId, createDefaultCategories, DEFAULT_SHIFT_TYPES, DEFAULT_ALERTS, createEmptyState, FREQS, INCOME_KINDS, ACCOUNT_KINDS } from './stateShape.js';
export { sanitizeState } from './sanitizeState.js';
export { sanitizeProfile } from './sanitizePayroll.js';

/** Perfil salarial vigente no mês (reexportado de payroll.js por conveniência). */
export { payrollProfileFor } from './payroll.js';
