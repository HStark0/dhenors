// @ts-check
// =============================================================
// boleto.js — Lê a linha digitável / código de barras do boleto
// -------------------------------------------------------------
// Preenche valor e vencimento sozinho a partir de:
//  • Boleto bancário: linha digitável (47 dígitos) ou código de
//    barras (44 dígitos). Valor = 10 dígitos; vencimento = "fator"
//    (dias desde 07/10/1997; em 22/02/2025 o fator voltou a 1000).
//  • Conta de consumo/tributo ("arrecadação", começa com 8): linha
//    de 48 dígitos ou código de 44. Valor nos dígitos 5–15 quando o
//    identificador de valor é 6 ou 8 (reais). Vencimento, quando há,
//    vem no campo livre como AAAAMMDD.
// Os dígitos verificadores são conferidos (módulo 10 e 11): uma
// linha digitada errada é recusada em vez de gerar valor errado.
// =============================================================

import { addDaysISO, isValidISO, todayISO, diffDays, toISO } from '../core/dates.js';

const BANKS = {
  '001': 'Banco do Brasil', '033': 'Santander', '041': 'Banrisul', '070': 'BRB', '077': 'Inter', '104': 'Caixa',
  '197': 'Stone', '208': 'BTG Pactual', '212': 'Banco Original', '237': 'Bradesco', '260': 'Nubank', '290': 'PagBank',
  '323': 'Mercado Pago', '336': 'C6 Bank', '341': 'Itaú', '380': 'PicPay', '422': 'Safra', '748': 'Sicredi', '756': 'Sicoob',
};

function mod10(num) {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * w;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    w = w === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/** Módulo 11 do boleto bancário (pesos 2 a 9; resultado 0, 10 ou 11 vira 1). */
function mod11Bank(num) {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação (resultado 10 ou 11 vira 0). */
function mod11Collect(num) {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
}

/** Vencimento pelo fator (escolhe a data mais próxima de hoje entre as duas bases). */
export function dueFromFactor(factor, today = todayISO()) {
  if (!factor) return null;
  const a = addDaysISO('1997-10-07', factor);
  const b = factor >= 1000 ? addDaysISO('2025-02-22', factor - 1000) : null;
  if (!b) return a;
  return Math.abs(diffDays(today, a)) <= Math.abs(diffDays(today, b)) ? a : b;
}

function bankFromBarcode(bc, today) {
  if (mod11Bank(bc.slice(0, 4) + bc.slice(5)) !== Number(bc[4])) throw new Error('Código de barras inválido (dígito verificador não confere).');
  const factor = Number(bc.slice(5, 9));
  return {
    kind: 'bancario', barcode: bc,
    bank: BANKS[bc.slice(0, 3)] || `Banco ${bc.slice(0, 3)}`,
    cents: Number(bc.slice(9, 19)),
    dueDate: dueFromFactor(factor, today),
  };
}

function collectFromBarcode(bc) {
  const valueId = bc[2];
  const dvFn = valueId === '6' || valueId === '7' ? mod10 : mod11Collect;
  if (dvFn(bc.slice(0, 3) + bc.slice(4)) !== Number(bc[3])) throw new Error('Código de barras inválido (dígito verificador não confere).');
  const SEG = { 1: 'Prefeitura', 2: 'Saneamento', 3: 'Energia elétrica e gás', 4: 'Telecomunicações', 5: 'Órgão governamental', 6: 'Carnê', 7: 'Multa de trânsito', 9: 'Uso exclusivo do banco' };
  const cents = valueId === '6' || valueId === '8' ? Number(bc.slice(4, 15)) : 0;
  // Muitas contas trazem o vencimento como AAAAMMDD logo no início do campo livre
  let dueDate = null;
  for (const start of [19, 20, 23, 24]) {
    const s = bc.slice(start, start + 8);
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    if (/^20\d{6}$/.test(s) && isValidISO(iso)) { dueDate = iso; break; }
  }
  return { kind: 'arrecadacao', barcode: bc, bank: SEG[bc[1]] || 'Conta de consumo', cents, dueDate };
}

/**
 * Linha digitável ou código de barras → { kind, bank, cents, dueDate, barcode, line }
 * Lança erro com mensagem amigável se não for válido.
 */
export function parseBoleto(input, today = todayISO()) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 44) {
    return { ...(digits[0] === '8' ? collectFromBarcode(digits) : bankFromBarcode(digits, today)), line: digits };
  }
  if (digits.length === 47) {
    const fields = [[0, 9, 9], [10, 20, 20], [21, 31, 31]];
    for (const [a, b, dv] of fields) {
      if (mod10(digits.slice(a, b)) !== Number(digits[dv])) throw new Error('Linha digitável com erro de digitação (confira os números).');
    }
    const bc = digits.slice(0, 4) + digits[32] + digits.slice(33, 47) + digits.slice(4, 9) + digits.slice(10, 20) + digits.slice(21, 31);
    return { ...bankFromBarcode(bc, today), line: digits };
  }
  if (digits.length === 48 && digits[0] === '8') {
    const blocks = [0, 12, 24, 36].map((i) => digits.slice(i, i + 12));
    const useMod10 = digits[2] === '6' || digits[2] === '7';
    for (const blk of blocks) {
      const dv = useMod10 ? mod10(blk.slice(0, 11)) : mod11Collect(blk.slice(0, 11));
      if (dv !== Number(blk[11])) throw new Error('Linha digitável com erro de digitação (confira os números).');
    }
    const bc = blocks.map((b) => b.slice(0, 11)).join('');
    return { ...collectFromBarcode(bc), line: digits };
  }
  throw new Error('Cole a linha digitável completa (47 ou 48 números) ou o código de barras (44).');
}

/** "34191.79001 01043.510047 ..." formatada para exibir. */
export function formatLine(line) {
  const d = String(line).replace(/\D/g, '');
  if (d.length === 47) return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  if (d.length === 48) return [0, 12, 24, 36].map((i) => `${d.slice(i, i + 11)}-${d[i + 11]}`).join(' ');
  return d;
}

/** Exposto para os testes. */
export const _dv = { mod10, mod11Bank, mod11Collect, toISO };
