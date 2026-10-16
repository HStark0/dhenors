// @ts-check
// =============================================================
// cardInvoice.js — Lê a fatura do cartão (texto do PDF) em compras
// -------------------------------------------------------------
// Funciona com o texto extraído pelo core/pdftext.js de faturas
// Nubank, Inter, Itaú, C6, Santander… (e com texto colado). Cada
// linha de compra costuma ter: DATA · DESCRIÇÃO · VALOR, às vezes
// com "Parcela 3/10" ou "03/10" no fim da descrição.
//  • Datas: "12 OUT", "12/10", "12/10/2026", "12 de out".
//    Sem o ano, ele é deduzido pelo vencimento da fatura.
//  • Parcelas: a compra é importada INTEIRA (valor × parcelas), com a
//    data recuada para que a parcela caia nesta fatura. Na fatura do
//    mês seguinte, a mesma compra é reconhecida e não duplica.
//  • Pagamentos, saldo anterior, juros/IOF de rotativo e totais são
//    ignorados (os juros podem ser incluídos se você quiser).
// =============================================================

import { toCents } from '../core/money.js';
import { toISO, isValidISO, addMonthsYM, ymOf, dateInMonth } from '../core/dates.js';
import { cleanDescription } from './importer.js';

const MONTHS = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const SKIP = /pagamento|pgto|saldo anterior|total d|total a pagar|limite|encargos|cr[eé]dito de|estorno de pagamento|valor m[ií]nimo|fatura anterior|vencimento|resumo|^total\b/i;
const FEES = /juros|iof|multa|anuidade|encargo|tarifa/i;

/** Vencimento escrito na fatura ("Vencimento: 10/11/2026"). */
export function findDueDate(text) {
  const m = /venc(?:imento)?[^\d]{0,20}(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(text)
    || /venc(?:imento)?[^\d]{0,20}(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s+(?:de\s+)?(\d{4})/i.exec(text);
  if (!m) return null;
  const month = MONTHS[String(m[2]).toLowerCase().slice(0, 3)] || Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = toISO(year, month, Number(m[1]));
  return isValidISO(iso) ? iso : null;
}

const LINE = /^\s*(\d{1,2})\s*(?:\/|\s+de\s+|\s+)(\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?(?:\s*\/\s*|\s+)?(\d{4}|\d{2}(?=\s))?\s+(.+?)\s+(-?\s*(?:R\$\s*)?-?\s*\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*\d+,\d{2})\s*(-)?\s*$/i;
const PARCEL = /(?:\bparc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i;

/**
 * Texto da fatura → { dueDate, rows: [{ date, description, cents, count, n, fingerprint, fee }] }
 * `dueDate` (opcional) força o vencimento quando o texto não traz.
 */
export function parseCardInvoice(text, { dueDate = null, includeFees = false } = {}) {
  const due = dueDate || findDueDate(text);
  const dueYM = due ? ymOf(due) : null;
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const m = LINE.exec(line);
    if (!m) continue;
    let description = m[4].replace(/\s*[•*]{2,}\s*\d{4}\s*/g, ' ').trim();
    if (SKIP.test(description)) continue;
    const fee = FEES.test(description);
    if (fee && !includeFees) continue;
    const month = MONTHS[String(m[2]).toLowerCase().slice(0, 3)] || Number(m[2]);
    if (!month || month > 12) continue;
    let year;
    if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    else if (dueYM) {
      const [dy, dm] = dueYM.split('-').map(Number);
      year = month > dm ? dy - 1 : dy; // compra de dezembro numa fatura de janeiro
    } else year = new Date().getFullYear();
    const date = toISO(year, month, Number(m[1]));
    if (!isValidISO(date)) continue;
    let cents = toCents(m[5].replace(/\s/g, '').replace('R$', ''));
    if (!Number.isFinite(cents) || !cents) continue;
    if (m[6] === '-') cents = -Math.abs(cents);
    // Na fatura, compras são positivas; créditos/estornos vêm negativos
    let n = 1;
    let count = 1;
    const p = PARCEL.exec(description);
    if (p && Number(p[2]) >= 2 && Number(p[1]) >= 1 && Number(p[1]) <= Number(p[2]) && Number(p[2]) <= 48) {
      n = Number(p[1]);
      count = Number(p[2]);
      description = description.slice(0, p.index).replace(/[-–\s]+$/, '').trim();
    }
    // Parcelada: importa a compra inteira, com a data recuada para a parcela 1
    const firstDate = count > 1 ? dateInMonth(addMonthsYM(ymOf(date), -(n - 1)), Number(m[1])) : date;
    const total = count > 1 ? cents * count : cents;
    rows.push({
      date: firstDate, statementDate: date, description: description.slice(0, 120), cents: total, parcelCents: cents, count, n, fee,
      // Parcelada: sem o valor na impressão digital — o centavo do arredondamento
      // muda de uma parcela para outra (1ª parcela maior) e a compra duplicava.
      fingerprint: count > 1
        ? `cartao|${firstDate}|parc${count}|${cleanDescription(description).slice(0, 30)}`
        : `cartao|${firstDate}|${total}|${count}|${cleanDescription(description).slice(0, 30)}`,
    });
  }
  return { dueDate: due, rows };
}

/**
 * Acerta a data de uma compra parcelada para a parcela `n` cair na fatura
 * `dueYM` do cartão. Algumas faturas mostram a data ORIGINAL da compra
 * (Nubank), outras a data da parcela: testa as duas.
 * `invoiceMonthFor` vem de domain/cards.js.
 */
export function alignToInvoice(card, row, dueYM, invoiceMonthFor) {
  if (!dueYM) return row;
  const wanted = addMonthsYM(dueYM, -(row.n - 1));
  for (const candidate of [row.statementDate, row.date]) {
    if (invoiceMonthFor(card, candidate) === wanted) return { ...row, date: candidate, fingerprint: row.fingerprint.replace(/^cartao\|[^|]+/, `cartao|${candidate}`) };
  }
  // Nenhuma bateu (fechamento diferente): coloca a compra no dia anterior ao fechamento do mês certo
  const closeYM = card.dueDay > card.closingDay ? wanted : addMonthsYM(wanted, -1);
  const date = dateInMonth(closeYM, Math.max(1, card.closingDay - 1));
  return { ...row, date, fingerprint: row.fingerprint.replace(/^cartao\|[^|]+/, `cartao|${date}`) };
}
