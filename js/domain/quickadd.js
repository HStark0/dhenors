// @ts-check
// =============================================================
// quickadd.js — Lançamento rápido em linguagem natural
// -------------------------------------------------------------
// Digite (ou fale) na busca (Ctrl+K) algo como:
//   "mercado 154,90"            → conta de hoje, R$ 154,90
//   "uber 23 ontem pago"        → gasto pago ontem
//   "gastei 50 no mercado"      → gasto pago hoje
//   "luz 180 dia 20"            → conta vencendo dia 20 deste mês
//   "luz 180 todo dia 20"       → despesa RECORRENTE todo dia 20
//   "netflix 55,90 todo mês"    → recorrente no dia de hoje
//   "tv 2400 em 10x"            → PARCELAMENTO de R$ 2.400 em 10×
//   "tv 10x de 240 no nubank"   → compra parcelada no CARTÃO Nubank
//   "plantão 900 +"             → renda extra (sinal + ou "recebi")
//   "dentista 250 15/11"        → conta em 15/11
// =============================================================

import { toCents } from '../core/money.js';
import { todayISO, addDaysISO, dateInMonth, ymOf, parseISO, toISO, isValidISO } from '../core/dates.js';

const MONEY = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\s*\/)(?!\s*x\b)/i;

const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());

/**
 * → { type: 'expense'|'income'|'recurring'|'installment', description, cents, date, paid, income,
 *     dueDay?, count?, card? } ou null se não entender.
 * `cards`: nomes de cartões cadastrados (para "no nubank").
 */
export function parseQuickAdd(text, today = todayISO(), { cards = [] } = {}) {
  let s = ` ${String(text || '').trim()} `;
  if (!s.trim()) return null;

  let income = false;
  if (/\s\+\s|\brecebi\b|\bentrada\b|\bganhei\b/i.test(s)) {
    income = true;
    s = s.replace(/\s\+\s/g, ' ').replace(/\b(recebi|entrada|ganhei)\b/gi, ' ');
  }

  let paid = false;
  // "gastei 50 no mercado", "paguei 80 de luz", "comprei pão 12"
  const spoke = /\b(gastei|paguei|comprei)\b\s*/i.exec(s);
  if (spoke) {
    paid = true;
    s = s.replace(spoke[0], ' ');
  }
  if (/\b(pago|pg)\b/i.test(s)) {
    paid = true;
    s = s.replace(/\b(pago|pg)\b/gi, ' ');
  }

  // Cartão: "no nubank", "no cartão inter"
  let card = null;
  for (const name of cards) {
    const re = new RegExp(`\\b(?:no|na|pelo|cart[aã]o)\\s+(?:cart[aã]o\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = re.exec(s);
    if (m) { card = name; s = s.replace(m[0], ' '); break; }
  }

  // Parcelado: "em 10x", "10x de 240", "10 vezes"
  let count = null;
  let parcelValue = null;
  const perParcel = /\b(\d{1,2})\s*x\s*de\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/i.exec(s);
  const times = /\b(?:em\s*)?(\d{1,2})\s*(?:x|vezes)\b/i.exec(s);
  if (perParcel) {
    count = Number(perParcel[1]);
    parcelValue = toCents(perParcel[2]);
    s = s.replace(perParcel[0], ' ');
  } else if (times) {
    count = Number(times[1]);
    s = s.replace(times[0], ' ');
  }

  // Recorrente: "todo dia 20", "todo mês", "mensal"
  let dueDay = null;
  let recurring = false;
  const everyDay = /\btodo\s+dia\s+(\d{1,2})\b/i.exec(s);
  if (everyDay) {
    recurring = true;
    dueDay = Math.min(31, Math.max(1, Number(everyDay[1])));
    s = s.replace(everyDay[0], ' ');
  } else if (/\b(todo\s+m[eê]s|mensal(?:mente)?|por\s+m[eê]s)\b/i.test(s)) {
    recurring = true;
    s = s.replace(/\b(todo\s+m[eê]s|mensal(?:mente)?|por\s+m[eê]s)\b/gi, ' ');
  }

  let date = today;
  const rel = /\b(hoje|ontem|amanh[ãa]|anteontem)\b/i.exec(s);
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  const day = /\bdia\s+(\d{1,2})\b/i.exec(s);
  if (rel) {
    const w = rel[1].toLowerCase();
    date = w === 'ontem' ? addDaysISO(today, -1) : w === 'anteontem' ? addDaysISO(today, -2) : w.startsWith('amanh') ? addDaysISO(today, 1) : today;
    s = s.replace(rel[0], ' ');
  } else if (dm) {
    const t = parseISO(today);
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : t.y;
    const iso = toISO(y, +dm[2], +dm[1]);
    if (isValidISO(iso)) date = iso;
    s = s.replace(dm[0], ' ');
  } else if (day) {
    date = dateInMonth(ymOf(today), Math.min(31, Math.max(1, +day[1])));
    s = s.replace(day[0], ' ');
  }

  let cents = parcelValue && count ? parcelValue * count : null;
  if (cents == null) {
    const money = MONEY.exec(s);
    if (!money) return null;
    cents = toCents(money[1]);
    s = s.replace(money[0], ' ');
  }
  if (!Number.isFinite(cents) || cents <= 0) return null;

  // "no mercado", "de luz" → tira as preposições soltas
  const description = cap(s.replace(/\b(no|na|nos|nas|de|do|da|em|com|pra|para)\b\s*$/i, '').replace(/^\s*(no|na|nos|nas|de|do|da|em|com|pra|para)\b/i, '').replace(/\s+/g, ' ').trim());
  if (!description) return null;

  const base = { description: description.slice(0, 120), cents, date, income };
  if (income) return { ...base, type: 'income', paid: false };
  if (recurring) return { ...base, type: 'recurring', paid: false, dueDay: dueDay || Number(date.slice(8, 10)) };
  if (count && count >= 2) return { ...base, type: 'installment', paid: false, count, card };
  // Algo que já passou entra como pago
  if (date < today && !paid) paid = true;
  return { ...base, type: 'expense', paid, card };
}
