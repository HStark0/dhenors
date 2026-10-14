// =============================================================
// quickadd.js — Lançamento rápido em linguagem natural
// -------------------------------------------------------------
// Digite na busca (Ctrl+K) algo como:
//   "mercado 154,90"            → conta de hoje, R$ 154,90
//   "uber 23 ontem pago"        → gasto pago ontem
//   "luz 180 dia 20"            → conta vencendo dia 20 deste mês
//   "plantão 900 +"             → renda extra (sinal + ou palavra "recebi")
//   "dentista 250 15/11"        → conta em 15/11
// =============================================================

import { toCents } from '../core/money.js';
import { todayISO, addDaysISO, dateInMonth, ymOf, parseISO, toISO, isValidISO } from '../core/dates.js';

const MONEY = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\s*\/)/i;

/** → { description, cents, date, paid, income } ou null se não entender. */
export function parseQuickAdd(text, today = todayISO()) {
  let s = ` ${String(text || '').trim()} `;
  if (!s.trim()) return null;

  let income = false;
  if (/\s\+\s|\brecebi\b|\bentrada\b|\bganhei\b/i.test(s)) {
    income = true;
    s = s.replace(/\s\+\s/g, ' ').replace(/\b(recebi|entrada|ganhei)\b/gi, ' ');
  }

  let paid = false;
  if (/\b(pago|paguei|pg)\b/i.test(s)) {
    paid = true;
    s = s.replace(/\b(pago|paguei|pg)\b/gi, ' ');
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

  const money = MONEY.exec(s);
  if (!money) return null;
  const cents = toCents(money[1]);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  s = s.replace(money[0], ' ');

  const description = s.replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
  if (!description) return null;
  // Algo que já passou e foi dito "pago" (ou é passado) entra como pago
  if (!income && date < today && !paid) paid = true;
  return { description: description.slice(0, 120), cents, date, paid, income };
}
