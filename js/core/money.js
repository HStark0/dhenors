// @ts-check
// =============================================================
// money.js — Valores em dinheiro
// -------------------------------------------------------------
// Todos os valores do app são guardados em CENTAVOS (inteiros).
// Isso evita erros de ponto flutuante (0,1 + 0,2 = 0,30000000004)
// e garante que parcelas somem exatamente o valor total.
// =============================================================

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** Maior valor aceito em um lançamento: R$ 10 milhões. */
export const MAX_CENTS = 1_000_000_000;

/**
 * Converte o que o usuário digitou em centavos.
 * Aceita "12,50", "1.234,56", "1234.56", "R$ 10", 12.5 …
 * Retorna NaN quando não dá para interpretar.
 */
export function toCents(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : NaN;
  }
  if (typeof input !== 'string') return NaN;

  let s = input.trim().replace(/[R$\s]/g, '').replace(/^−|−$/g, '-');
  if (!s) return NaN;

  // Negativo: "-50", "50-" (extratos e holerites) ou "(50,00)" (contábil)
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1]; }
  if (paren && /^-|-$/.test(s)) return NaN; // "(-5)": ambíguo
  if (/^-/.test(s)) { negative = true; s = s.slice(1); } else if (/-$/.test(s)) { negative = true; s = s.slice(0, -1); }
  if (/^[-(]|[-()]$/.test(s)) return NaN; // sinal duplicado ou parêntese solto
  s = s.replace(/^\+/, '').replace(/[.,]$/, ''); // "10," → "10"

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // O separador que aparece por último é o decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1) {
    // "1.234" (milhar) x "12.5" (decimal): 3 dígitos depois do ponto = milhar
    const parts = s.split('.');
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0');
    if (isThousands) s = s.replace(/\./g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

/** Centavos → número com 2 casas (para preencher <input>). */
export function centsToInput(cents) {
  if (!Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Centavos → "R$ 1.234,56". */
export function formatBRL(cents) {
  if (!Number.isFinite(cents)) return '—';
  // Sinal de menos tipográfico (−), igual ao usado no resto do app
  return BRL.format(cents / 100).replace('-', '−');
}

/** Centavos → "R$ 1,2 mil" (para eixos de gráfico). */
export function formatCompactBRL(cents) {
  if (!Number.isFinite(cents)) return '—';
  const text = 'R$ ' + COMPACT.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/** Soma uma lista de centavos (ignora valores inválidos). */
export function sumCents(list) {
  let total = 0;
  for (const v of list) if (Number.isFinite(v)) total += v;
  return total;
}

/**
 * Divide um total em N parcelas inteiras.
 * A diferença de centavos vai para a PRIMEIRA parcela,
 * como fazem as operadoras de cartão.
 * splitCents(100000, 3) → [33334, 33333, 33333]
 */
export function splitCents(totalCents, count) {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
}

/** Percentual seguro (sem NaN/Infinity). */
export function percent(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return (part / whole) * 100;
}

export function formatPercent(value, digits = 0) {
  if (!Number.isFinite(value)) return '0%';
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits }) + '%';
}

/**
 * "1 conta" / "3 contas" — concordância de número.
 * plural(2, 'adicional', 'adicionais') → "2 adicionais"
 * Sem o 3º argumento, acrescenta "s".
 */
export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}
