// @ts-check
// =============================================================
// advice.js — Dicas em três níveis, com os números do usuário
// -------------------------------------------------------------
// Estende o que já existe (não é um segundo motor):
//  • SIMPLES  = insightsFor() (analysis.js) + os selos dos
//               lançamentos (weights.js): "Luz 40% acima da média".
//  • MÉDIAS   = uma ação que resolve um mês: antecipar uma parcela,
//               adiar uma avulsa, cancelar uma assinatura.
//  • COMPLEXAS = combinam salário, 13º, férias, plantões, faturas e
//               parcelas: guardar nos meses de folga para cobrir os
//               apertados, preparar despesas anuais, quantos plantões
//               fecham o mês, quanto cabe de parcela nova em 12 meses.
// nextActions() (analysis.js) recebe estas dicas para o "O que fazer
// agora" do painel. Tudo calculado sobre yearPlan()/computeMonth():
// os números batem com a aba 12 meses e com o painel.
// =============================================================

import { sumCents, formatBRL, formatPercent, plural, percent } from '../core/money.js';
import { addMonthsYM, formatMonth, formatMonthShort, todayISO, ymOf } from '../core/dates.js';
import { memoByState } from '../core/memo.js';
import { computeMonth, extrasOf, FREQ_MONTHS } from './ledger.js';
import { payrollFor, paydayOf } from './payroll.js';
import { insightsFor, spendingAnomalies, median } from './analysis.js';
import { yearPlan } from './yearplan.js';
import { itemFlags, futureWeight } from './weights.js';
import { tightMargin, alertsOf } from './monthStatus.js';

export const LEVELS = { simples: 'Simples', media: 'Médias', complexa: 'Para planejar' };

const PLAN_ROUTE = '#/planejamento?aba=ano';
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "−R$ 120,00" / "R$ 80,00" */
const signed = (c) => (c < 0 ? `−${formatBRL(-c)}` : formatBRL(c));

/**
 * → { simples: [tip], media: [tip], complexa: [tip], all: [tip] }
 * tip = { id, level, tone, title, text, ym?, action?: { label, route } }
 * `ym` = mês exibido (dicas simples); médias e complexas olham os
 * próximos 12 meses a partir de hoje.
 */
function adviceForRaw(state, ym, today = todayISO()) {
  const simples = simpleTips(state, ym, today);
  const plan = yearPlan(state, ymOf(today), 12, today);
  const media = mediumTips(state, plan, today);
  const complexa = complexTips(state, plan, ym, today);
  const cut = (list, n) => list.slice(0, n);
  const out = { simples: cut(simples, 6), media: cut(media, 4), complexa: cut(complexa, 5) };
  return { ...out, all: [...out.simples, ...out.media, ...out.complexa] };
}
const adviceMemo = memoByState(adviceForRaw);
/** O resultado é compartilhado (cache): não altere os objetos devolvidos. */
export const adviceFor = (state, ym, today = todayISO()) => adviceMemo(state, ym, today);

// ---------- Simples ----------

function simpleTips(state, ym, today) {
  const month = computeMonth(state, ym, today);
  const out = [];
  const flags = itemFlags(state, ym, today);
  for (const item of month.items) {
    for (const f of flags.get(item.key) || []) {
      if (f.type === 'over') {
        out.push({
          id: `over:${item.key}`, level: 'simples', tone: 'warn', ym,
          title: `${item.description}: ${f.pct < 100 ? `${f.label} da média` : f.label}`,
          text: `${formatBRL(item.cents)} neste mês; nos últimos meses ficou em torno de ${formatBRL(f.avg)}.`,
          action: { label: 'Ver contas', route: '#/contas' },
        });
      } else if (f.type === 'unusual' && item.kind === 'expense') {
        out.push({
          id: `unusual:${item.key}`, level: 'simples', tone: 'info', ym,
          title: `Gasto fora do comum: ${item.description}`,
          text: `${formatBRL(item.cents)}. ${f.text}`,
          action: { label: 'Ver contas', route: '#/contas' },
        });
      }
    }
  }
  const covered = new Set(month.items.filter((i) => (flags.get(i.key) || []).some((f) => f.type === 'over')).map((i) => i.categoryId));
  for (const a of spendingAnomalies(state, ym, today, { threshold: alertsOf(state.settings).overspendPct })) {
    if (a.level !== 'cat') continue;
    const cat = state.categories.find((c) => c.name === a.name);
    if (cat && covered.has(cat.id)) continue;
    out.push({
      id: `anomaly:${a.key}`, level: 'simples', tone: 'warn', ym,
      title: `${a.name} ${formatPercent(a.pct)} acima da média`,
      text: `${formatBRL(a.cents)} neste mês; a média dos últimos meses é ${formatBRL(a.median)}.`,
      action: { label: 'Ver análise', route: '#/analise' },
    });
  }
  // Os resumos do mês que já existiam (renda extra, custos fixos, 13º, parcelas acabando…)
  for (const i of insightsFor(state, month, today)) out.push({ id: `insight:${i.title}`, ...i, level: 'simples', ym });
  return out;
}

// ---------- Médias: uma ação que resolve um mês ----------

function mediumTips(state, plan, today) {
  const out = [];
  const rows = plan.months;
  const margin = (r) => tightMargin(r.income, state.settings);
  const fixes = (r, cents) => r.balance + cents >= (r.status === 'short' ? 0 : margin(r));
  const critical = rows.filter((r) => r.status === 'short' || r.status === 'tight').slice(0, 3);
  // A folga de um mês só pode ser usada uma vez entre as sugestões
  const used = new Map();
  const spare = (h) => h.balance - (used.get(h.ym) || 0) - margin(h);
  const use = (h, cents) => used.set(h.ym, (used.get(h.ym) || 0) + cents);
  const prepaid = new Set();

  for (const r of critical) {
    const m = computeMonth(state, r.ym, today);
    const goal = r.status === 'short' ? 'passa de' : 'sai do aperto: de';
    // 1) Antecipar uma parcela para um mês anterior com folga
    const parcels = m.items.filter((i) => i.kind === 'installment' && i.status !== 'paid' && !prepaid.has(i.refId)).sort((a, b) => b.cents - a.cents);
    let done = false;
    for (const p of parcels) {
      const host = rows.find((h) => h.ym < r.ym && spare(h) >= p.cents);
      if (!host) continue;
      use(host, p.cents);
      prepaid.add(p.refId);
      out.push({
        id: `prepay:${p.key}`, level: 'media', tone: r.status === 'short' ? 'bad' : 'warn', ym: r.ym,
        title: `Antecipe a parcela de ${p.description}`,
        text: `Se você pagar a parcela ${p.parcel.n}/${p.parcel.count} (${formatBRL(p.cents)}) em ${formatMonth(host.ym)}, ${formatMonth(r.ym)} ${goal} ${signed(r.balance)} para ${signed(r.balance + p.cents)}${fixes(r, p.cents) ? '' : ' (ajuda, mas ainda não resolve sozinho)'}.`,
        action: { label: 'Ver parcelamentos', route: '#/contas?aba=parcelas' },
      });
      done = true;
      break;
    }
    // 2) Adiar uma avulsa em aberto para um mês seguinte com folga
    const open = m.items.filter((i) => i.kind === 'expense' && i.status !== 'paid' && i.status !== 'overdue').sort((a, b) => b.cents - a.cents);
    for (const e of open) {
      const host = rows.find((h) => h.ym > r.ym && spare(h) >= e.cents);
      if (!host) continue;
      use(host, e.cents);
      out.push({
        id: `postpone:${e.key}`, level: 'media', tone: 'warn', ym: r.ym,
        title: `Dá para adiar ${e.description}?`,
        text: `Se ${e.description} (${formatBRL(e.cents)}) passar para ${formatMonth(host.ym)}, ${formatMonth(r.ym)} ${goal} ${signed(r.balance)} para ${signed(r.balance + e.cents)} e ${formatMonth(host.ym)} continua com sobra de ${formatBRL(host.balance - e.cents)}.`,
        action: { label: 'Ver contas', route: '#/contas' },
      });
      done = true;
      break;
    }
    // 3) Cancelar uma assinatura que sozinha resolve o mês
    const subs = m.items.filter((i) => i.kind === 'recurring' && i.subscription).sort((a, b) => a.cents - b.cents);
    const sub = subs.find((s) => fixes(r, s.cents));
    if (sub) {
      out.push({
        id: `cancel:${sub.refId}:${r.ym}`, level: 'media', tone: 'info', ym: r.ym,
        title: `Cancelar ${sub.description} resolveria ${formatMonthShort(r.ym)}`,
        text: `São ${formatBRL(sub.cents)} por mês. Sem ela, ${formatMonth(r.ym)} fica com ${signed(r.balance + sub.cents)}.`,
        action: { label: 'Ver assinaturas', route: '#/contas?aba=assinaturas' },
      });
      done = true;
    }
    if (!done && r.status === 'short') {
      out.push({
        id: `gap:${r.ym}`, level: 'media', tone: 'bad', ym: r.ym,
        title: `${capital(formatMonth(r.ym))} não fecha: faltam ${formatBRL(-r.balance)}`,
        text: 'Nenhuma conta sozinha resolve. Veja abaixo como guardar antes ou simule cortes no Planejamento.',
        action: { label: 'Simular cortes', route: '#/planejamento' },
      });
    }
  }
  return out;
}

// ---------- Complexas: combinam renda, 13º, férias, plantões e parcelas ----------

function complexTips(state, plan, ym, today) {
  const out = [];
  const rows = plan.months;
  const margin = (r) => tightMargin(r.income, state.settings);
  const short = rows.filter((r) => r.status === 'short');

  // 1) Guardar nos meses de folga (e no 13º/férias) para cobrir os que não fecham
  if (short.length) {
    const first = short[0];
    const gap = sumCents(short.map((r) => -r.balance));
    const before = rows.filter((r) => r.ym < first.ym && r.status === 'ok');
    const spare = sumCents(before.map((r) => r.balance - margin(r)));
    const bonus = before.filter((r) => r.thirteenth || r.vacation);
    if (before.length && spare >= gap) {
      const per = Math.ceil(gap / before.length / 100) * 100;
      const extra = bonus.length ? ` Dá para usar parte ${bonus[0].thirteenth ? `do 13º de ${formatMonth(bonus[0].ym)} (${formatBRL(bonus[0].thirteenth)})` : `das férias de ${formatMonth(bonus[0].ym)}`} e guardar menos nos outros meses.` : '';
      out.push({
        id: 'save-for-short', level: 'complexa', tone: 'warn', ym: first.ym,
        title: `Guarde ${formatBRL(per)} por mês até ${formatMonthShort(addMonthsYM(first.ym, -1))}`,
        text: `${short.length === 1 ? `${capital(formatMonth(first.ym))} não fecha` : `${plural(short.length, 'mês não fecha', 'meses não fecham')}`} (buraco de ${formatBRL(gap)}). Separando ${formatBRL(per)} em cada um dos ${plural(before.length, 'mês', 'meses')} com folga antes disso, você cobre a diferença sem atrasar contas.${extra}`,
        action: { label: 'Ver 12 meses', route: PLAN_ROUTE },
      });
    } else if (short.length) {
      out.push({
        id: 'save-for-short', level: 'complexa', tone: 'bad', ym: first.ym,
        title: `Faltam ${formatBRL(gap)} nos próximos 12 meses`,
        text: `A sobra dos meses com folga (${formatBRL(Math.max(0, spare))}) não cobre os meses que não fecham. É preciso cortar gastos fixos, renegociar parcelas ou aumentar a renda — teste no simulador.`,
        action: { label: 'Abrir simulador', route: '#/planejamento' },
      });
    }
  }

  // 2) Plantões que fecham o primeiro mês crítico
  const target = short[0] || rows.find((r) => r.status === 'tight');
  const types = (state.settings.shiftTypes || []).filter((t) => t.cents > 0);
  if (target && types.length) {
    const need = target.status === 'short' ? -target.balance : margin(target) - target.balance;
    const nextMonth = paydayOf(state.settings).nextMonth;
    const workYM = nextMonth ? addMonthsYM(target.ym, -1) : target.ym;
    if (workYM >= ymOf(today)) {
      const best = types.map((t) => ({ t, net: shiftNet(state, t, workYM) })).filter((x) => x.net > 0).sort((a, b) => b.net - a.net)[0];
      if (best) {
        const n = Math.ceil(need / best.net);
        if (n >= 1 && n <= 6) {
          out.push({
            id: `shifts:${target.ym}`, level: 'complexa', tone: 'info', ym: target.ym,
            title: `${plural(n, 'plantão extra', 'plantões extras')} ${target.status === 'short' ? 'fecham' : 'aliviam'} ${formatMonthShort(target.ym)}`,
            text: `${n === 1 ? 'Um' : n} ${best.t.name} em ${formatMonth(workYM)} rende cerca de ${formatBRL(best.net)} líquido cada${best.t.payroll !== false ? ' (já descontando INSS e IR da folha)' : ''}${nextMonth ? `, pago em ${formatMonth(target.ym)}` : ''}. ${formatBRL(n * best.net)} cobrem os ${formatBRL(need)} que faltam.`,
            action: { label: 'Abrir escala', route: '#/salario?aba=plantoes' },
          });
        }
      }
    }
  }

  // 3) Despesas anuais/semestrais (IPVA, IPTU, seguro): guardar antes
  const now = ymOf(today);
  for (const r of rows) {
    if (r.ym <= now) continue;
    const m = computeMonth(state, r.ym, today);
    for (const i of m.items) {
      if (i.kind !== 'recurring' || (FREQ_MONTHS[i.freq] || 1) < 6 || i.status === 'paid') continue;
      const months = Math.max(1, rows.filter((x) => x.ym >= now && x.ym < r.ym).length);
      const per = Math.ceil(i.cents / months / 100) * 100;
      if (i.cents < Math.max(20000, margin(r))) continue;
      out.push({
        id: `seasonal:${i.key}`, level: 'complexa', tone: r.status === 'ok' ? 'info' : 'warn', ym: r.ym,
        title: `${i.description} em ${formatMonthShort(r.ym)}: ${formatBRL(i.cents)}`,
        text: `Guardando ${formatBRL(per)} por mês ${months > 1 ? `nos ${months} meses até lá` : 'agora'}, ${formatMonth(r.ym)} ${r.status === 'ok' ? 'continua tranquilo' : 'deixa de apertar tanto'} e o valor não sai de uma vez.`,
        action: { label: 'Ver 12 meses', route: PLAN_ROUTE },
      });
      if (out.filter((t) => t.id.startsWith('seasonal:')).length >= 2) break;
    }
    if (out.filter((t) => t.id.startsWith('seasonal:')).length >= 2) break;
  }

  // 4) Quanto cabe de parcela nova sem apertar nenhum mês
  const room = Math.min(...rows.map((r) => r.balance - margin(r)));
  if (rows.length && rows.some((r) => r.income > 0)) {
    out.push(room > 0
      ? {
        id: 'room', level: 'complexa', tone: 'good',
        title: `Cabe uma parcela nova de até ${formatBRL(Math.floor(room / 100) * 100)}/mês`,
        text: `É o que sobra no mês mais justo dos próximos 12 (${formatMonth(rows.reduce((a, r) => (r.balance - margin(r) < a.balance - margin(a) ? r : a), rows[0]).ym)}) mantendo a folga mínima de ${alertsOf(state.settings).tightPct}%. Acima disso, algum mês fica apertado.`,
        action: { label: 'Posso comprar?', route: '#/planejamento?aba=comprar' },
      }
      : {
        id: 'room', level: 'complexa', tone: 'warn',
        title: 'Evite parcelas novas por enquanto',
        text: `Pelo menos um dos próximos 12 meses já está ${short.length ? 'no vermelho' : 'apertado'}. Uma parcela nova piora esse mês; espere algum parcelamento terminar.`,
        action: { label: 'Ver 12 meses', route: PLAN_ROUTE },
      });
  }

  // 5) O que o mês exibido deixa para os próximos
  const fw = futureWeight(state, ym, today);
  const finite = fw.list.filter((w) => !w.endless && w.months.length > 1);
  if (finite.length) {
    const next = addMonthsYM(ym, 1);
    const nextCents = fw.byMonth[next] || 0;
    const avgSpare = median(rows.map((r) => Math.max(0, r.balance)));
    out.push({
      id: `weight:${ym}`, level: 'complexa', tone: nextCents > avgSpare * 0.5 ? 'warn' : 'info', ym,
      title: `Este mês deixa ${formatBRL(nextCents)} para ${formatMonthShort(next)}`,
      text: `${finite.length === 1 ? `Um compromisso parcelado de ${formatMonth(ym)} segue` : `${finite.length} compromissos parcelados de ${formatMonth(ym)} seguem`} até ${formatMonthShort(fw.until)}${avgSpare > 0 ? ` — ${formatPercent(percent(nextCents, avgSpare))} da sobra típica de um mês` : ''}. Antes de parcelar de novo, veja se esse valor ainda cabe.`,
      action: { label: 'Ver parcelamentos', route: '#/contas?aba=parcelas' },
    });
  }
  return out;
}

/** Quanto UM plantão do tipo rende líquido na competência (na folha: com INSS e IR). */
export function shiftNet(state, type, ym) {
  if (type.payroll === false) return type.cents;
  const inPayroll = sumCents(extrasOf(state, ym).filter((x) => x.payroll).map((x) => x.cents));
  return payrollFor(state.settings, ym, inPayroll + type.cents).net - payrollFor(state.settings, ym, inPayroll).net;
}
