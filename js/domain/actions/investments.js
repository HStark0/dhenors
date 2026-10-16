// =============================================================
// actions/investments.js — Investimentos, taxas e cotações
// =============================================================

import { store } from '../../core/store.js';
import { ymOf, todayISO } from '../../core/dates.js';
import { newId } from '../schema.js';
import { INVEST_TYPES, RATE_KINDS, LIQUIDITY, MOVEMENT_KINDS, CLASS_KEYS, positionAt, investingOf } from '../investments.js';
import { ValidationError, text, cents, date, intRange, assertOpen, findOrThrow, brl } from './core.js';

/** Cria ou edita um investimento. Novo: aceita um aporte inicial ({ initialCents, initialDate, initialQty }). */
export function saveInvestment(input) {
  return store.commit((d) => {
    d.investments ||= [];
    if (!INVEST_TYPES[input.type]) throw new ValidationError('Escolha o tipo de investimento.', 'type');
    const kind = RATE_KINDS[input.rateKind] ? input.rateKind : 'none';
    const needsBp = kind === 'cdi' || kind === 'pre' || kind === 'ipca';
    if (needsBp && (!Number.isInteger(input.rateBp) || input.rateBp <= 0 || input.rateBp > 50000)) {
      throw new ValidationError('Informe a taxa (ex.: 100 para 100% do CDI).', 'rateBp');
    }
    const ticker = String(input.ticker || '').trim().toUpperCase();
    if (ticker && !/^[A-Z0-9]{4,8}$/.test(ticker)) throw new ValidationError('Código inválido. Ex.: PETR4, HGLG11, BOVA11.', 'ticker');
    const item = {
      name: text(input.name, 'name', 'o nome', { max: 80 }),
      type: input.type,
      institution: text(input.institution, 'institution', 'a instituição', { max: 60, required: false }),
      rate: { kind, bp: needsBp ? input.rateBp : 0 },
      liquidity: LIQUIDITY[input.liquidity] ? input.liquidity : 'none',
      maturity: date(input.maturity, 'maturity', { required: false }),
      emergency: input.emergency === true,
      notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }),
      ticker,
      pension: ['pgbl', 'vgbl'].includes(input.pension) ? input.pension : '',
    };
    if (input.id) {
      Object.assign(findOrThrow(d.investments, input.id, 'Investimento'), item);
      return null;
    }
    const inv = { id: newId(), ...item, movements: [] };
    if (Number.isInteger(input.initialCents) && input.initialCents > 0) {
      const qty = Number(input.initialQty);
      inv.movements.push({ id: newId(), kind: 'aporte', date: date(input.initialDate || todayISO(), 'initialDate'), cents: cents(input.initialCents, 'initialCents'), note: '', ...(qty > 0 ? { qty } : {}) });
    }
    d.investments.push(inv);
    return inv;
  });
}

export function deleteInvestment(id) {
  return store.commit((d) => {
    d.investments = (d.investments || []).filter((x) => x.id !== id);
    for (const g of d.goals) g.investmentIds = (g.investmentIds || []).filter((x) => x !== id);
  }, 'change', { undo: 'Investimento excluído' });
}

/**
 * Registra um movimento: aporte, resgate, venda, provento ou atualização de saldo.
 * Com `asExpense`, o aporte também vira um gasto pago no mês
 * (categoria Investimentos) e sai do saldo do mês.
 * `qty` (ações/FII/ETF): quantidade comprada ou vendida.
 */
export function addInvestmentMovement(investmentId, input) {
  return store.commit((d) => {
    const inv = findOrThrow(d.investments || [], investmentId, 'Investimento');
    if (!MOVEMENT_KINDS[input.kind]) throw new ValidationError('Tipo de movimento inválido.');
    const when = date(input.date, 'date');
    if (when > todayISO()) throw new ValidationError('A data não pode ser no futuro.', 'date');
    const value = cents(input.cents, 'cents', { allowZero: input.kind === 'saldo' });
    const qty = Number(input.qty);
    if (input.kind === 'resgate' || input.kind === 'venda') {
      const { value: available, qty: held } = positionAt(inv, investingOf(d.settings), when, d.settings.quotes);
      if (value > available + 1) throw new ValidationError(`O valor é maior que o saldo nessa data (${brl(available)}).`, 'cents');
      if (qty > 0 && held && qty > held + 1e-9) throw new ValidationError(`Você tem ${held.toLocaleString('pt-BR')} cotas nessa data.`, 'qty');
    }
    const mov = {
      id: newId(), kind: input.kind, date: when, cents: value,
      note: text(input.note, 'note', 'a observação', { max: 120, required: false }),
      ...(qty > 0 && ['aporte', 'venda', 'resgate'].includes(input.kind) ? { qty } : {}),
    };
    if (input.kind === 'aporte' && input.asExpense) {
      assertOpen(d, ymOf(when), 'date');
      const cat = d.categories.find((c) => /investimento/i.test(c.name));
      const expense = {
        id: newId(), description: `Aporte: ${inv.name}`.slice(0, 120), cents: value, dueDate: when, paidAt: when,
        categoryId: cat?.id || null, subcategoryId: null, creditorId: null, notes: 'Lançado pela tela Investimentos', tags: [], splits: [], attachments: [],
      };
      d.expenses.push(expense);
      mov.expenseId = expense.id;
    }
    inv.movements.push(mov);
    return mov;
  });
}

/** Remove um movimento (e o gasto do mês ligado a ele, se o mês estiver aberto). */
export function deleteInvestmentMovement(investmentId, movementId) {
  return store.commit((d) => {
    const inv = findOrThrow(d.investments || [], investmentId, 'Investimento');
    const mov = findOrThrow(inv.movements, movementId, 'Movimento');
    inv.movements = inv.movements.filter((m) => m.id !== movementId);
    // Sem o aporte, um resgate posterior pode ficar maior que o saldo
    const investing = investingOf(d.settings);
    for (const m of inv.movements.filter((x) => x.kind === 'resgate' || x.kind === 'venda')) {
      const before = positionAt({ ...inv, movements: inv.movements.filter((x) => x.id !== m.id) }, investing, m.date).value;
      if (m.cents > before + 1) throw new ValidationError('Remova antes os resgates feitos depois: o saldo ficaria negativo.');
    }
    if (mov.expenseId) {
      const exp = d.expenses.find((x) => x.id === mov.expenseId);
      if (exp && !d.closedMonths[ymOf(exp.dueDate)]) d.expenses = d.expenses.filter((x) => x.id !== exp.id);
    }
  }, 'change', { undo: 'Movimento removido' });
}

/** Premissas da carteira: CDI, IPCA, Selic, meta de aporte e carteira ideal (% por classe, soma 100). */
export function saveInvestingSettings(input) {
  return store.commit((d) => {
    const bp = (v, field, label) => {
      if (!Number.isInteger(v) || v < 0 || v > 10000) throw new ValidationError(`${label} deve ser entre 0 e 100%.`, field);
      return v;
    };
    const targets = {};
    for (const [k, v] of Object.entries(input.targets || {})) {
      if (!CLASS_KEYS.includes(k) || !v) continue;
      if (!Number.isInteger(v) || v < 0 || v > 100) throw new ValidationError('Use percentuais inteiros entre 0 e 100.', `target-${k}`);
      targets[k] = v;
    }
    const total = Object.values(targets).reduce((a, n) => a + n, 0);
    if (total && total !== 100) throw new ValidationError(`A carteira ideal soma ${total}%: precisa somar 100% (ou deixe tudo vazio).`, 'targets');
    const prev = d.settings.investing || {};
    d.settings.investing = {
      ...prev,
      cdiBp: bp(input.cdiBp, 'cdi', 'O CDI'),
      ipcaBp: bp(input.ipcaBp, 'ipca', 'O IPCA'),
      selicBp: input.selicBp == null ? (prev.selicBp ?? 1500) : bp(input.selicBp, 'selic', 'A Selic'),
      monthlyTargetCents: cents(input.monthlyTargetCents || 0, 'monthlyTargetCents', { allowZero: true }),
      targets,
    };
  });
}

/** Taxas e índices baixados do Banco Central (core/market.js). */
export function applyMarketRates({ cdiBp, selicBp, ipca12Bp, igpm12Bp, ipcaMonthly, igpmMonthly, cdiMonthly, ibovMonthly }) {
  return store.commit((d) => {
    const now = new Date().toISOString();
    const inv = d.settings.investing || {};
    if (Number.isInteger(cdiBp)) inv.cdiBp = cdiBp;
    if (Number.isInteger(selicBp)) inv.selicBp = selicBp;
    if (Number.isInteger(ipca12Bp)) inv.ipcaBp = ipca12Bp;
    inv.ratesUpdatedAt = now;
    d.settings.investing = inv;
    const idx = d.settings.indices || {};
    if (Number.isInteger(ipca12Bp)) idx.ipca12Bp = ipca12Bp;
    if (Number.isInteger(igpm12Bp)) idx.igpm12Bp = igpm12Bp;
    if (ipcaMonthly) idx.ipcaMonthly = { ...(idx.ipcaMonthly || {}), ...ipcaMonthly };
    if (igpmMonthly) idx.igpmMonthly = { ...(idx.igpmMonthly || {}), ...igpmMonthly };
    if (cdiMonthly) idx.cdiMonthly = { ...(idx.cdiMonthly || {}), ...cdiMonthly };
    if (ibovMonthly) idx.ibovMonthly = { ...(idx.ibovMonthly || {}), ...ibovMonthly };
    idx.updatedAt = now;
    d.settings.indices = idx;
  }, 'silent');
}

/** Cotações baixadas (brapi): { PETR4: centavos por cota }. */
export function applyQuotes(prices) {
  return store.commit((d) => {
    const at = new Date().toISOString();
    const q = { ...(d.settings.quotes || {}) };
    for (const [t, price] of Object.entries(prices)) if (/^[A-Z0-9^.]{2,12}$/.test(t) && Number.isInteger(price) && price >= 0) q[t] = { price, at };
    d.settings.quotes = q;
  });
}

/** Independência financeira: idade, idade-alvo, custo mensal e taxa de retirada. */
export function saveFiSettings({ age, targetAge, monthlyCostCents, withdrawalBp = 400 }) {
  return store.commit((d) => {
    d.settings.investing = {
      ...(d.settings.investing || {}),
      fi: {
        age: intRange(age, 'age', 14, 100, 'A idade'),
        targetAge: intRange(targetAge, 'targetAge', 15, 110, 'A idade-alvo'),
        monthlyCostCents: cents(monthlyCostCents, 'monthlyCost'),
        withdrawalBp: intRange(withdrawalBp, 'withdrawal', 100, 1500, 'A taxa de retirada'),
      },
    };
  });
}
