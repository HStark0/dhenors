// =============================================================
// Salário — do bruto ao líquido, com adicionais e descontos em folha
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { meter } from '../ui/charts.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import * as E from '../ui/editors.js';
import { payslipHTML } from '../ui/payrollEditor.js';
import { printPayslip, openExportDialog } from '../ui/exports.js';
import { openPayslipImport } from '../ui/payslipImport.js';
import { openDialog } from '../ui/dialog.js';
import { moneyField, dateField, numberField, switchField, segmentedField, field } from '../ui/forms.js';
import { store } from '../core/store.js';
import { formatBRL, formatPercent, percent, toCents, plural } from '../core/money.js';
import {
  formatMonth, formatMonthShort, formatDateBR, todayISO, relativeDays, addMonthsYM, addDaysISO, weekdayLong,
} from '../core/dates.js';
import {
  payrollProfileFor, computePayroll, loanStatus, payrollFor, variableFor, employmentOf, thirteenthFor,
  paydayForCompetence, paydayLabel, vacationFor, absencesIn, paydayOf, HOUR_KINDS, formatHours,
} from '../domain/payroll.js';
import { payslipIncome as incomeFor } from '../domain/ledger.js';
import { tablesFor } from '../domain/taxTables.js';
import * as A from '../domain/actions.js';

export default {
  id: 'salario',
  title: 'Salário',
  monthNav: true,

  render() {
    const d = store.data;
    const ym = store.ui.ym;
    const profile = payrollProfileFor(d.settings, ym);
    const inc = incomeFor(d, ym);
    const p = inc.payroll;

    if (!profile) {
      return html`
        <div class="card empty">
          ${icon('banknote', 'icon--lg')}
          <p><strong>Nenhum salário cadastrado para ${formatMonth(ym)}.</strong></p>
          <p class="muted">Informe o salário bruto: o app calcula INSS, Imposto de Renda e o líquido. Depois inclua adicionais e descontos em folha.</p>
          <div class="card__actions" style="justify-content:center">
            <button type="button" class="btn btn--primary" data-action="sal:base">${icon('plus')} Cadastrar salário</button>
            <button type="button" class="btn btn--secondary" data-action="sal:import">${icon('file-up')} Importar holerite (PDF)</button>
          </div>
        </div>`;
    }

    // O contracheque "puro" (sem plantões) para os cards de adicionais/descontos
    const base = payrollFor(d.settings, ym);
    const vars = variableFor(d.settings, ym);

    return html`
      ${profile.legacyNet ? html`
        <div class="banner" role="note">
          ${icon('info')}
          <p>Seu salário foi cadastrado na versão anterior como valor <strong>líquido</strong>. Informe o bruto para o app calcular INSS, IR, adicionais e descontos.</p>
          <button type="button" class="btn btn--secondary btn--sm" data-action="sal:base">Informar bruto</button>
        </div>` : ''}

      <div class="page-head">
        <p class="muted">Valores estimados de ${formatMonth(ym)} · confira com seu holerite</p>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost" data-action="sal:import">${icon('file-up')} Importar holerite</button>
          <button type="button" class="btn btn--ghost" data-action="sal:print">${icon('printer')} Baixar holerite</button>
          <button type="button" class="btn btn--secondary" data-action="sal:export">${icon('download')} Exportar dados</button>
        </div>
      </div>

      <section class="grid grid--hero">
        ${hero(p, inc, ym)}
        ${baseCard(profile, ym)}
      </section>

      <section class="grid grid--two">
        ${linesCard('add', [...profile.additions, ...vars.filter((v) => v.kind === 'add')], base, profile, ym)}
        ${linesCard('ded', [...profile.deductions, ...(d.settings.payrollLoans || []), ...vars.filter((v) => v.kind === 'ded')], base, profile, ym)}
      </section>
      ${copyVariablesHint(d.settings, ym, vars)}

      <section class="masonry">
        <article class="card">
          <header class="card__header">
            <h2 class="card__title">${icon('receipt')} Contracheque de ${formatMonth(ym)}</h2>
          </header>
          ${payslipHTML(p, inc.extras.filter((x) => !x.payroll), { thirteenth: inc.thirteenth, actual: inc.actual })}
        </article>
          ${absenceCard(d.settings, ym)}
          ${checkCard(inc, ym)}
          ${vacationCard(d.settings, ym)}
          ${thirteenthCard(d.settings, ym)}
          ${shiftsCard(inc, ym)}
          ${historyCard(d.settings, ym)}
        
      </section>`;
  },

  actions: {
    'sal:base': () => E.editSalaryBase(store.ui.ym),
    'sal:add': (el) => E.editPayrollLine(store.ui.ym, el.dataset.kind),
    'sal:edit': (el) => E.editPayrollLine(store.ui.ym, el.dataset.kind, findLine(el)),
    'sal:delete': async (el) => {
      const line = findLine(el);
      const ok = await confirmDialog({
        title: 'Remover',
        message: `Remover "${line.description}" do salário a partir de ${formatMonth(store.ui.ym)}? Os meses anteriores não mudam.`,
        confirmLabel: 'Remover', danger: true,
      });
      if (ok) { A.deletePayrollLine(store.ui.ym, el.dataset.kind, line.id); toast('Removido.'); }
    },
    'sal:history-del': async (el) => {
      const ok = await confirmDialog({ title: 'Remover registro', message: `Remover o salário cadastrado a partir de ${formatMonth(el.dataset.from)}?`, confirmLabel: 'Remover', danger: true });
      if (ok) A.deleteSalaryEntry(el.dataset.from);
    },
    'sal:shift': () => E.editExtraIncome(),
    'sal:print': () => printPayslip(store.ui.ym),
    'sal:export': () => openExportDialog('payroll'),
    'sal:copy-vars': () => {
      const n = A.copyVariablesFromPrevious(store.ui.ym);
      toast(`${plural(n, 'lançamento variável copiado', 'lançamentos variáveis copiados')} do mês anterior.`);
    },
    'sal:actual': () => actualDialog(store.ui.ym),
    'sal:actual-clear': () => { A.setActualNet(store.ui.ym, null); toast('Voltando a usar a estimativa.'); },
    'sal:import': () => openPayslipImport(store.ui.ym),
    'abs:new': () => absenceDialog(store.ui.ym, null),
    'abs:edit': (el) => absenceDialog(store.ui.ym, (store.data.settings.absences || []).find((a) => a.id === el.dataset.id)),
    'abs:delete': (el) => { A.deleteAbsence(el.dataset.id); toast('Removido.'); },
    'vac:new': () => vacationDialog(null),
    'vac:edit': (el) => vacationDialog((store.data.settings.vacations || []).find((v) => v.id === el.dataset.id)),
    'vac:delete': async (el) => {
      const ok = await confirmDialog({ title: 'Remover férias', message: 'Remover estas férias do planejamento?', confirmLabel: 'Remover', danger: true });
      if (ok) { A.deleteVacation(el.dataset.id); toast('Férias removidas.'); }
    },
  },
};

function findLine(el) {
  const s = store.data.settings;
  const ym = store.ui.ym;
  const profile = payrollProfileFor(s, ym);
  const vars = variableFor(s, ym);
  const list = el.dataset.kind === 'add'
    ? [...profile.additions, ...vars]
    : [...profile.deductions, ...(s.payrollLoans || []), ...vars];
  return list.find((x) => x.id === el.dataset.id);
}

/** Informar o líquido que caiu de verdade (do holerite). */
function actualDialog(ym) {
  const inc = incomeFor(store.data, ym);
  openDialog({
    title: `Líquido recebido em ${formatMonth(ym)}`,
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Digite o <strong>líquido</strong> do seu holerite (com plantões na folha, sem o 13º). O app passa a usar esse valor na renda do mês.</p>
      ${moneyField({ label: 'Líquido do holerite', name: 'cents', cents: inc.actual, hint: `Estimativa do app: ${formatBRL(inc.estimatedNet)}` })}`,
    onSubmit: (form) => {
      A.setActualNet(ym, toCents(form.cents.value));
      toast('Valor conferido salvo.');
    },
  });
}

// ---------- Blocos ----------

function hero(p, inc, ym) {
  const s = store.data.settings;
  const payday = paydayForCompetence(s, ym);
  const next = paydayOf(s).nextMonth;
  const gross = p.gross || 1;
  const parts = [
    { key: 'net', label: 'Líquido', cents: Math.max(0, p.net) },
    { key: 'inss', label: p.inssLabel, cents: p.inss },
    { key: 'ir', label: 'Imposto de Renda', cents: p.ir.value },
    { key: 'ded', label: 'Descontos', cents: p.deductionsTotal },
  ].filter((x) => x.cents > 0);

  return html`
    <article class="card hero salary-hero">
      <p class="hero__label">Salário líquido de ${formatMonth(ym)}${next ? ' (competência)' : ''} ${inc.actual != null ? html`<span class="badge badge--good">conferido no holerite</span>` : html`<span class="badge badge--muted">estimado</span>`}</p>
      <p class="hero__value money">${formatBRL(inc.actual ?? p.net)}</p>
      ${p.legacyNet ? '' : html`
        <p class="hero__formula">
          <span>${formatBRL(p.gross)} bruto</span>
          <span aria-hidden="true">−</span><span>${formatBRL(p.inss + p.ir.value)} impostos</span>
          ${p.deductionsTotal ? html`<span aria-hidden="true">−</span><span>${formatBRL(p.deductionsTotal)} descontos</span>` : ''}
        </p>
        <div class="stackbar" role="img" aria-label="${parts.map((x) => `${x.label}: ${formatBRL(x.cents)}`).join(', ')}">
          ${parts.map((x) => html`<span class="stackbar__seg stackbar__seg--${x.key}" style="width:${((x.cents / gross) * 100).toFixed(2)}%" title="${x.label}: ${formatBRL(x.cents)}"></span>`)}
        </div>
        <ul class="stackbar__legend">
          ${parts.map((x) => html`<li><span class="dot dot--${x.key}"></span>${x.label}<strong>${formatPercent(percent(x.cents, gross))}</strong></li>`)}
        </ul>`}
      ${inc.vacation ? html`<p class="hero__formula">${icon('tree-palm', 'icon--xs')} <span>Férias neste mês: +${formatBRL(inc.vacation.net)} líquido (salário proporcional a ${30 - inc.vacation.days} dias trabalhados)</span></p>` : ''}
      <div class="hero__payday">
        ${icon('calendar')}
        <span>Pagamento <strong>${paydayLabel(s)}</strong> · cai em <strong>${formatDateBR(payday)}</strong> (${relativeDays(payday)})</span>
        ${inc.extrasCents || inc.thirteenth ? html`<span class="hero__perday">Renda do mês${inc.thirteenth ? ' (com 13º)' : ''}: <strong>${formatBRL(inc.total)}</strong></span>` : ''}
      </div>
    </article>`;
}

function baseCard(profile, ym) {
  const emp = employmentOf(store.data.settings);
  return html`
    <article class="card salary-base">
      <header class="card__header">
        <h2 class="card__title">${icon('banknote')} Salário base</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="sal:base">${icon('pencil', 'icon--xs')} Editar</button>
      </header>
      <p class="big-number money">${formatBRL(profile.grossCents)}</p>
      <p class="muted small">${profile.legacyNet ? 'valor líquido (cadastro antigo)' : 'bruto mensal'}</p>
      <dl class="kv kv--stack">
        <div><span>Dependentes</span><strong>${profile.dependents || 0}</strong></div>
        <div><span>Vale desde</span><strong>${formatMonthShort(profile.from)}</strong></div>
        <div><span>Tabelas INSS/IR</span><strong>${tablesFor(Number(ym.slice(0, 4))).year}</strong></div>
        <div><span>Previdência</span><strong>${emp.regime === 'fixed' ? `${formatPercent(emp.fixedRateBp / 100, 2)} fixo` : 'INSS'}</strong></div>
        <div><span>Admissão</span><strong>${emp.admission ? formatDateBR(emp.admission) : '—'}</strong></div>
        <div><span>13º automático</span><strong>${emp.thirteenth ? 'Sim' : 'Não'}</strong></div>
      </dl>
    </article>`;
}

/** Card de adicionais ('add') ou descontos em folha ('ded', inclui consignados). */
function linesCard(kind, all, payroll, profile, ym) {
  const isAdd = kind === 'add';
  const computed = new Map((isAdd ? payroll.additions : payroll.deductions).map((x) => [x.id, x]));
  const active = all.filter((x) => computed.has(x.id));
  const inactive = all.filter((x) => !computed.has(x.id)); // consignados quitados ou que ainda não começaram
  const total = active.reduce((s, x) => s + computed.get(x.id).cents, 0);
  const disabled = profile.legacyNet;

  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon(isAdd ? 'trending-up' : 'trending-down')} ${isAdd ? 'Adicionais' : 'Descontos em folha'}</h2>
        <button type="button" class="btn btn--secondary btn--sm" data-action="sal:add" data-kind="${kind}" ${disabled ? 'disabled' : ''}>${icon('plus', 'icon--xs')} ${isAdd ? 'Adicional' : 'Desconto'}</button>
      </header>
      ${active.length ? html`
        <ul class="plines">${active.map((x) => lineRow(kind, x, computed.get(x.id), ym))}</ul>
        <p class="card__total"><span>Total no mês</span><strong class="money ${isAdd ? 'pos' : 'neg'}">${isAdd ? '+' : '−'}${formatBRL(total)}</strong></p>`
      : html`<p class="muted small empty-line">${isAdd
          ? 'Insalubridade, periculosidade, gratificações… em % ou R$.'
          : 'Plano de saúde, vale-transporte, consignado, sindicato…'}</p>`}
      ${inactive.length ? html`
        <details class="details">
          <summary>${inactive.length} fora deste mês</summary>
          <ul class="plines plines--muted">${inactive.map((x) => lineRow(kind, x, null, ym))}</ul>
        </details>` : ''}
    </article>`;
}

function lineRow(kind, line, computed, ym) {
  const isAdd = kind === 'add';
  const loan = line.loan ? loanStatus(line.loan, ym) : null;
  const what = line.mode === 'hours'
    ? `${formatHours(line.value)} · ${line.hourKind === 'custom' ? `${(line.hourPct / 100).toLocaleString('pt-BR')}% da hora` : HOUR_KINDS[line.hourKind]?.label.toLowerCase() || 'horas'}${line.dsr ? ' + DSR' : ''}`
    : line.mode === 'percent'
    ? `${(line.value / 100).toLocaleString('pt-BR')}% ${line.base === 'minimum' ? 'do salário mínimo' : line.base === 'gross' ? 'do bruto' : 'do salário'}`
    : 'valor fixo';
  const flags = isAdd
    ? (line.taxable === false ? 'sem INSS/IR' : 'incide INSS/IR')
    : (line.irDeductible ? 'dedutível do IR' : '');
  const recurrence = line.loan ? '' : line.ym ? `variável · só em ${formatMonthShort(line.ym)}` : 'fixo · todo mês';

  return html`
    <li class="pline">
      <span class="pline__icon ${isAdd ? 'is-add' : 'is-ded'}" aria-hidden="true">${icon(loan ? 'credit-card' : isAdd ? 'plus' : 'banknote')}</span>
      <div class="pline__main">
        <strong>${line.description} ${recurrence ? html`<span class="badge ${line.ym ? 'badge--info' : 'badge--muted'}">${line.ym ? 'variável' : 'fixo'}</span>` : ''}</strong>
        <small>${[what, flags, line.ym ? `só em ${formatMonthShort(line.ym)}` : ''].filter(Boolean).join(' · ')}</small>
        ${loan ? html`
          <div class="pline__loan">
            ${meter(Math.min(loan.n, loan.count), { max: loan.count, label: `Parcela ${loan.n} de ${loan.count}`, tone: loan.finished ? 'good' : '' })}
            <small>${loan.finished
              ? html`${icon('circle-check', 'icon--xs pos')} Quitado em ${formatMonthShort(loan.endYM)}`
              : loan.notStarted
                ? `Começa em ${formatMonthShort(line.loan.startYM)}`
                : `Parcela ${loan.n}/${loan.count} · última em ${formatMonthShort(loan.endYM)}`}</small>
          </div>` : ''}
      </div>
      <span class="pline__value money ${computed ? (isAdd ? 'pos' : 'neg') : 'muted'}">${computed ? `${isAdd ? '+' : '−'}${formatBRL(computed.cents)}` : '—'}</span>
      <span class="pline__actions">
        <button type="button" class="icon-btn icon-btn--sm" data-action="sal:edit" data-kind="${kind}" data-id="${line.id}" aria-label="Editar ${line.description}">${icon('pencil')}</button>
        <button type="button" class="icon-btn icon-btn--sm danger" data-action="sal:delete" data-kind="${kind}" data-id="${line.id}" aria-label="Remover ${line.description}">${icon('trash-2')}</button>
      </span>
    </li>`;
}

function shiftsCard(inc, ym) {
  const list = inc.extras;
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('stethoscope')} Plantões e extras</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="sal:shift">${icon('plus', 'icon--xs')} Lançar</button>
      </header>
      ${list.length ? html`
        <ul class="mini-list">
          ${list.map((x) => html`
            <li>
              <span>${x.description} <small class="muted">${x.date ? formatDateBR(x.date) : ''}</small>
                ${x.payroll ? html`<span class="badge">na folha</span>` : html`<span class="badge badge--muted">fora da folha</span>`}</span>
              <span class="money">${formatBRL(x.cents)}</span>
            </li>`)}
        </ul>
        <p class="card__total"><span>Somam ao líquido</span><strong class="money pos">+${formatBRL(inc.extrasCents)}</strong></p>`
      : html`<p class="muted small">Nenhum plantão em ${formatMonth(ym)}. Os lançados "na folha" entram no bruto e pagam INSS/IR junto com o salário.</p>`}
    </article>`;
}

function historyCard(settings, ym) {
  const list = [...settings.salaryHistory].reverse();
  return html`
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('history')} Histórico de salário</h2></header>
      <ul class="mini-list">
        ${list.map((h) => {
          // só a parte fixa (sem variáveis do mês) para comparar as versões do salário
          const p = computePayroll(h, h.from, { loans: settings.payrollLoans || [], employment: employmentOf(settings) });
          return html`
            <li class="${h.from === payrollProfileFor(settings, ym)?.from ? 'is-current' : ''}">
              <span>desde <strong>${formatMonthShort(h.from)}</strong>
                <small class="muted">${h.legacyNet ? 'líquido informado' : `bruto ${formatBRL(p.gross)}`}</small></span>
              <span class="money">${formatBRL(p.net)}</span>
              <span class="mini-list__actions">
                ${list.length > 1 ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="sal:history-del" data-from="${h.from}" aria-label="Remover salário de ${formatMonth(h.from)}">${icon('trash-2')}</button>` : ''}
              </span>
            </li>`;
        })}
      </ul>
      <p class="field__hint">Mudanças valem a partir do mês exibido; meses anteriores mantêm os valores da época.</p>
    </article>`;
}

// ---------- Novos cards ----------

/** Sugere repetir os variáveis do mês anterior (ex.: adicional noturno). */
function copyVariablesHint(settings, ym, vars) {
  if (vars.length) return '';
  const prev = variableFor(settings, addMonthsYM(ym, -1));
  if (!prev.length) return '';
  return html`
    <div class="banner" role="note">
      ${icon('repeat')}
      <p>${formatMonthShort(addMonthsYM(ym, -1))} teve ${plural(prev.length, 'lançamento variável', 'lançamentos variáveis')} (${prev.map((x) => x.description).join(', ')}). Quer repetir neste mês e ajustar os valores?</p>
      <button type="button" class="btn btn--secondary btn--sm" data-action="sal:copy-vars">Repetir em ${formatMonthShort(ym)}</button>
    </div>`;
}

/** Conferência: líquido estimado × líquido real do holerite. */
function checkCard(inc, ym) {
  const diff = inc.actual != null ? inc.actual - inc.estimatedNet : null;
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('circle-check')} Conferir com o holerite</h2>
      </header>
      ${inc.actual == null ? html`
        <p class="muted small">Quando o salário cair, informe o líquido real. O app passa a usá-lo na renda do mês e mostra a diferença para a estimativa.</p>
        <button type="button" class="btn btn--secondary btn--sm" data-action="sal:actual">${icon('pencil', 'icon--xs')} Informar líquido recebido</button>`
      : html`
        <dl class="kv kv--stack">
          <div><span>Estimado</span><strong class="money">${formatBRL(inc.estimatedNet)}</strong></div>
          <div><span>Recebido</span><strong class="money">${formatBRL(inc.actual)}</strong></div>
          <div><span>Diferença</span><strong class="money ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${formatBRL(Math.abs(diff))}</strong></div>
        </dl>
        <div class="card__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="sal:actual">${icon('pencil', 'icon--xs')} Alterar</button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="sal:actual-clear">Usar estimativa</button>
        </div>
        ${Math.abs(diff) > 2000 ? html`<p class="field__hint">Diferença grande? Confira adicionais variáveis, faltas, plantões e descontos do mês.</p>` : ''}`}
    </article>`;
}

/** Previsão do 13º do ano do mês exibido. */
function thirteenthCard(settings, ym) {
  const emp = employmentOf(settings);
  if (!emp.thirteenth) return '';
  const year = ym.slice(0, 4);
  const nov = thirteenthFor(settings, `${year}-11`);
  const dec = thirteenthFor(settings, `${year}-12`);
  if (!nov && !dec) return '';
  const ref = dec || nov;
  return html`
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('sparkles')} 13º salário de ${year}</h2></header>
      <p class="big-number money">${formatBRL((nov?.net || 0) + (dec?.net || 0))}</p>
      <p class="muted small">líquido estimado · ${ref.avos}/12 avos · bruto ${formatBRL(ref.gross)}</p>
      <ul class="mini-list">
        ${nov ? html`<li><span>1ª parcela <small class="muted">até 30/11 · sem descontos</small></span><span class="money pos">${formatBRL(nov.net)}</span></li>` : ''}
        ${dec ? html`<li><span>2ª parcela <small class="muted">até 20/12 · com ${employmentOf(settings).regime === 'fixed' ? 'previdência' : 'INSS'} e IR</small></span><span class="money pos">${formatBRL(dec.net)}</span></li>` : ''}
      </ul>
      ${emp.admission ? '' : html`<p class="field__hint">Informe a data de admissão (em "Editar" do salário base) para o 13º proporcional do primeiro ano.</p>`}
    </article>`;
}


// ---------- Férias ----------

function vacationCard(settings, ym) {
  const list = settings.vacations || [];
  const v = vacationFor(settings, ym);
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('tree-palm')} Férias</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="vac:new">${icon('plus', 'icon--xs')} Planejar</button>
      </header>
      ${v ? html`
        <div class="preview-box">
          <p class="small muted">Em ${formatMonth(ym)}: ${v.days} dias de descanso${v.sellDays ? ` + ${v.sellDays} vendidos` : ''}</p>
          <p class="big-number money pos">+${formatBRL(v.net)}</p>
          <ul class="mini-list">
            <li><span>Férias (${v.days} dias)</span><span class="money">${formatBRL(v.pay)}</span></li>
            <li><span>1/3 constitucional</span><span class="money">${formatBRL(v.third)}</span></li>
            ${v.abono ? html`<li><span>Abono (dias vendidos + 1/3) <small class="muted">isento</small></span><span class="money">${formatBRL(v.abono)}</span></li>` : ''}
            ${v.advance13Cents ? html`<li><span>Adiantamento do 13º</span><span class="money">${formatBRL(v.advance13Cents)}</span></li>` : ''}
            <li><span>INSS + IR sobre férias</span><span class="money neg">−${formatBRL(v.inss + v.ir)}</span></li>
          </ul>
          <p class="field__hint">Pago até 2 dias antes do início. O salário do mês cai proporcional aos dias trabalhados.</p>
        </div>` : ''}
      ${list.length ? html`
        <ul class="plines">
          ${list.map((x) => html`
            <li class="vacation">
              <span class="vacation__icon" aria-hidden="true">${icon('tree-palm')}</span>
              <span class="vacation__main"><strong>${formatDateBR(x.start)} · ${x.days} dias</strong>
                <small>${[x.sellDays ? `${x.sellDays} dias vendidos` : '', x.advance13 ? 'com 1ª parcela do 13º' : '', `volta em ${formatDateBR(addDaysISO(x.start, x.days))}`].filter(Boolean).join(' · ')}</small></span>
              <span class="pline__actions">
                <button type="button" class="icon-btn icon-btn--sm" data-action="vac:edit" data-id="${x.id}" aria-label="Editar férias de ${formatDateBR(x.start)}">${icon('pencil')}</button>
                <button type="button" class="icon-btn icon-btn--sm danger" data-action="vac:delete" data-id="${x.id}" aria-label="Remover férias de ${formatDateBR(x.start)}">${icon('trash-2')}</button>
              </span>
            </li>`)}
        </ul>` : html`<p class="muted small">Planeje as férias e veja quanto vai receber (férias + 1/3, abono e adiantamento do 13º) e como fica o salário do mês.</p>`}
    </article>`;
}

function vacationDialog(v) {
  const s = store.data.settings;
  const init = v || { start: addDaysISO(todayISO(), 30), days: 30, sellDays: 0, advance13: false };
  openDialog({
    title: v ? 'Editar férias' : 'Planejar férias',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${dateField({ label: 'Primeiro dia de férias', name: 'start', value: init.start })}
        ${numberField({ label: 'Dias de descanso', name: 'days', value: init.days, min: 5, max: 30, hint: 'Até 3 períodos; um com 14+ dias.' })}
        ${numberField({ label: 'Dias vendidos (abono)', name: 'sellDays', value: init.sellDays, min: 0, max: 10, required: false, hint: 'Até 1/3 das férias (10 dias).' })}
        ${switchField({ label: 'Adiantar a 1ª parcela do 13º', name: 'advance13', checked: init.advance13, hint: 'Peça até janeiro; sai junto com as férias.' })}
      </div>
      <div class="preview" data-preview aria-live="polite"></div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const update = () => {
        const start = form.start.value;
        const box = dlg.querySelector('[data-preview]');
        if (!start) { box.textContent = ''; return; }
        const days = Math.min(30, Math.max(5, Number(form.days.value) || 30));
        const sellDays = Math.min(10, Math.max(0, Number(form.sellDays.value) || 0));
        const temp = { ...s, vacations: [{ id: 'tmp', start, days, sellDays, advance13: form.advance13.checked }] };
        const r = vacationFor(temp, start.slice(0, 7));
        box.innerHTML = r
          ? html`Você recebe cerca de <strong>${formatBRL(r.net)}</strong> líquido
              <span class="muted"> · bruto ${formatBRL(r.gross)} · volta em ${formatDateBR(addDaysISO(start, days))} (${weekdayLong(addDaysISO(start, days))})</span>`.toString()
          : html`<span class="muted">Cadastre o salário bruto para ver a estimativa.</span>`.toString();
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },
    onSubmit: (form) => {
      A.saveVacation({
        id: v?.id,
        start: form.start.value,
        days: Number(form.days.value),
        sellDays: Number(form.sellDays.value || 0),
        advance13: form.advance13.checked,
      });
      toast('Férias salvas.');
    },
  });
}

// ---------- Faltas e afastamentos ----------

const ABSENCE_KIND = {
  atestado: { label: 'Atestado médico', hint: 'a empresa paga até 15 dias', icon: 'stethoscope' },
  inss: { label: 'Afastado pelo INSS', hint: 'dias pagos pelo INSS, fora da folha', icon: 'shield-check' },
  falta: { label: 'Falta', hint: 'dia descontado do salário', icon: 'circle-x' },
};

function absenceCard(settings, ym) {
  const abs = absencesIn(settings, ym);
  return html`
    <article class="card">
      <header class="card__header">
        <h2 class="card__title">${icon('calendar-days')} Faltas e afastamentos</h2>
        <button type="button" class="btn btn--ghost btn--sm" data-action="abs:new">${icon('plus', 'icon--xs')} Lançar</button>
      </header>
      ${abs.list.length ? html`
        <ul class="mini-list">
          ${abs.list.map((a) => html`
            <li>
              <span><strong>${ABSENCE_KIND[a.kind].label}</strong> · ${a.days} ${a.days === 1 ? 'dia' : 'dias'}
                <small class="muted">${a.note ? `${a.note} · ` : ''}${ABSENCE_KIND[a.kind].hint}</small></span>
              <span class="mini-list__actions">
                <button type="button" class="icon-btn icon-btn--sm" data-action="abs:edit" data-id="${a.id}" aria-label="Editar">${icon('pencil')}</button>
                <button type="button" class="icon-btn icon-btn--sm danger" data-action="abs:delete" data-id="${a.id}" aria-label="Remover">${icon('trash-2')}</button>
              </span>
            </li>`)}
        </ul>
        ${abs.inss ? html`<p class="field__hint">${abs.inss} ${abs.inss === 1 ? 'dia pago' : 'dias pagos'} pelo INSS (a partir do 16º dia de atestado): o salário do mês cai na mesma proporção.</p>` : ''}`
      : html`<p class="muted small">Atestados, afastamentos e faltas de ${formatMonth(ym)} mudam o salário do mês. O holerite separa "dias trabalhados" e "atestado".</p>`}
    </article>`;
}

function absenceDialog(ym, a) {
  openDialog({
    title: a ? 'Editar afastamento' : `Falta ou afastamento em ${formatMonth(ym)}`,
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        <div class="field--full">${segmentedField({ label: 'Tipo', name: 'kind', value: a?.kind || 'atestado', options: Object.entries(ABSENCE_KIND).map(([value, k]) => ({ value, label: k.label })) })}</div>
        ${numberField({ label: 'Dias no mês', name: 'days', value: a?.days || '', min: 1, max: 30, hint: 'Atestado: os primeiros 15 dias são pagos pela empresa; do 16º em diante, pelo INSS.' })}
        ${field({ label: 'Observação (opcional)', name: 'note', value: a?.note || '', placeholder: 'Ex.: CID, motivo', extra: { maxlength: 80, autocomplete: 'off' } })}
      </div>`,
    onSubmit: (form) => {
      A.saveAbsence({ id: a?.id, ym, kind: form.querySelector('[name="kind"]:checked').value, days: Number(form.days.value), note: form.note.value });
      toast('Salvo. O contracheque foi recalculado.');
    },
  });
}
