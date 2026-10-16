// @ts-check
// =============================================================
// dates.js — Datas sem armadilhas de fuso horário
// -------------------------------------------------------------
// Regras do app:
//   • Uma data é sempre a string "AAAA-MM-DD" (ex.: "2026-03-31").
//   • Um mês é sempre a string "AAAA-MM"   (ex.: "2026-03").
//   • Nunca usamos new Date("2026-03-01"): o navegador interpreta
//     isso como meia-noite UTC, que no Brasil ainda é o dia anterior.
//   • Ao avançar meses, o dia é LIMITADO ao último dia do mês
//     (31/01 + 1 mês = 28/02, e não 03/03).
// =============================================================

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (n) => String(n).padStart(2, '0');

// ---------- Criação / leitura ----------

/** Data de hoje no fuso do aparelho: "AAAA-MM-DD". */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "AAAA-MM-DD" → { y, m (1-12), d } ou null se inválida. */
export function parseISO(iso) {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = +match[1], m = +match[2], d = +match[3];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isValidISO = (iso) => parseISO(iso) !== null;

export function toISO(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Quantos dias tem o mês (m de 1 a 12). Trata ano bissexto. */
export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// ---------- Meses (AAAA-MM) ----------

export function parseYM(ym) {
  const match = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (!match) return null;
  const y = +match[1], m = +match[2];
  return m >= 1 && m <= 12 ? { y, m } : null;
}

export const isValidYM = (ym) => parseYM(ym) !== null;
export const toYM = (y, m) => `${y}-${pad(m)}`;
export const ymOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 7) : '');
export const currentYM = (now = new Date()) => ymOf(todayISO(now));

/** Soma N meses a "AAAA-MM" (aceita negativo). Dez → Jan funciona. */
export function addMonthsYM(ym, n) {
  const p = parseYM(ym);
  const index = p.y * 12 + (p.m - 1) + n;
  return toYM(Math.floor(index / 12), (index % 12) + 1);
}

/** Diferença em meses: monthsBetween("2026-01", "2026-04") = 3. */
export function monthsBetween(fromYM, toYMValue) {
  const a = parseYM(fromYM), b = parseYM(toYMValue);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/** Lista de meses: últimos `count` meses terminando em `endYM`. */
export function monthRange(endYM, count) {
  return Array.from({ length: count }, (_, i) => addMonthsYM(endYM, i - count + 1));
}

/** Data do dia `day` dentro do mês, limitada ao último dia. */
export function dateInMonth(ym, day) {
  const { y, m } = parseYM(ym);
  return toISO(y, m, Math.min(Math.max(1, day), daysInMonth(y, m)));
}

/** Soma meses a uma data mantendo o dia (limitado ao fim do mês). */
export function addMonthsISO(iso, n, day) {
  const p = parseISO(iso);
  return dateInMonth(addMonthsYM(toYM(p.y, p.m), n), day ?? p.d);
}

/** Soma dias a uma data. */
export function addDaysISO(iso, n) {
  const p = parseISO(iso);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Dias entre duas datas (b − a). Usa UTC só para contar dias. */
export function diffDays(a, b) {
  const pa = parseISO(a), pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

// ---------- Exibição ----------

/** "2026-03-05" → "05/03/2026". */
export function formatDateBR(iso) {
  const p = parseISO(iso);
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : '—';
}

/** "2026-03-05" → "05 mar". */
export function formatDayMonth(iso) {
  const p = parseISO(iso);
  return p ? `${pad(p.d)} ${MONTHS_SHORT[p.m - 1]}` : '—';
}

/** "2026-03" → "março de 2026". */
export function formatMonth(ym) {
  const p = parseYM(ym);
  return p ? `${MONTHS[p.m - 1]} de ${p.y}` : '—';
}

/** "2026-03" → "Março de 2026" (para títulos). */
export function formatMonthTitle(ym) {
  const s = formatMonth(ym);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-03" → "mar/26". */
export function formatMonthShort(ym) {
  const p = parseYM(ym);
  return p ? `${MONTHS_SHORT[p.m - 1]}/${String(p.y).slice(2)}` : '—';
}

/** Texto relativo: "hoje", "amanhã", "em 3 dias", "há 2 dias". */
export function relativeDays(iso, today = todayISO()) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  return diff > 0 ? `em ${diff} dias` : `há ${-diff} dias`;
}

/**
 * Próxima data de pagamento do salário a partir de hoje
 * (inclui hoje: no dia do pagamento retorna a própria data).
 */
export function nextPayday(salaryDay, today = todayISO()) {
  const thisMonth = dateInMonth(ymOf(today), salaryDay);
  return thisMonth >= today ? thisMonth : dateInMonth(addMonthsYM(ymOf(today), 1), salaryDay);
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** "2026-10-13" → "terça-feira" */
export function weekdayLong(iso) {
  const p = parseISO(iso);
  return p ? WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()] : '';
}
