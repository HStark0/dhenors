// @ts-check
// =============================================================
// sanitizeInvest.js — Limpeza dos investimentos no backup:
// configurações, índices, cotações e a carteira.
// -------------------------------------------------------------
// Parte de domain/schema.js.
// =============================================================

import { isValidISO, isValidYM } from '../core/dates.js';
import { INVEST_TYPES, RATE_KINDS, LIQUIDITY, MOVEMENT_KINDS, CLASS_KEYS, DEFAULT_INVESTING } from './investments.js';
import { newId } from './stateShape.js';
import { isObj, isInt, str, optId, arr, pick } from './sanitizeUtil.js';

export function sanitizeInvesting(v) {
  const o = isObj(v) ? v : {};
  const bp = (x, def, max) => (isInt(x) && x >= 0 && x <= max ? x : def);
  const targets = {};
  if (isObj(o.targets)) {
    for (const k of CLASS_KEYS) if (isInt(o.targets[k]) && o.targets[k] > 0 && o.targets[k] <= 100) targets[k] = o.targets[k];
  }
  return {
    cdiBp: bp(o.cdiBp, DEFAULT_INVESTING.cdiBp, 10000),
    ipcaBp: bp(o.ipcaBp, DEFAULT_INVESTING.ipcaBp, 10000),
    selicBp: bp(o.selicBp, DEFAULT_INVESTING.selicBp, 10000),
    monthlyTargetCents: bp(o.monthlyTargetCents, 0, 1_000_000_000),
    targets: Object.values(targets).reduce((a, n) => a + n, 0) === 100 ? targets : {},
    ratesUpdatedAt: str(o.ratesUpdatedAt, 40) || null,
    fi: isObj(o.fi) ? { age: bp(o.fi.age, 30, 120), targetAge: bp(o.fi.targetAge, 60, 120), monthlyCostCents: bp(o.fi.monthlyCostCents, 0, 1_000_000_000), withdrawalBp: bp(o.fi.withdrawalBp, 400, 2000) } : null,
  };
}

export function sanitizeIndices(v) {
  const o = isObj(v) ? v : {};
  const monthly = (m) => {
    const out = {};
    if (isObj(m)) for (const [k, x] of Object.entries(m)) if (isValidYM(k) && isInt(x) && Math.abs(x) <= 10000) out[k] = x;
    return out;
  };
  return {
    ipca12Bp: isInt(o.ipca12Bp) ? o.ipca12Bp : 450,
    igpm12Bp: isInt(o.igpm12Bp) ? o.igpm12Bp : 400,
    ipcaMonthly: monthly(o.ipcaMonthly),
    igpmMonthly: monthly(o.igpmMonthly),
    cdiMonthly: monthly(o.cdiMonthly),
    ibovMonthly: monthly(o.ibovMonthly),
    updatedAt: str(o.updatedAt, 40) || null,
  };
}

export function sanitizeQuotes(q) {
  const out = {};
  if (isObj(q)) {
    for (const [k, v] of Object.entries(q)) {
      if (/^[A-Z0-9^.]{2,12}$/.test(k) && isObj(v) && isInt(v.price) && v.price >= 0) out[k] = { price: v.price, at: str(v.at, 40) };
    }
  }
  return out;
}

export function sanitizeInvestment(x) {
  if (!isObj(x) || !str(x.name).trim()) return null;
  const type = INVEST_TYPES[x.type] ? x.type : 'outro';
  const r = isObj(x.rate) ? x.rate : {};
  const kind = RATE_KINDS[r.kind] ? r.kind : 'none';
  return {
    id: optId(x.id) || newId(),
    name: str(x.name, 80).trim(),
    type,
    institution: str(x.institution, 60),
    rate: { kind, bp: kind === 'none' || kind === 'poup' ? 0 : (isInt(r.bp) && r.bp >= 0 && r.bp <= 50000 ? r.bp : 0) },
    liquidity: LIQUIDITY[x.liquidity] ? x.liquidity : 'none',
    maturity: isValidISO(x.maturity) ? x.maturity : null,
    emergency: x.emergency === true,
    notes: str(x.notes, 500),
    ticker: /^[A-Z0-9]{4,8}$/.test(String(x.ticker || '').toUpperCase()) ? String(x.ticker).toUpperCase() : '',
    pension: pick(x.pension, ['pgbl', 'vgbl', ''], ''),
    movements: arr(x.movements)
      .filter((m) => isObj(m) && MOVEMENT_KINDS[m.kind] && isValidISO(m.date) && isInt(m.cents)
        && (m.kind === 'saldo' ? m.cents >= 0 : m.cents > 0) && m.cents <= 1_000_000_000)
      .slice(0, 5000)
      .map((m) => ({
        id: optId(m.id) || newId(), date: m.date, kind: m.kind, cents: m.cents, note: str(m.note, 120),
        ...(typeof m.qty === 'number' && Number.isFinite(m.qty) && m.qty > 0 ? { qty: m.qty } : {}),
        ...(optId(m.expenseId) ? { expenseId: optId(m.expenseId) } : {}),
      })),
  };
}
