// =============================================================
// exports.js — Baixar dados: holerite (PDF), contracheques e
// resumo financeiro (planilhas CSV, abrem no Excel/Planilhas)
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { selectField } from './forms.js';
import { download, toCSV, num, exportBackup, exportMonthCSV } from './backup.js';
import { payslipHTML } from './payrollEditor.js';
import { store } from '../core/store.js';
import { formatBRL } from '../core/money.js';
import { formatMonth, formatMonthTitle, formatDateBR, currentYM, todayISO, ymOf } from '../core/dates.js';
import { payslipIncome, computeMonth } from '../domain/ledger.js';
import { paydayForCompetence } from '../domain/payroll.js';
import { monthsWithData } from '../domain/analysis.js';
import { portfolio, typeOf, classOf, INVEST_CLASSES, LIQUIDITY, MOVEMENT_KINDS, rateLabel } from '../domain/investments.js';

const MONTHS = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

// ---------- Holerite (para imprimir / salvar em PDF) ----------

/** Abre o holerite do mês num layout de impressão e chama "Imprimir / Salvar como PDF". */
export function printPayslip(ym = store.ui.ym) {
  const d = store.data;
  const inc = payslipIncome(d, ym);
  const name = d.settings.profileName;
  const { dialog } = openDialog({
    title: `Holerite · ${formatMonth(ym)}`,
    size: 'lg',
    footer: html`<button type="button" class="btn btn--primary" data-print>${icon('printer')} Imprimir / salvar PDF</button>
      <button type="button" class="btn btn--ghost" data-csv>${icon('file-spreadsheet')} CSV</button>`,
    body: html`
      <div class="report payslip-doc">
        <header class="payslip-doc__head">
          <div>
            <p class="payslip-doc__brand">Dhenors</p>
            <h3>Demonstrativo de pagamento (estimado)</h3>
          </div>
          <dl>
            ${name ? html`<div><dt>Nome</dt><dd>${name}</dd></div>` : ''}
            <div><dt>Competência</dt><dd>${formatMonthTitle(ym)}</dd></div>
            <div><dt>Dia do pagamento</dt><dd>${formatDateBR(paydayForCompetence(d.settings, ym))}</dd></div>
            <div><dt>Emitido em</dt><dd>${formatDateBR(todayISO())}</dd></div>
          </dl>
        </header>
        ${payslipHTML(inc.payroll, inc.extras.filter((x) => !x.payroll), { thirteenth: inc.thirteenth, actual: inc.actual })}
        <p class="payslip-doc__total">Renda total do mês: <strong>${formatBRL(inc.total)}</strong></p>
      </div>`,
  });
  dialog.querySelector('[data-print]').addEventListener('click', () => {
    document.body.classList.add('is-printing');
    window.print();
    document.body.classList.remove('is-printing');
  });
  dialog.querySelector('[data-csv]').addEventListener('click', () => exportPayrollCSV([ym], `dhenors-holerite-${ym}.csv`));
}

// ---------- Contracheques detalhados (proventos e descontos) ----------

/**
 * Uma linha por item do contracheque de cada mês:
 * Mês; Grupo; Descrição; Detalhe; Valor
 */
export function exportPayrollCSV(months, filename) {
  const d = store.data;
  const rows = [['Competência', 'Grupo', 'Descrição', 'Detalhe', 'Valor (R$)']];
  for (const ym of months) {
    const inc = payslipIncome(d, ym);
    const p = inc.payroll;
    if (!p.hasProfile && !p.extras && !inc.extras.length) continue;
    const m = formatMonthTitle(ym);
    for (const l of (p.baseLines?.length ? p.baseLines : (p.base ? [{ description: 'Salário base', detail: '', cents: p.base }] : []))) rows.push([m, 'Provento', l.description, l.detail, num(l.cents)]);
    for (const a of p.additions) rows.push([m, 'Provento', a.description, [a.detail, a.variable ? 'variável' : 'fixo', a.taxable ? '' : 'sem impostos'].filter(Boolean).join(' · '), num(a.cents)]);
    if (p.extras) rows.push([m, 'Provento', 'Plantões / extras na folha', '', num(p.extras)]);
    rows.push([m, 'Total', 'Bruto', '', num(p.gross)]);
    rows.push([m, 'Desconto', p.inssLabel, p.inssLabel === 'INSS' ? `faixa ${p.inssBand}%` : `${p.inssBand}%`, num(-p.inss)]);
    rows.push([m, 'Desconto', 'Imposto de Renda', `${p.ir.method}${p.ir.reduction ? ` · redução de ${formatBRL(p.ir.reduction)}` : ''}`, num(-p.ir.value)]);
    for (const x of p.deductions) rows.push([m, 'Desconto', x.description, [x.detail, x.variable ? 'variável' : ''].filter(Boolean).join(' · '), num(-x.cents)]);
    rows.push([m, 'Total', 'Total de descontos', '', num(-(p.inss + p.ir.value + p.deductionsTotal))]);
    rows.push([m, 'Total', inc.actual != null ? 'Líquido da folha (conferido)' : 'Líquido da folha (estimado)', '', num(inc.actual ?? p.net)]);
    for (const x of inc.extras.filter((e) => !e.payroll)) rows.push([m, 'Extra fora da folha', x.description, '', num(x.cents)]);
    if (inc.thirteenth) rows.push([m, '13º salário', inc.thirteenth.label, `${inc.thirteenth.avos}/12 avos`, num(inc.thirteenth.net)]);
    rows.push([m, 'Total', 'Renda do mês', '', num(inc.total)]);
    if (p.bases) {
      rows.push([m, 'Base', 'Base INSS', '', num(p.bases.inss)]);
      if (p.bases.fgts) rows.push([m, 'Base', 'Base FGTS', '', num(p.bases.fgts)]);
      rows.push([m, 'Base', 'Base IRRF', '', num(p.bases.irrf)]);
    }
    if (p.fgts) rows.push([m, 'Informativo', 'FGTS depositado', '8% (não descontado)', num(p.fgts)]);
    rows.push([]);
  }
  download(filename, toCSV(rows), 'text/csv;charset=utf-8');
  toast('Planilha de contracheques baixada.');
}

// ---------- Resumo financeiro mensal ----------

/** Uma linha por mês: renda (bruto → líquido), gastos e saldo. Com linha de total. */
export function exportSummaryCSV(months, filename) {
  const d = store.data;
  const head = ['Mês', 'Salário base', 'Adicionais', 'Plantões na folha', 'Bruto', 'INSS/Previdência', 'Imposto de Renda',
    'Descontos em folha', 'Líquido da folha', 'Extras fora da folha', '13º', 'Renda do mês',
    'Contas avulsas', 'Recorrentes', 'Parcelas', 'Total de gastos', 'Já pago', 'Saldo do mês', 'FGTS (informativo)'];
  const rows = [head];
  const totals = new Array(head.length - 1).fill(0);
  for (const ym of months) {
    const m = computeMonth(d, ym, todayISO());
    const p = m.income.payroll;
    const outside = m.income.extras.filter((x) => !x.payroll).reduce((s, x) => s + x.cents, 0);
    const values = [
      p.base, p.additions.reduce((s, a) => s + a.cents, 0), p.extras, p.gross, p.inss, p.ir.value,
      p.deductionsTotal, m.income.actual ?? p.net, outside, m.income.thirteenth?.net || 0, m.income.total,
      m.totals.expense, m.totals.recurring, m.totals.installment, m.totals.all, m.totals.paid, m.balance, p.fgts,
    ];
    if (values.every((v) => !v)) continue;
    values.forEach((v, i) => { totals[i] += v; });
    rows.push([formatMonthTitle(ym), ...values.map(num)]);
  }
  rows.push(['Total', ...totals.map(num)]);
  download(filename, toCSV(rows), 'text/csv;charset=utf-8');
  toast('Resumo financeiro baixado.');
}

// ---------- Investimentos ----------

/** Carteira (uma linha por investimento) e, abaixo, todos os movimentos. */
export function exportInvestmentsCSV() {
  const pf = portfolio(store.data, todayISO());
  if (!pf.positions.length) return toast('Nenhum investimento cadastrado.', { type: 'info' });
  const rows = [['Investimento', 'Tipo', 'Classe', 'Instituição', 'Rentabilidade', 'Liquidez', 'Vencimento', 'Reserva',
    'Saldo (R$)', 'Investido (R$)', 'Rendimento (R$)', 'Rendimento (%)', 'IR estimado (R$)', 'Líquido (R$)', 'Proventos (R$)', 'Lucro resgatado (R$)', 'Saldo é estimado?']];
  for (const { inv, pos } of pf.positions) {
    rows.push([inv.name, typeOf(inv).label, INVEST_CLASSES[classOf(inv)].label, inv.institution, rateLabel(inv), LIQUIDITY[inv.liquidity],
      inv.maturity ? formatDateBR(inv.maturity) : '', inv.emergency ? 'Sim' : '',
      num(pos.value), num(pos.principal), num(pos.gain), pos.gainPct.toFixed(2).replace('.', ','), num(pos.ir), num(pos.net), num(pos.income), num(pos.realized), pos.estimated ? 'Sim' : 'Não']);
  }
  const t = pf.totals;
  rows.push(['Total', '', '', '', '', '', '', '', num(t.value), num(t.principal), num(t.gain), t.gainPct.toFixed(2).replace('.', ','), num(t.ir), num(t.net), num(t.income), num(t.realized), '']);
  rows.push([]);
  rows.push(['Data', 'Investimento', 'Movimento', 'Valor (R$)', 'Observação']);
  const movs = pf.positions.flatMap(({ inv }) => inv.movements.map((m) => ({ inv, m }))).sort((a, b) => a.m.date.localeCompare(b.m.date));
  for (const { inv, m } of movs) rows.push([formatDateBR(m.date), inv.name, MOVEMENT_KINDS[m.kind].label, num(m.kind === 'resgate' ? -m.cents : m.cents), m.note]);
  download(`dhenors-investimentos-${todayISO()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  toast('Planilha de investimentos baixada.');
}

// ---------- Janela "Exportar" ----------

const KINDS = [
  { value: 'payslip', label: 'Holerite do mês (PDF para imprimir/salvar)', icon: 'printer', period: 'month' },
  { value: 'payroll', label: 'Contracheques: proventos e descontos (planilha)', icon: 'file-spreadsheet', period: 'year' },
  { value: 'summary', label: 'Resumo mensal: renda, gastos e saldo (planilha)', icon: 'chart-column', period: 'year' },
  { value: 'bills', label: 'Contas do mês (planilha)', icon: 'receipt', period: 'month' },
  { value: 'investments', label: 'Investimentos: carteira e movimentos (planilha)', icon: 'coins', period: 'none' },
  { value: 'backup', label: 'Backup completo (JSON)', icon: 'database', period: 'none' },
];

export function openExportDialog(preset = 'payroll') {
  const d = store.data;
  const years = [...new Set([...monthsWithData(d).map((ym) => ym.slice(0, 4)), currentYM().slice(0, 4)])].sort().reverse();
  const months = [...new Set([store.ui.ym, ...monthsWithData(d)])].sort().reverse();

  openDialog({
    title: 'Baixar dados',
    submitLabel: 'Baixar',
    body: html`
      <fieldset class="field export-kinds">
        <legend class="field__label">O que você quer baixar?</legend>
        ${KINDS.map((k) => html`
          <label class="export-kind">
            <input type="radio" name="kind" value="${k.value}" ${k.value === preset ? 'checked' : ''}>
            <span class="export-kind__icon">${icon(k.icon)}</span>
            <span>${k.label}</span>
          </label>`)}
      </fieldset>
      <div class="form-grid">
        <div data-period="year">${selectField({ label: 'Ano', name: 'year', value: store.ui.ym.slice(0, 4), options: [...years.map((y) => ({ value: y, label: y })), { value: 'all', label: 'Todos os meses' }] })}</div>
        <div data-period="month">${selectField({ label: 'Mês', name: 'month', value: store.ui.ym, options: months.map((ym) => ({ value: ym, label: formatMonthTitle(ym) })) })}</div>
      </div>
      <p class="field__hint">As planilhas são arquivos CSV: abrem no Excel, Google Planilhas e LibreOffice.</p>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => {
        const kind = KINDS.find((k) => k.value === form.querySelector('[name="kind"]:checked').value);
        for (const el of dlg.querySelectorAll('[data-period]')) el.hidden = el.dataset.period !== kind.period;
      };
      form.addEventListener('change', sync);
      sync();
    },
    onSubmit: (form) => {
      const kind = form.querySelector('[name="kind"]:checked').value;
      const year = form.year.value;
      const range = year === 'all'
        ? monthsWithData(d).slice().reverse()
        : MONTHS(year).filter((ym) => ym <= ymOf(todayISO()) || d.closedMonths[ym] || ym <= store.ui.ym);
      const tag = year === 'all' ? 'completo' : year;
      if (kind === 'payslip') setTimeout(() => printPayslip(form.month.value));
      if (kind === 'payroll') exportPayrollCSV(range, `dhenors-contracheques-${tag}.csv`);
      if (kind === 'summary') exportSummaryCSV(range, `dhenors-resumo-${tag}.csv`);
      if (kind === 'bills') exportMonthCSV(form.month.value);
      if (kind === 'investments') exportInvestmentsCSV();
      if (kind === 'backup') exportBackup();
    },
  });
}
