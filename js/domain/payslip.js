// @ts-check
// =============================================================
// payslip.js — Lê o texto de um holerite e monta um "plano" de
// importação (o que vira salário base, adicional, horas, consignado,
// atestado…). Funciona com o texto do PDF (core/pdftext.js) ou com
// o texto colado pelo usuário.
//
// Formato esperado das linhas (comum nos sistemas de folha):
//   CÓD   DESCRIÇÃO                       REF.   PROVENTO   DESCONTO
//   0001  SALARIO CONTRATUAL               17    1.148,41      -
// =============================================================

import { tablesFor } from './taxTables.js';

const MONEY = /^-?(\d{1,3}(\.\d{3})+|\d+),\d{2}$/;
const REFISH = /^(-|\d+([.,:]\d+)?%?|(\d{1,3}(\.\d{3})+|\d+),\d{2})$/;

/** "1.148,41" → 114841 · "-" ou vazio → 0 */
export function moneyCents(token) {
  if (!token || !MONEY.test(token)) return 0;
  return Math.round(Number(token.replace(/\./g, '').replace(',', '.')) * 100);
}

/** Referência "100", "12,5", "10:30" → número (horas/dias) */
function refNumber(token) {
  if (!token || token === '-') return null;
  const hm = /^(\d+):(\d{2})$/.exec(token);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(token.replace('%', '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Descontos inconfundíveis (vêm antes: "INSS S/ 13º SALÁRIO" é desconto)
const SIDE_DESC_STRONG = /^desc|i\.?\s?n\.?\s?s\.?\s?s|previd[eê]ncia social|contrib.*inss|irrf|i\.r\.r\.f|imposto|falta|atraso|empr[eé]stimo|consignado|cr[eé]dito do trabalhador|financiamento|pens[aã]o|adiantamento/;
const SIDE_PROV = /atestado|aux.*doen|licen[cç]a m[eé]dica|sal[aá]rio|horas? normais|dias trabalhados|hora|extra|d\.?\s?s\.?\s?r|noturn|sobreaviso|periculosidade|insalubridade|gratifica|anu[eê]nio|quinqu[eê]nio|tri[eê]nio|adicional|f[eé]rias|abono|pr[eê]mio|comiss|reembolso|devolu|ajuda de custo|13/;
const SIDE_DESC = /mensalidade|sindic|plano|sa[uú]de|odonto|seguro|associa|vale|contribui|coparticipa|farm[aá]cia|previd[eê]ncia priv/;

/**
 * Lado da verba pela descrição — para linhas sem "-" nas colunas vazias,
 * em que a posição do valor não diz se é provento ou desconto.
 * → 'provento' | 'desconto' (na dúvida, provento).
 */
export function sideOf(description) {
  const d = plain(description);
  if (SIDE_DESC_STRONG.test(d)) return 'desconto';
  if (SIDE_PROV.test(d)) return 'provento';
  if (SIDE_DESC.test(d)) return 'desconto';
  return 'provento';
}

/** Texto do holerite → dados estruturados. */
export function parsePayslipText(text) {
  const lines = String(text).replace(/ /g, ' ').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const all = lines.join('\n');
  const out = { competence: null, admission: null, items: [], baseSalary: null, bases: {}, totals: {}, net: null };

  let m = /Comp(?:et[êe]ncia)?\.?\s*:?\s*(\d{1,2})\s*[/-]\s*(\d{4})/i.exec(all)
    || /(?:M[êe]s|Refer[êe]ncia|Per[íi]odo)\s*(?:de\s*refer[êe]ncia)?\s*:?\s*(\d{1,2})\s*[/-]\s*(\d{4})/i.exec(all);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) out.competence = `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  if (!out.competence) {
    const p = plain(all);
    const mm = new RegExp(`(${MONTHS.join('|')})\\s*(?:/|de)\\s*(\\d{4})`).exec(p);
    if (mm) out.competence = `${mm[2]}-${String(MONTHS.indexOf(mm[1]) + 1).padStart(2, '0')}`;
  }

  m = /Admiss[ãa]o\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(all);
  if (m) out.admission = `${m[3]}-${m[2]}-${m[1]}`;

  m = /L[íi]quido(?:\s+a\s+receber)?\s*=*>?\s*:?\s*(?:R\$\s*)?((\d{1,3}(\.\d{3})+|\d+),\d{2})/i.exec(all);
  if (m) out.net = moneyCents(m[1]);

  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rodapé: "Sal. Base  Base INSS  Base FGTS  FGTS Mês  Base IRRF" + linha de valores
    if (/Sal\.?\s*Base/i.test(line) && /Base\s*(INSS|FGTS|IRRF)/i.test(line)) {
      const labels = line.split(/\s{2,}/).map((x) => plain(x.trim())).filter(Boolean);
      const values = (lines[i + 1] || '').split(/\s+/).filter((x) => MONEY.test(x)).map(moneyCents);
      if (labels.length === values.length) {
        labels.forEach((l, k) => {
          if (/sal\.?\s*base/.test(l)) out.baseSalary = values[k];
          else if (/base inss/.test(l)) out.bases.inss = values[k];
          else if (/base fgts/.test(l)) out.bases.fgts = values[k];
          else if (/fgts/.test(l)) out.bases.fgtsMonth = values[k];
          else if (/irrf|ir$/.test(l)) out.bases.irrf = values[k];
        });
      } else if (values.length) out.baseSalary = values[0];
      continue;
    }
    if (/Total\s+de\s+Proventos/i.test(line)) {
      const nums = [line, lines[i + 1] || '', lines[i + 2] || ''].join(' ').split(/\s+/).filter((x) => MONEY.test(x)).map(moneyCents);
      if (nums.length >= 2) out.totals = { proventos: nums[0], descontos: nums[1] };
      continue;
    }

    // Linha de verba: código + descrição + (ref) + provento + desconto
    const lm = /^(\d{2,5})\s+(.+)$/.exec(line);
    if (!lm) continue;
    const tokens = lm[2].split(/\s+/);
    const tail = [];
    while (tokens.length > 1 && tail.length < 3 && REFISH.test(tokens[tokens.length - 1])) tail.unshift(tokens.pop());
    let description = tokens.join(' ').trim();
    if (!description) continue;
    let ref = null, prov = null, desc = null;
    const last = tail[tail.length - 1];
    const prev = tail[tail.length - 2];
    const money2 = tail.length >= 2 && MONEY.test(last) && MONEY.test(prev);
    if (tail.includes('-') || (tail.length === 3 && money2) || (money2 && (!moneyCents(last) || !moneyCents(prev)))) {
      // Colunas posicionais: "-" ou "0,00" marcam a coluna vazia
      if (tail.length === 3) [ref, prov, desc] = tail;
      else if (tail.length === 2) [prov, desc] = tail;
      else continue;
    } else if (MONEY.test(last)) {
      // Sem "-" nas colunas vazias: o PDF só traz (referência) + valor. O lado
      // (provento × desconto) vem da classificação da verba, não da posição.
      if (tail.length === 3) description = `${description} ${tail[0]}`; // "HORAS EXTRAS 50%"
      ref = tail.length >= 2 ? prev : null;
      if (sideOf(description) === 'desconto') desc = last; else prov = last;
    } else continue;
    if (seen.has(lm[1])) continue;
    seen.add(lm[1]);
    const provento = moneyCents(prov);
    const desconto = moneyCents(desc);
    out.items.push({ code: lm[1], description, ref: refNumber(ref), refText: ref, provento, desconto });
  }
  if (!out.totals.proventos && out.items.length) {
    out.totals = {
      proventos: out.items.reduce((s, x) => s + x.provento, 0),
      descontos: out.items.reduce((s, x) => s + x.desconto, 0),
    };
  }
  return out;
}

// ---------- Plano de importação ----------

const pctIn = (desc) => { const p = /(\d+(?:[.,]\d+)?)\s*%/.exec(desc); return p ? Math.round(Number(p[1].replace(',', '.')) * 100) : null; };
const title = (s) => s.toLowerCase().replace(/(^|\s|\/|-)(\p{L})/gu, (x, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Da|Do|Das|Dos|E|Em|Por|Com|S\/)\b/g, (w) => w.toLowerCase()).replace(/\bInss\b/g, 'INSS').replace(/\bIrrf\b/g, 'IRRF').replace(/\bDsr\b/g, 'DSR');

/**
 * Classifica cada verba do holerite.
 * Cada item: { ...verba, action, include, label, params }
 *   action: base | sick | inss-days | falta | percent | hours | addition | deduction | loan | family | ignore
 */
export function planFromPayslip(parsed, settings) {
  const ym = parsed.competence;
  const table = tablesFor(Number((ym || '2026').slice(0, 4)));
  const items = [];
  let workedDays = null;
  let sickDays = 0;
  const hasDsr = parsed.items.some((x) => /D\.?\s*S\.?\s*R/i.test(x.description) && x.provento > 0);
  let baseSalary = parsed.baseSalary;

  for (const v of parsed.items) {
    const d = plain(v.description);
    const value = v.provento || v.desconto;
    const it = { ...v, include: value > 0, action: 'ignore', label: '', params: {} };
    const isProv = v.provento > 0;

    if (!value) { it.label = 'Valor zerado neste mês'; items.push(it); continue; }

    if (/^i\.?\s?n\.?\s?s\.?\s?s|previd[eê]ncia social|contrib.*inss/.test(d) && !isProv) {
      it.action = 'ignore'; it.include = false; it.label = 'Calculado pelo app (conferido abaixo)';
    } else if (/irrf|i\.r\.r\.f|imposto de renda/.test(d) && !isProv) {
      it.action = 'ignore'; it.include = false; it.label = 'Calculado pelo app (conferido abaixo)';
    } else if (/d\.?\s?s\.?\s?r/.test(d)) {
      it.action = 'ignore'; it.include = false; it.label = 'DSR é calculado sozinho sobre as horas extras';
    } else if (/sal[aá]rio.?fam[ií]lia/.test(d)) {
      it.action = 'family'; it.params.children = Math.max(1, Math.round(value / Math.round(table.family?.quota * 100 || value)));
      it.label = `Salário-família: ${it.params.children} filho(s) até 14 anos`;
    } else if (/atestado|aux.*doen|licen[cç]a m[eé]dica|afast.*doen/.test(d) && isProv) {
      it.action = 'sick'; it.params.days = Math.round(v.ref || (baseSalary ? value * 30 / baseSalary : 0)) || 1;
      sickDays += it.params.days;
      it.label = `Atestado médico: ${it.params.days} dias (pago pela empresa)`;
    } else if (/^sal[aá]rio( contratual| base| mensal|$)|horas normais|dias trabalhados/.test(d) && isProv) {
      it.action = 'base'; workedDays = v.ref && v.ref <= 31 ? Math.round(v.ref) : null;
      if (!baseSalary) baseSalary = workedDays ? Math.round((value * 30) / workedDays) : value;
      it.label = `Salário base ${workedDays ? `(${workedDays} dias trabalhados)` : ''}`.trim();
    } else if (/falta/.test(d) && !isProv) {
      it.action = 'falta'; it.params.days = Math.round(v.ref || (baseSalary ? value * 30 / baseSalary : 1)) || 1;
      it.label = `Faltas: ${it.params.days} dia(s) — o app calcula o desconto`;
    } else if (/sobreaviso/.test(d) && v.ref) {
      Object.assign(it, { action: 'hours', params: { hourKind: 'sobreaviso', minutes: Math.round(v.ref * 60), dsr: false }, label: `Sobreaviso: ${v.refText} h (variável no mês)` });
    } else if (/(hora|h\.?)\s*extra|^h\.?e\.?\s/.test(d) && v.ref) {
      const k = /100/.test(d) ? 'he100' : 'he50';
      Object.assign(it, { action: 'hours', params: { hourKind: k, minutes: Math.round(v.ref * 60), dsr: hasDsr }, label: `Horas extras ${k === 'he100' ? '100%' : '50%'}: ${v.refText} h${hasDsr ? ' + DSR' : ''} (variável)` });
    } else if (/noturn/.test(d) && v.ref) {
      Object.assign(it, { action: 'hours', params: { hourKind: 'noturno', minutes: Math.round(v.ref * 60), dsr: hasDsr }, label: `Adicional noturno: ${v.refText} h (variável)` });
    } else if (/periculosidade|insalubridade|gratifica|anu[eê]nio|quinqu[eê]nio|tri[eê]nio/.test(d) && isProv) {
      const pct = pctIn(v.description);
      const onMinimum = /insalubridade/.test(d);
      if (pct) {
        Object.assign(it, { action: 'percent', params: { value: pct, base: onMinimum ? 'minimum' : 'salary' }, label: `Adicional fixo: ${pct / 100}% do ${onMinimum ? 'salário mínimo' : 'salário base'}` });
      } else {
        Object.assign(it, { action: 'addition', params: { variable: false }, label: 'Adicional fixo em R$ (todo mês)' });
      }
    } else if (/empr[eé]stimo|consignado|cr[eé]dito do trabalhador|financiamento|cart[aã]o benef/.test(d) && !isProv) {
      const existing = findLoan(settings, v.description);
      Object.assign(it, {
        action: 'loan',
        params: { count: existing?.loan?.count || '', paid: existing?.loan ? Math.max(0, monthsSince(existing.loan.startYM, ym)) : '', existingId: existing?.id || null },
        label: existing ? 'Consignado já cadastrado — atualiza o valor' : 'Desconto parcelado (consignado) — informe as parcelas',
      });
    } else if (/pens[aã]o/.test(d) && !isProv) {
      Object.assign(it, { action: 'deduction', params: { variable: false, irDeductible: true }, label: 'Desconto fixo · dedutível do IR' });
    } else if (!isProv) {
      const recurring = /mensalidade|sindic|plano|sa[uú]de|odonto|seguro|associa|vale|previd[eê]ncia priv|contribui/.test(d);
      Object.assign(it, { action: 'deduction', params: { variable: !recurring, irDeductible: false }, label: recurring ? 'Desconto fixo (todo mês)' : 'Desconto variável (só neste mês)' });
    } else {
      Object.assign(it, { action: 'addition', params: { variable: true }, label: 'Adicional variável (só neste mês)' });
    }
    items.push(it);
  }

  // Dias que faltam no salário (sem atestado): afastamento pelo INSS ou falta não remunerada
  if (workedDays != null && workedDays + sickDays < 30) {
    const days = 30 - workedDays - sickDays;
    items.push({
      code: '—', description: 'Dias não pagos no mês', ref: days, provento: 0, desconto: 0,
      action: 'inss-days', include: false, params: { days },
      label: `${days} dia(s) sem pagamento da empresa: marque se foi afastamento pelo INSS`,
    });
  }

  return {
    competence: ym, admission: parsed.admission, baseSalary, net: parsed.net, totals: parsed.totals, bases: parsed.bases,
    useNet: parsed.net != null, items,
  };
}

const norm = (s) => plain(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function monthsSince(fromYM, toYM) {
  if (!fromYM || !toYM) return 0;
  return (Number(toYM.slice(0, 4)) - Number(fromYM.slice(0, 4))) * 12 + Number(toYM.slice(5, 7)) - Number(fromYM.slice(5, 7));
}
function findLoan(settings, description) {
  const n = norm(description);
  return (settings.payrollLoans || []).find((l) => norm(l.description) === n || (/trabalhador/.test(n) && /trabalhador/.test(norm(l.description))) || (/consignado/.test(n) && /consignado/.test(norm(l.description))));
}

/** Nome amigável para a verba (o holerite costuma vir em maiúsculas). */
const ACCENT_WORDS = {
  salario: 'salário', medico: 'médico', medica: 'médica', previdencia: 'previdência', familia: 'família', pensao: 'pensão',
  alimenticia: 'alimentícia', credito: 'crédito', emprestimo: 'empréstimo', gratificacao: 'gratificação', funcao: 'função',
  ferias: 'férias', referencia: 'referência', licenca: 'licença', antecipacao: 'antecipação', contribuicao: 'contribuição',
  assistencia: 'assistência', odontologica: 'odontológica', saude: 'saúde', noturno: 'noturno', periculosidade: 'periculosidade',
  insalubridade: 'insalubridade', adiantamento: 'adiantamento', anuenio: 'anuênio', quinquenio: 'quinquênio', trienio: 'triênio',
  vale: 'vale', refeicao: 'refeição', alimentacao: 'alimentação', mensalidade: 'mensalidade', sindical: 'sindical', judicial: 'judicial',
};

/** Nome amigável para a verba (o holerite costuma vir em maiúsculas e sem acento). */
export function friendlyName(desc) {
  let s = desc.replace(/^desconto\s+/i, '').replace(/\s*-\s*horas$/i, '').trim();
  if (/periculosidade|insalubridade|gratifica/i.test(s)) s = s.replace(/\s+\d+(?:[.,]\d+)?\s*%$/, '');
  if (/^i\.?\s?n\.?\s?s\.?\s?s\.?$/i.test(s)) return 'INSS';
  s = s.replace(/\bD\s?\.?\s?S\s?\.?\s?R\b\.?/i, 'DSR');
  s = s.split(/\s+/).map((w) => {
    const k = plain(w);
    return ACCENT_WORDS[k] && w === w.toUpperCase() ? ACCENT_WORDS[k] : w;
  }).join(' ');
  const acronyms = s.split(/\s+/).filter((w) => /^[A-Z]{3,5}$/.test(w) && !COMMON_SHORT.has(w.toLowerCase()));
  let out = title(s);
  for (const w of acronyms) out = out.replace(new RegExp(`\\b${w[0]}${w.slice(1).toLowerCase()}\\b`), w);
  return out;
}
const COMMON_SHORT = new Set(['vale', 'plano', 'base', 'horas', 'hora', 'dias', 'sobre', 'folha', 'extra', 'pago', 'juros', 'taxa', 'multa', 'aviso', 'bonus', 'vida', 'fixo', 'renda', 'total', 'falta', 'mes', 'ano', 'para', 'saldo', 'seguro', 'premio', 'ajuda', 'custo', 'outro', 'outros', 'trab', 'abono', 'prev', 'adic', 'desc', 'sal']);
export { norm as normalizeName };

// ---------- Conferência linha a linha ----------

const words = (s) => new Set(plain(String(s)).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3));

/**
 * Compara cada verba do holerite com a linha que o app calculou.
 * `items`: verbas do holerite ({ description, provento, desconto });
 * `p`: resultado de payrollFor (domain/payroll.js).
 * → [{ label, payslip, app, diff, sign: 1|-1 }] — `diff` = app − holerite
 *   (null quando um dos lados não tem a linha).
 */
export function compareLines(items, p) {
  const app = [
    { label: 'Salário base', cents: p.base, sign: 1, re: /^sal[aá]rio( contratual| base| mensal|$)|horas normais|dias trabalhados/i },
    ...(p.additions || []).map((a) => ({ label: a.description, cents: a.cents, sign: 1 })),
    { label: p.inssLabel || 'INSS', cents: p.inss, sign: -1, re: /i\.?\s?n\.?\s?s\.?\s?s|previd[eê]ncia/i },
    { label: 'IRRF', cents: p.ir?.value || 0, sign: -1, re: /irrf|i\.r\.r\.f|imposto de renda/i },
    ...(p.deductions || []).map((d) => ({ label: d.description, cents: d.cents, sign: -1 })),
  ];
  const used = new Set();
  const rows = [];
  for (const it of items) {
    const value = it.provento || it.desconto;
    if (!value) continue;
    const sign = it.provento ? 1 : -1;
    let best = -1;
    let bestScore = 0;
    app.forEach((a, i) => {
      if (used.has(i) || a.sign !== sign) return;
      let score = 0;
      if (a.re?.test(it.description)) score = 2;
      else {
        const wa = words(a.label);
        const wb = words(it.description);
        let common = 0;
        for (const w of wb) if (wa.has(w)) common++;
        score = wa.size && wb.size ? common / Math.min(wa.size, wb.size) : 0;
        if (score < 0.5 && a.cents === value) score = 0.5; // mesmo valor, nomes diferentes
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0 && bestScore >= 0.5) {
      used.add(best);
      rows.push({ label: it.description, payslip: value, app: app[best].cents, diff: app[best].cents - value, sign });
    } else rows.push({ label: it.description, payslip: value, app: null, diff: null, sign });
  }
  app.forEach((a, i) => { if (!used.has(i) && a.cents) rows.push({ label: a.label, payslip: null, app: a.cents, diff: null, sign: a.sign }); });
  return rows;
}
