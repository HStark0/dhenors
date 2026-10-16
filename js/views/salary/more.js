// =============================================================
// Salário → IR anual · Rescisão e FGTS · Benefícios e vínculos ·
// Carreira · Tabelas
// =============================================================

import { html } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { lineChart, chartWidth } from '../../ui/charts.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { helpTip } from '../../ui/help.js';
import { field, moneyField, dateField, numberField, selectField, switchField, readForm } from '../../ui/forms.js';
import * as E from '../../ui/editors.js';
import { store } from '../../core/store.js';
import { formatBRL, toCents } from '../../core/money.js';
import { todayISO, formatDateBR, formatMonth, formatMonthShort, currentYM, ymOf } from '../../core/dates.js';
import { payrollProfileFor, computePayroll, employmentOf } from '../../domain/payroll.js';
import { irpfForecast, IRPF_LIMITS } from '../../domain/irpf.js';
import { simulateTermination, fgtsSeries, REASONS } from '../../domain/termination.js';
import { BENEFIT_LABELS, JOB_KIND_LABELS, jobsIn, benefitsIn, PLR_TABLE } from '../../domain/benefits.js';
import { careerTimeline, careerSummary } from '../../domain/career.js';
import { tablesFor, TAX_TABLES, missingTaxYears, latestTaxYear } from '../../domain/taxTables.js';
import * as A from '../../domain/actions.js';

const pct = (f) => `${f >= 0 ? '+' : ''}${(f * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

// ---------- IR anual ----------

export function renderIrpf() {
  const d = store.data;
  const year = Number(store.ui.filters.irYear || currentYM().slice(0, 4));
  const r = irpfForecast(d, year, todayISO());
  const ded = r.deductions;
  return html`
    <div class="page-head">
      <p class="muted">Ano-calendário <strong>${year}</strong>${r.partial ? ' (parcial: meses futuros pelo salário cadastrado)' : ''} · declaração em ${year + 1}</p>
      <div class="segmented" role="group" aria-label="Ano">
        ${[year - 1, year, year + 1].map((y) => html`<button type="button" class="segmented__btn" data-action="ir:year" data-year="${y}" aria-pressed="${y === year}">${y}</button>`)}
      </div>
    </div>
    <section class="grid grid--hero">
      <article class="card hero ${r.result > 0 ? 'hero--negative' : 'tone-good'}">
        <p class="hero__label">${r.result > 0 ? 'Imposto a pagar (estimado)' : 'Restituição estimada'}</p>
        <p class="hero__value money">${formatBRL(Math.abs(r.result))}</p>
        <p class="hero__formula"><span>Imposto devido ${formatBRL(r.due)}</span><span aria-hidden="true">−</span><span>já retido na fonte ${formatBRL(r.withheld)}</span></p>
        <p class="hero__meter-label">Melhor modelo: <strong>${r.model}</strong> (deduções legais ${formatBRL(r.legal)} × desconto simplificado ${formatBRL(r.simplified)})</p>
      </article>
      <article class="card">
        <h2 class="card__title">${icon('receipt-text')} Como chegamos lá</h2>
        <dl class="kv kv--stack">
          <div><span>Rendimentos tributáveis</span><strong class="money">${formatBRL(r.taxable)}</strong></div>
          <div><span>Base de cálculo</span><strong class="money">${formatBRL(r.base)}</strong></div>
          <div><span>Imposto pela tabela anual</span><strong class="money">${formatBRL(r.tax)}</strong></div>
          ${r.reduction ? html`<div><span>Redução (Lei 15.270)</span><strong class="money pos">−${formatBRL(r.reduction)}</strong></div>` : ''}
          <div><span>13º (tributação exclusiva)</span><strong class="money muted">${formatBRL(r.exclusive.thirteenthNet)} líquido</strong></div>
          ${r.exclusive.plrGross ? html`<div><span>PLR (exclusiva)</span><strong class="money muted">${formatBRL(r.exclusive.plrGross)}</strong></div>` : ''}
        </dl>
      </article>
    </section>
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('scale')} Deduções</h2><button type="button" class="btn btn--ghost btn--sm" data-action="ir:edit">${icon('pencil', 'icon--xs')} Informar outras</button></header>
      <ul class="mini-list">
        <li><span>INSS / previdência</span><span class="money">${formatBRL(ded.inss)}</span></li>
        <li><span>Dependentes <small class="muted">${formatBRL(IRPF_LIMITS.dependent)} cada</small></span><span class="money">${formatBRL(ded.dependents)}</span></li>
        <li><span>Despesas médicas <small class="muted">plano na folha + gastos de Saúde pagos no ano</small></span><span class="money">${formatBRL(ded.medical)}</span></li>
        <li><span>Educação <small class="muted">limite ${formatBRL(IRPF_LIMITS.education)} por pessoa</small></span><span class="money">${formatBRL(ded.education)}</span></li>
        <li><span>PGBL <small class="muted">até 12% da renda (investimentos marcados como PGBL)</small></span><span class="money">${formatBRL(ded.pgbl)}</span></li>
        ${ded.pension ? html`<li><span>Pensão alimentícia</span><span class="money">${formatBRL(ded.pension)}</span></li>` : ''}
        ${ded.other ? html`<li><span>Outras</span><span class="money">${formatBRL(ded.other)}</span></li>` : ''}
      </ul>
      <p class="field__hint">Estimativa com o que o app sabe. Para despesas médicas entrarem, lance consultas, exames, dentista e terapias na categoria <strong>Saúde</strong>. Confira no programa da Receita antes de declarar.</p>
    </article>`;
}

function irpfDialog() {
  const s = store.data.settings.irpf || {};
  openDialog({
    title: 'Outras deduções do IR',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${moneyField({ label: 'Educação (escola, faculdade) no ano', name: 'edu', cents: s.educationCents, required: false })}
        ${moneyField({ label: 'Pensão alimentícia paga no ano', name: 'pension', cents: s.pensionCents, required: false })}
        ${moneyField({ label: 'Outras deduções', name: 'other', cents: s.otherDeductibleCents, required: false, hint: 'Ex.: despesas médicas pagas fora do app.' })}
      </div>`,
    onSubmit: (form) => {
      A.saveIrpfSettings({ educationCents: toCents(form.edu.value) || 0, pensionCents: toCents(form.pension.value) || 0, otherDeductibleCents: toCents(form.other.value) || 0 });
      toast('Deduções salvas.');
    },
  });
}

// ---------- Rescisão e FGTS ----------

export function renderExit() {
  const d = store.data;
  const s = d.settings;
  const emp = employmentOf(s);
  const prof = payrollProfileFor(s, currentYM());
  const fixed = prof && !prof.legacyNet ? computePayroll(prof, currentYM(), { employment: emp }) : null;
  const salary = fixed ? fixed.base + fixed.additions.filter((a) => a.taxable && !a.variable).reduce((a, x) => a + x.cents, 0) : 0;
  const series = fgtsSeries(d, currentYM());
  const fgts = series.length ? series[series.length - 1].balance : 0;
  const f = { reason: 'sem_justa', lastDay: todayISO(), vacationsDueDays: 0, noticeServed: false, ...(store.ui.filters.exit || {}) };
  const r = salary ? simulateTermination({ ...f, admission: emp.admission, salaryCents: salary, fgtsCents: fgts }) : null;
  return html`
    <section class="grid grid--two">
      <article class="card">
        <h2 class="card__title">${icon('briefcase')} Simular rescisão ${helpTip('rescisao')}</h2>
        ${!salary ? html`<p class="muted">Cadastre o salário (CLT) para simular.</p>` : html`
          <div class="form-grid">
            <div class="field"><label class="field__label" for="exit-reason">Tipo de saída</label>
              <select class="input select" id="exit-reason" data-filter="exit:reason">${Object.entries(REASONS).map(([value, x]) => html`<option value="${value}" ${value === f.reason ? 'selected' : ''}>${x.label}</option>`)}</select></div>
            <div class="field"><label class="field__label" for="exit-last">Último dia de trabalho</label><input class="input" type="date" id="exit-last" data-filter="exit:lastDay" value="${f.lastDay}"></div>
            <div class="field"><label class="field__label" for="exit-vac">Férias vencidas (não tiradas)</label>
              <select class="input select" id="exit-vac" data-filter="exit:vacationsDueDays">${[['0', 'Nenhuma'], ['30', '1 período (30 dias)'], ['60', '2 períodos']].map(([v, l]) => html`<option value="${v}" ${v === String(f.vacationsDueDays) ? 'selected' : ''}>${l}</option>`)}</select></div>
            <div class="field"><label class="check"><input type="checkbox" data-filter="exit:noticeServed" ${f.noticeServed ? 'checked' : ''}> Vou cumprir o aviso prévio trabalhando</label></div>
          </div>
          ${emp.admission ? '' : html`<p class="field__hint state--warn">Informe a data de admissão (Salário → Editar) para o cálculo de férias, 13º e aviso.</p>`}
          <ul class="mini-list">
            ${r.lines.map((l) => html`<li><span>${l.label}${l.taxable ? html` <small class="muted">INSS/IR</small>` : ''}</span><span class="money">${formatBRL(l.cents)}</span></li>`)}
            <li><span>− INSS e IR</span><span class="money neg">−${formatBRL(r.inss + r.ir)}</span></li>
          </ul>
          <p class="card__total"><span>Rescisão líquida</span><strong class="money">${formatBRL(r.net)}</strong></p>
          ${r.fgts.fine || r.fgts.withdraw ? html`
            <dl class="kv kv--stack">
              ${r.fgts.fine ? html`<div><span>Multa do FGTS (${Math.round(r.reason.fine * 100)}%)</span><strong class="money">${formatBRL(r.fgts.fine)}</strong></div>` : ''}
              ${r.fgts.withdraw ? html`<div><span>Saque do FGTS (${Math.round(r.reason.withdraw * 100)}%)</span><strong class="money">${formatBRL(r.fgts.withdraw)}</strong></div>` : ''}
              <div><span><strong>Total que você recebe</strong></span><strong class="money pos">${formatBRL(r.total)}</strong></div>
            </dl>` : html`<p class="muted small">Neste tipo de saída, o FGTS fica na conta (não há saque nem multa).</p>`}
          ${r.notes.map((n) => html`<p class="field__hint">${n}</p>`)}`}
      </article>
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('piggy-bank')} FGTS estimado ${helpTip('fgts')}</h2><button type="button" class="btn btn--ghost btn--sm" data-action="fgts:edit">${icon('pencil', 'icon--xs')} Informar saldo</button></header>
        ${emp.regime !== 'inss' ? html`<p class="muted">Servidores (regime próprio) não têm FGTS.</p>`
          : series.length ? html`
            <p class="big-number money">${formatBRL(fgts)}</p>
            <p class="muted small">${s.fgts?.date ? `A partir do saldo de ${formatBRL(s.fgts.balanceCents)} em ${formatDateBR(s.fgts.date)}` : `Estimado desde a admissão (${formatDateBR(emp.admission)})`}, somando 8% do bruto por mês e 3% ao ano.</p>
            ${lineChart(series.slice(-24).map((x) => formatMonthShort(x.ym)), [{ name: 'Saldo', values: series.slice(-24).map((x) => x.balance), className: 'is-balance' }], { label: 'FGTS estimado mês a mês', height: 180, width: chartWidth(0.5), area: true })}
            <p class="field__hint">Confira o saldo real no app FGTS (Caixa) e atualize aqui de vez em quando.</p>`
          : html`<p class="muted">Informe a data de admissão ou o saldo atual do FGTS (app FGTS da Caixa).</p>`}
      </article>
    </section>`;
}

function fgtsDialog() {
  const s = store.data.settings.fgts || {};
  openDialog({
    title: 'Saldo do FGTS',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Veja no app FGTS (Caixa) e informe o saldo somado de todas as contas deste emprego.</p>
      ${moneyField({ label: 'Saldo', name: 'cents', cents: s.balanceCents })}
      ${dateField({ label: 'Data', name: 'date', value: s.date || todayISO() })}`,
    onSubmit: (form) => { A.saveFgts({ balanceCents: toCents(form.cents.value), date: form.date.value }); toast('Saldo do FGTS salvo.'); },
  });
}

// ---------- Benefícios e outros vínculos ----------

export function renderBenefits() {
  const d = store.data;
  const ym = store.ui.ym;
  const b = benefitsIn(d.settings, ym);
  const jobs = jobsIn(d.settings, ym);
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return html`
    <section class="grid grid--two">
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('gift')} Benefícios</h2><button type="button" class="btn btn--secondary btn--sm" data-action="ben:new">${icon('plus', 'icon--xs')} Benefício</button></header>
        ${(d.settings.benefits || []).length ? html`
          <ul class="plines">
            ${d.settings.benefits.map((x) => html`
              <li class="pline">
                <span class="pline__icon is-add" aria-hidden="true">${icon(x.kind === 'va' || x.kind === 'vr' ? 'utensils' : x.kind === 'plr' ? 'trending-up' : 'gift')}</span>
                <div class="pline__main"><strong>${x.name}</strong><small>${BENEFIT_LABELS[x.kind]} · ${x.kind === 'va' || x.kind === 'vr' ? 'todo mês, no cartão do benefício' : x.monthly ? 'todo mês' : `em ${MONTHS[(x.month || 1) - 1]}${x.year ? `/${x.year}` : ' (todo ano)'}`}</small></div>
                <span class="pline__value money">${formatBRL(x.cents)}</span>
                <span class="pline__actions">
                  <button type="button" class="icon-btn icon-btn--sm" data-action="ben:edit" data-id="${x.id}" aria-label="Editar ${x.name}">${icon('pencil')}</button>
                  <button type="button" class="icon-btn icon-btn--sm danger" data-action="ben:delete" data-id="${x.id}" aria-label="Remover ${x.name}">${icon('trash-2')}</button>
                </span>
              </li>`)}
          </ul>
          <p class="small muted">Em ${formatMonth(ym)}: ${b.cash.length ? b.cash.map((c) => `${c.name} ${formatBRL(c.net)} líquido${c.tax ? ` (IR ${formatBRL(c.tax)})` : ''}`).join(' · ') : 'nenhum benefício em dinheiro'}${b.cardTotal ? ` · ${formatBRL(b.cardTotal)} no cartão (VA/VR)` : ''}.</p>
          <p class="field__hint">VA/VR ficam no cartão do benefício (não somam ao saldo do mês). PLR tem IR exclusivo pela tabela própria ${helpTip('plr')}.</p>`
        : html`<p class="muted small">Vale-alimentação, vale-refeição, PLR, abono salarial (PIS) e outros benefícios, separados do salário.</p>`}
      </article>
      <article class="card">
        <header class="card__header"><h2 class="card__title">${icon('briefcase')} Outros vínculos</h2><button type="button" class="btn btn--secondary btn--sm" data-action="job:new">${icon('plus', 'icon--xs')} Vínculo</button></header>
        ${(d.settings.jobs || []).length ? html`
          <ul class="plines">
            ${d.settings.jobs.map((j) => {
              const r = jobs.list.find((x) => x.job.id === j.id);
              return html`
                <li class="pline">
                  <span class="pline__icon is-add" aria-hidden="true">${icon('building-2')}</span>
                  <div class="pline__main"><strong>${j.name}</strong><small>${JOB_KIND_LABELS[j.kind]} · bruto ${formatBRL(j.grossCents)} · dia ${j.day}${r ? '' : ' · fora do período'}${r?.note ? ` · ${r.note}` : ''}</small></div>
                  <span class="pline__value money pos">${r ? `+${formatBRL(r.net)}` : '—'}</span>
                  <span class="pline__actions">
                    <button type="button" class="icon-btn icon-btn--sm" data-action="job:edit" data-id="${j.id}" aria-label="Editar ${j.name}">${icon('pencil')}</button>
                    <button type="button" class="icon-btn icon-btn--sm danger" data-action="job:delete" data-id="${j.id}" aria-label="Remover ${j.name}">${icon('trash-2')}</button>
                  </span>
                </li>`;
            })}
          </ul>
          ${jobs.overCeiling ? html`<p class="note note--warn">${icon('info')}<span>A soma dos salários CLT passa do teto do INSS: você pode estar pagando INSS a mais. Peça às empresas o desconto proporcional ou a restituição.</span></p>` : ''}`
        : html`<p class="muted small">Segundo emprego, CLT + PJ, servidor + plantão em outro hospital: cada vínculo calcula o próprio líquido e soma na renda do mês.</p>`}
      </article>
    </section>`;
}

function benefitDialog(b = null) {
  const x = b || { kind: 'va', name: 'Vale-alimentação', cents: null, month: 3, monthly: true };
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  openDialog({
    title: b ? 'Editar benefício' : 'Novo benefício',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${selectField({ label: 'Tipo', name: 'kind', value: x.kind, options: Object.entries(BENEFIT_LABELS).map(([value, label]) => ({ value, label })) })}
        ${field({ label: 'Nome', name: 'name', value: x.name, required: true, extra: { maxlength: 60 } })}
        ${moneyField({ label: 'Valor', name: 'cents', cents: x.cents, hint: 'PLR: valor bruto (o IR exclusivo é calculado).' })}
        <div data-when>
          ${switchField({ label: 'Todo mês', name: 'monthly', checked: x.monthly })}
          ${selectField({ label: 'Mês em que cai', name: 'month', value: x.month || 3, options: MONTHS.map((m, i) => ({ value: i + 1, label: m })) })}
          ${numberField({ label: 'Ano (vazio = todo ano)', name: 'year', value: x.year || '', min: 2000, max: 2100, required: false })}
        </div>
      </div>
      <p class="field__hint">Tabela da PLR: isenta até ${formatBRL(Math.round(PLR_TABLE[0][0] * 100))}.</p>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => { dlg.querySelector('[data-when]').hidden = ['va', 'vr'].includes(form.kind.value); };
      form.kind.addEventListener('change', () => { sync(); form.name.value = BENEFIT_LABELS[form.kind.value]; });
      sync();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveBenefit({ ...v, id: b?.id, cents: toCents(v.cents), month: Number(v.month), year: v.year ? Number(v.year) : null });
      toast('Benefício salvo.');
    },
  });
}

function jobDialog(j = null) {
  const x = j || { name: '', kind: 'clt', grossCents: null, day: 5, pjTaxBp: 600, fixedRateBp: 1400 };
  openDialog({
    title: j ? 'Editar vínculo' : 'Novo vínculo',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: x.name, required: true, placeholder: 'Ex.: Hospital B, Clínica', extra: { maxlength: 60 } })}
        ${selectField({ label: 'Tipo', name: 'kind', value: x.kind, options: Object.entries(JOB_KIND_LABELS).map(([value, label]) => ({ value, label })) })}
        ${moneyField({ label: 'Bruto por mês', name: 'grossCents', cents: x.grossCents })}
        ${numberField({ label: 'Dia do pagamento', name: 'day', value: x.day, min: 1, max: 31 })}
        <div data-pj>${field({ label: 'Impostos da empresa (%)', name: 'pjTax', value: (x.pjTaxBp / 100).toLocaleString('pt-BR'), extra: { inputmode: 'decimal' }, hint: 'Ex.: Simples Nacional 6%.' })}</div>
        <div data-rpps>${field({ label: 'Alíquota da previdência (%)', name: 'rate', value: (x.fixedRateBp / 100).toLocaleString('pt-BR'), extra: { inputmode: 'decimal' } })}</div>
        <div class="field"><label class="field__label" for="job-from">Desde (opcional)</label><input class="input" type="month" id="job-from" name="from" value="${x.from || ''}"></div>
        <div class="field"><label class="field__label" for="job-to">Até (opcional)</label><input class="input" type="month" id="job-to" name="to" value="${x.to || ''}"></div>
      </div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => { dlg.querySelector('[data-pj]').hidden = form.kind.value !== 'pj'; dlg.querySelector('[data-rpps]').hidden = form.kind.value !== 'servidor'; };
      form.kind.addEventListener('change', sync);
      sync();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const bp = (t) => Math.round(parseFloat(String(t || '0').replace(',', '.')) * 100) || 0;
      A.saveJob({ ...v, id: j?.id, grossCents: toCents(v.grossCents), day: Number(v.day), pjTaxBp: bp(v.pjTax), fixedRateBp: bp(v.rate), from: v.from || null, to: v.to || null });
      toast('Vínculo salvo.');
    },
  });
}

// ---------- Carreira ----------

export function renderCareer() {
  const d = store.data;
  const t = careerTimeline(d.settings);
  const sum = careerSummary(d.settings, currentYM());
  if (!t.length) return html`<div class="card empty">${icon('trending-up', 'icon--lg')}<p><strong>Sem histórico de salário ainda.</strong></p><p class="muted">Cada vez que você cadastra um reajuste ou promoção (Salário → Editar "a partir de"), ele aparece aqui com o ganho real.</p></div>`;
  return html`
    ${sum ? html`
      <section class="grid grid--kpis grid--kpis-3">
        <article class="card kpi"><div class="kpi__body"><p class="kpi__label">Ganho nominal</p><p class="kpi__value">${pct(sum.nominal)}</p><p class="kpi__sub">desde ${formatMonthShort(sum.first.from)}</p></div></article>
        <article class="card kpi"><div class="kpi__body"><p class="kpi__label">Inflação (IPCA)</p><p class="kpi__value">${pct(sum.inflation)}</p><p class="kpi__sub">${sum.estimated ? 'parte estimada' : 'IPCA do Banco Central'}</p></div></article>
        <article class="card kpi kpi--${sum.real >= 0 ? 'good' : 'bad'}"><div class="kpi__body"><p class="kpi__label">Ganho REAL</p><p class="kpi__value">${pct(sum.real)}</p><p class="kpi__sub">${sum.real >= 0 ? 'seu salário compra mais' : 'seu salário compra menos'}</p></div></article>
      </section>` : ''}
    <article class="card">
      <h2 class="card__title">${icon('trending-up')} Linha do tempo</h2>
      ${lineChart(t.map((x) => formatMonthShort(x.from)), [
        { name: 'Bruto', values: t.map((x) => x.gross), className: 'is-income' },
        { name: 'Líquido fixo', values: t.map((x) => x.net), className: 'is-balance' },
      ], { label: 'Evolução do salário', width: chartWidth(1) })}
      <ol class="timeline">
        ${[...t].reverse().map((x) => html`
          <li>
            <strong>${formatMonth(x.from)}</strong> · bruto ${formatBRL(x.gross)} → líquido ${formatBRL(x.net)}${x.note ? html` · <em>${x.note}</em>` : ''}
            ${x.change != null ? html`<small class="${x.realChange >= 0 ? 'pos' : 'neg'}">${pct(x.change)} nominal · ${pct(x.realChange)} real (inflação ${pct(x.inflation)}${x.estimated ? ', estimada' : ''})</small>` : html`<small class="muted">primeiro registro</small>`}
          </li>`)}
      </ol>
      <p class="field__hint">Para guardar o motivo (promoção, reajuste do sindicato), escreva no campo "Motivo" ao editar o salário.</p>
    </article>`;
}

// ---------- Tabelas de INSS/IR ----------

export function renderTables() {
  const d = store.data;
  const y = Number(currentYM().slice(0, 4));
  const missing = missingTaxYears(y, y + 1);
  const custom = d.settings.taxTables || {};
  const years = [...new Set([...Object.keys(TAX_TABLES), ...Object.keys(custom)])].sort().reverse();
  return html`
    ${missing.includes(y) ? html`<div class="banner banner--warn">${icon('triangle-alert')}<p><strong>Tabelas de ${y} ainda não disponíveis no app.</strong> Os cálculos usam as de ${latestTaxYear()}.</p><button type="button" class="btn btn--secondary btn--sm" data-action="tax:new" data-year="${y}">Cadastrar ${y}</button></div>` : ''}
    <article class="card">
      <header class="card__header"><h2 class="card__title">${icon('table')} Tabelas de INSS e IR</h2><button type="button" class="btn btn--secondary btn--sm" data-action="tax:new" data-year="${latestTaxYear() + 1}">${icon('plus', 'icon--xs')} Ano novo</button></header>
      <ul class="rows">
        ${years.map((yy) => {
          const t = tablesFor(Number(yy));
          return html`
            <li class="row">
              <div class="row__main"><span><strong>${yy}</strong> ${custom[yy] ? html`<span class="badge badge--info">sua</span>` : html`<span class="badge badge--muted">oficial do app</span>`}
                <small class="muted">mínimo ${formatBRL(Math.round(t.minimumWage * 100))} · teto INSS ${formatBRL(Math.round(t.inss[t.inss.length - 1][0] * 100))} · isenção IR até ${formatBRL(Math.round(t.irrf[0][0] * 100))}${t.reduction ? ' · com redução da Lei 15.270' : ''}</small></span></div>
              <span class="row__actions">
                <button type="button" class="btn btn--ghost btn--sm" data-action="tax:new" data-year="${yy}" data-from="${yy}">${custom[yy] ? 'Editar' : 'Copiar'}</button>
                ${custom[yy] ? html`<button type="button" class="icon-btn danger" data-action="tax:delete" data-year="${yy}" aria-label="Remover a tabela ${yy}">${icon('trash-2')}</button>` : ''}
              </span>
            </li>`;
        })}
      </ul>
      <p class="field__hint">Todo começo de ano o governo publica o novo salário mínimo, as faixas do INSS e (às vezes) do IR. O app avisa quando o ano não tem tabela. Você pode cadastrar a sua enquanto a atualização não chega — vale só nos seus dados.</p>
    </article>`;
}

function taxDialog(year, fromYear) {
  const base = tablesFor(Number(fromYear || latestTaxYear()));
  const num = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const parse = (v) => Number(String(v).replace(/\./g, '').replace(',', '.'));
  openDialog({
    title: `Tabelas de ${year}`,
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Valores em reais, como publicados. Comece pelos de ${base.year} e troque o que mudou.</p>
      <div class="form-grid">
        ${field({ label: 'Salário mínimo', name: 'min', value: num(base.minimumWage), extra: { inputmode: 'decimal' } })}
        ${field({ label: 'Dedução por dependente (IR)', name: 'dep', value: num(base.dependent), extra: { inputmode: 'decimal' } })}
        ${field({ label: 'Desconto simplificado mensal', name: 'simp', value: num(base.simplified), extra: { inputmode: 'decimal' } })}
      </div>
      <h3 class="dialog__subtitle">INSS (faixa até · alíquota %)</h3>
      <div class="form-grid">${base.inss.map((r, i) => html`
        ${field({ label: `Faixa ${i + 1} até`, name: `inssU${i}`, value: num(r[0]), extra: { inputmode: 'decimal' } })}
        ${field({ label: 'Alíquota %', name: `inssR${i}`, value: num(r[1] * 100), extra: { inputmode: 'decimal' } })}`)}</div>
      <h3 class="dialog__subtitle">IR mensal (base até · alíquota % · parcela a deduzir)</h3>
      <div class="form-grid form-grid--3">${base.irrf.map((r, i) => html`
        ${field({ label: `Faixa ${i + 1} até`, name: `irU${i}`, value: Number.isFinite(r[0]) ? num(r[0]) : 'acima', extra: { inputmode: 'decimal' } })}
        ${field({ label: 'Alíquota %', name: `irR${i}`, value: num(r[1] * 100), extra: { inputmode: 'decimal' } })}
        ${field({ label: 'Deduzir', name: `irD${i}`, value: num(r[2]), extra: { inputmode: 'decimal' } })}`)}</div>`,
    onSubmit: (form) => {
      A.saveTaxTable(Number(year), {
        minimumWage: parse(form.min.value), dependent: parse(form.dep.value), simplified: parse(form.simp.value),
        inss: base.inss.map((_, i) => [parse(form[`inssU${i}`].value), parse(form[`inssR${i}`].value) / 100]),
        irrf: base.irrf.map((_, i) => [i === base.irrf.length - 1 ? null : parse(form[`irU${i}`].value), parse(form[`irR${i}`].value) / 100, parse(form[`irD${i}`].value)]),
        family: base.family, reduction: base.reduction,
      });
      toast(`Tabelas de ${year} salvas.`);
    },
  });
}

export const moreSalaryActions = {
  'ir:year': (el) => store.setUI({ filters: { ...store.ui.filters, irYear: Number(el.dataset.year) } }),
  'ir:edit': () => irpfDialog(),
  'fgts:edit': () => fgtsDialog(),
  'ben:new': () => benefitDialog(),
  'ben:edit': (el) => benefitDialog(store.data.settings.benefits.find((x) => x.id === el.dataset.id)),
  'ben:delete': (el) => E.deleteWithUndo(() => A.deleteBenefit(el.dataset.id), 'Benefício removido.'),
  'job:new': () => jobDialog(),
  'job:edit': (el) => jobDialog(store.data.settings.jobs.find((x) => x.id === el.dataset.id)),
  'job:delete': (el) => E.deleteWithUndo(() => A.deleteJob(el.dataset.id), 'Vínculo removido.'),
  'tax:new': (el) => taxDialog(el.dataset.year, el.dataset.from),
  'tax:delete': (el) => E.deleteWithUndo(() => A.deleteTaxTable(el.dataset.year), 'Tabela removida.'),
};

/** Filtros da simulação de rescisão (campos com data-filter="exit:…"). */
export function onExitFilter(name, value, el) {
  const key = name.split(':')[1];
  const cur = store.ui.filters.exit || {};
  const v = el.type === 'checkbox' ? el.checked : key === 'vacationsDueDays' ? Number(value) : value;
  if (key === 'lastDay' && !value) return;
  store.setUI({ filters: { ...store.ui.filters, exit: { ...cur, [key]: v } } });
}

/** Ano de referência do FGTS (exportado para testes de tela). */
export const fgtsYear = () => ymOf(todayISO()).slice(0, 4);
