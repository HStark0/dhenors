// =============================================================
// importer.js — Ler extratos bancários (OFX e CSV) e categorizar
// -------------------------------------------------------------
// • OFX: formato que quase todo banco brasileiro exporta
//   ("Exportar extrato" → OFX / Money / Quicken).
// • CSV: detecta separador (; ou ,), colunas de data, descrição e
//   valor (ou débito/crédito), datas dd/mm/aaaa e valores "1.234,56".
// Tudo roda no aparelho: o arquivo não é enviado a lugar nenhum.
// =============================================================

import { toCents } from '../core/money.js';
import { isValidISO, toISO } from '../core/dates.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Transação lida: { date, description, cents (>0 saída, <0 entrada), raw } */

// ---------- Datas ----------

/** "31/01/2026", "2026-01-31", "20260131", "31/01/26" → "2026-01-31" (ou null). */
export function parseAnyDate(text) {
  const s = String(text || '').trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) { const iso = toISO(+m[1], +m[2], +m[3]); return isValidISO(iso) ? iso : null; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = toISO(y, +m[2], +m[1]);
    return isValidISO(iso) ? iso : null;
  }
  return null;
}

// ---------- OFX ----------

export function parseOFX(text) {
  const out = [];
  const blocks = String(text).split(/<STMTTRN>/i).slice(1);
  const tag = (block, name) => {
    const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
    return m ? m[1].trim() : '';
  };
  for (const b of blocks) {
    const date = parseAnyDate(tag(b, 'DTPOSTED'));
    const amount = Number(String(tag(b, 'TRNAMT')).replace(',', '.'));
    const description = [tag(b, 'MEMO'), tag(b, 'NAME')].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ') || 'Lançamento';
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    // No OFX, saída é negativa. Aqui invertemos: saída = positivo (é uma despesa)
    out.push({ date, description: description.slice(0, 120), cents: -Math.round(amount * 100), id: tag(b, 'FITID') });
  }
  return withOccurrences(out);
}

// ---------- CSV ----------

function splitCSVLine(line, sep) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (c === sep && !quoted) { cells.push(cur.trim()); cur = ''; } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const HEAD = {
  date: /^(data|date|dt|data (do )?lan[cç]amento|data mov)/i,
  desc: /(descri|hist[oó]rico|lan[cç]amento|estabelecimento|memo|detalhe|title|t[ií]tulo)/i,
  value: /^(valor|value|amount|quantia|montante)/i,
  debit: /(d[eé]bito|sa[ií]da|debit)/i,
  credit: /(cr[eé]dito|entrada|credit)/i,
};

/**
 * CSV de banco/cartão. `invert` = true quando o arquivo usa valores
 * POSITIVOS para gastos (comum em faturas de cartão).
 */
export function parseCSV(text, { invert = null } = {}) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = splitCSVLine(lines[0], sep);
  const find = (re) => head.findIndex((h) => re.test(h));
  let iDate = find(HEAD.date);
  let iDesc = head.findIndex((h, i) => i !== iDate && HEAD.desc.test(h));
  const iValue = find(HEAD.value);
  const iDebit = find(HEAD.debit);
  const iCredit = find(HEAD.credit);
  let start = 1;

  // Sem cabeçalho reconhecível: assume data;descrição;valor
  if (iDate < 0 || (iValue < 0 && iDebit < 0)) {
    if (!parseAnyDate(head[0])) return [];
    iDate = 0; iDesc = 1; start = 0;
  }

  const rows = [];
  const byColumns = !(iValue >= 0 || start === 0); // colunas Débito/Crédito separadas
  const amount = (cell) => toCents(String(cell || '').replace(/[^\d,.()-]/g, ''));
  for (const line of lines.slice(start)) {
    const c = splitCSVLine(line, sep);
    const date = parseAnyDate(c[iDate]);
    if (!date) continue;
    let cents;
    if (!byColumns) {
      cents = amount(c[iValue >= 0 ? iValue : 2]);
    } else {
      // A coluna já diz o lado: débito = saída (positivo aqui), crédito = entrada
      const debit = amount(c[iDebit]);
      const credit = iCredit >= 0 ? amount(c[iCredit]) : NaN;
      cents = (Number.isFinite(debit) && debit ? Math.abs(debit) : 0) - (Number.isFinite(credit) && credit ? Math.abs(credit) : 0);
    }
    if (!Number.isFinite(cents) || cents === 0) continue;
    rows.push({ date, description: (c[iDesc] || 'Lançamento').slice(0, 120), cents });
  }

  // Com colunas Débito/Crédito o sinal já está certo: nunca inverte.
  if (byColumns) return withOccurrences(rows);
  // Extrato de conta: saída negativa → vira positiva (despesa).
  // Fatura de cartão: gastos positivos. Detecta pela maioria, se não informado.
  const positives = rows.filter((r) => r.cents > 0).length;
  const spendIsPositive = invert ?? positives > rows.length / 2;
  return withOccurrences(rows.map((r) => ({ ...r, cents: spendIsPositive ? r.cents : -r.cents })));
}

/** Escolhe o leitor pelo conteúdo do arquivo. */
export function parseStatement(text, filename = '') {
  if (/<OFX>|<STMTTRN>/i.test(text) || /\.ofx$/i.test(filename)) return { format: 'OFX', rows: parseOFX(text) };
  return { format: 'CSV', rows: parseCSV(text) };
}

// ---------- Categorização automática ----------

/** Palavras-chave comuns no Brasil → nome da categoria padrão. */
const KEYWORDS = [
  [/UBER|99 ?(APP|TAXI|POP)|CABIFY|POSTO|SHELL|IPIRANGA|PETROBRAS|COMBUST|ESTACION|PEDAGIO|SEM PARAR|CONECTCAR/, 'Transporte'],
  [/IFOOD|RAPPI|RESTAUR|LANCH|PADARIA|PIZZ|BURGER|MC ?DONALD|SUBWAY|CAFE|SUPERMERC|MERCADO|ATACAD|ASSAI|CARREFOUR|ACOUGUE|HORTIFRUT/, 'Alimentação'],
  [/FARMAC|DROGA|RAIA|PAGUE MENOS|HOSPITAL|CLINICA|LABORAT|UNIMED|HAPVIDA|AMIL|ODONTO|ACADEMIA|SMART ?FIT/, 'Saúde e bem-estar'],
  [/NETFLIX|SPOTIFY|DISNEY|PRIME VIDEO|AMAZON PRIME|HBO|MAX\b|GLOBOPLAY|YOUTUBE|DEEZER|APPLE\.COM|GOOGLE ?(ONE|STORAGE)|ICLOUD|CHATGPT|OPENAI/, 'Assinaturas'],
  [/ENERGISA|ENERGIA|CELPE|ENEL|CEMIG|LIGHT|SABESP|SANEA|AGUA|DEPASA|ALUGUEL|CONDOMIN|CLARO|VIVO|TIM\b|OI\b|INTERNET|NET ?VIRTUA/, 'Moradia'],
  [/SHOPEE|MERCADO ?LIVRE|MAGALU|MAGAZINE|AMAZON|ALIEXPRESS|SHEIN|RENNER|C&A|RIACHUELO|ZARA|AMERICANAS|CASAS BAHIA/, 'Compras pessoais'],
  [/ESCOLA|FACULD|UNIVERS|CURSO|UDEMY|ALURA|LIVRARIA/, 'Educação'],
  [/IOF|TARIFA|JUROS|ANUIDADE|MULTA/, 'Financeiro'],
  [/IPTU|IPVA|DARF|RECEITA FED|DETRAN|CARTORIO/, 'Impostos e taxas'],
  [/PET|VETERIN|COBASI|PETZ/, 'Família e pets'],
  [/CINEMA|INGRESSO|SYMPLA|STEAM|PLAYSTATION|XBOX|NINTENDO|HOTEL|AIRBNB|BOOKING|LATAM|GOL\b|AZUL\b|DECOLAR/, 'Lazer e viagens'],
];

/** Tira datas, números e lixo para comparar descrições ("UBER *TRIP 12/03" → "UBER TRIP"). */
export function cleanDescription(desc) {
  return norm(desc).replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ').replace(/[*#\d]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Sugere { categoryId, subcategoryId, source } para uma descrição:
 *  1. regras que você criou (settings.rules)
 *  2. lançamentos anteriores com descrição parecida
 *  3. palavras-chave comuns
 */
export function suggestCategory(state, description) {
  const d = cleanDescription(description);
  if (!d) return null;
  for (const r of state.settings.rules || []) {
    if (d.includes(cleanDescription(r.pattern))) return { categoryId: r.categoryId, subcategoryId: r.subcategoryId, source: 'regra' };
  }
  const history = [...state.expenses, ...state.recurring, ...state.installments].filter((x) => x.categoryId);
  const first = d.split(' ')[0];
  const exact = history.find((x) => cleanDescription(x.description) === d)
    || (first.length >= 4 && history.find((x) => cleanDescription(x.description).split(' ')[0] === first));
  if (exact) return { categoryId: exact.categoryId, subcategoryId: exact.subcategoryId, source: 'histórico' };
  for (const [re, name] of KEYWORDS) {
    if (re.test(d)) {
      const cat = state.categories.find((c) => norm(c.name) === norm(name));
      if (cat) return { categoryId: cat.id, subcategoryId: null, source: 'palavra-chave' };
    }
  }
  return null;
}

/**
 * Identidade de uma transação para não importar duas vezes:
 * "data|valor|descrição". Lançamentos IDÊNTICOS no mesmo arquivo (duas
 * corridas de Uber iguais no dia) ganham "#2", "#3"… pela ordem
 * (`occurrence`), para não virarem um só. A 1ª ocorrência mantém o formato
 * antigo, então extratos já importados continuam reconhecidos.
 */
export const fingerprint = (t) => `${t.date}|${t.cents}|${cleanDescription(t.description).slice(0, 40)}${t.occurrence > 1 ? `#${t.occurrence}` : ''}`;

/**
 * Numera as repetições idênticas do arquivo (campo `occurrence`). No OFX,
 * o FITID decide: mesmo FITID = mesma transação repetida pelo banco.
 */
export function withOccurrences(rows) {
  const count = new Map();
  const byId = new Map();
  return rows.map((r) => {
    const base = fingerprint({ ...r, occurrence: 1 });
    const idKey = r.id ? `${base}|${r.id}` : null;
    if (idKey && byId.has(idKey)) return { ...r, occurrence: byId.get(idKey) };
    const occurrence = (count.get(base) || 0) + 1;
    count.set(base, occurrence);
    if (idKey) byId.set(idKey, occurrence);
    return { ...r, occurrence };
  });
}
