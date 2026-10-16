// =============================================================
// payslipImport.js — Importar holerite (PDF ou texto colado)
// -------------------------------------------------------------
// 1. Escolha o PDF do holerite (ou cole o texto dele).
// 2. Confira o que o app entendeu de cada verba e o líquido
//    calculado × o do holerite.
// 3. Importe: salário base, adicionais, horas, consignado,
//    atestado e o líquido conferido entram na competência.
// O arquivo é lido no próprio aparelho; nada é enviado.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { monthField, moneyField, switchField } from './forms.js';
import { store } from '../core/store.js';
import { formatBRL, toCents } from '../core/money.js';
import { formatMonth, formatMonthShort } from '../core/dates.js';
import { pdfToText } from '../core/pdftext.js';
import { parsePayslipText, planFromPayslip, friendlyName, compareLines } from '../domain/payslip.js';
import { payrollFor } from '../domain/payroll.js';
import * as A from '../domain/actions.js';

/** Passo 1: escolher o PDF ou colar o texto. */
export function openPayslipImport(ym = store.ui.ym) {
  openDialog({
    title: 'Importar holerite',
    submitLabel: 'Ler texto colado',
    body: html`
      <div class="import-drop import-drop--sm" data-drop-payslip>
        <span class="import-drop__icon">${icon('file-text', 'icon--lg')}</span>
        <p><strong>Escolha o PDF do holerite</strong></p>
        <p class="muted small">O app lê as verbas (salário, adicionais, horas, consignado, atestado) e mostra o que vai cadastrar antes de importar. O arquivo não sai do seu aparelho.</p>
        <button type="button" class="btn btn--primary" data-pick-pdf>${icon('upload')} Escolher PDF</button>
      </div>
      <details class="details">
        <summary>${icon('clipboard-paste', 'icon--xs')} PDF escaneado ou não abriu? Cole o texto</summary>
        <div class="field field--full">
          <label class="field__label" for="pay-text">Texto do holerite</label>
          <textarea class="input textarea" id="pay-text" name="text" rows="8" placeholder="Abra o PDF, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole aqui."></textarea>
          <p class="field__hint">Copie a partir do visualizador de PDF ou do app do banco/empresa.</p>
        </div>
      </details>`,
    onMount: (dlg) => {
      const pick = () => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf,.txt' });
        input.addEventListener('change', () => input.files?.[0] && readFile(input.files[0], dlg, ym));
        input.click();
      };
      dlg.querySelector('[data-pick-pdf]').addEventListener('click', pick);
      const drop = dlg.querySelector('[data-drop-payslip]');
      drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const f = ev.dataTransfer?.files?.[0];
        if (f) readFile(f, dlg, ym);
      });
    },
    onSubmit: (form, dlg) => {
      const text = form.text.value.trim();
      if (!text) throw new A.ValidationError('Cole o texto do holerite (ou escolha o PDF).', 'text');
      return startReview(text, dlg, ym) ? undefined : true;
    },
  });
}

async function readFile(file, dlg, ym) {
  if (file.size > 15 * 1024 * 1024) return toastError('Arquivo grande demais (máx. 15 MB).');
  try {
    const text = /\.txt$/i.test(file.name) ? await file.text() : await pdfToText(await file.arrayBuffer());
    if (!text.trim()) throw new Error('Este PDF não tem texto (parece escaneado). Use a opção de colar o texto.');
    if (startReview(text, dlg, ym)) dlg.close();
  } catch (err) {
    toastError(err.message || 'Não consegui ler o PDF. Tente colar o texto.');
    dlg.querySelector('details')?.setAttribute('open', '');
  }
}

/** Texto já extraído (ex.: PDF compartilhado) → revisão direta. */
export function reviewPayslipText(text, ym = store.ui.ym) {
  return startReview(text, { close() {} }, ym);
}

/** Analisa o texto; se achou verbas, abre a revisão. */
function startReview(text, dlg, ym) {
  const parsed = parsePayslipText(text);
  if (!parsed.items.length) {
    toastError('Não encontrei verbas (código, descrição e valores). Confira o texto do holerite.');
    return false;
  }
  if (!parsed.competence) parsed.competence = ym;
  dlg.close();
  reviewDialog(planFromPayslip(parsed, store.data.settings));
  return true;
}

// ---------- Passo 2: revisão ----------

const ACTION_ICON = {
  base: 'banknote', sick: 'stethoscope', 'inss-days': 'shield-check', falta: 'circle-x', percent: 'trending-up',
  hours: 'clock', addition: 'plus', deduction: 'trending-down', loan: 'credit-card', family: 'users', ignore: 'minus',
};

function reviewDialog(plan) {
  const active = plan.items.filter((x) => x.provento || x.desconto || x.action === 'inss-days');
  const zeroed = plan.items.filter((x) => !(x.provento || x.desconto) && x.action !== 'inss-days');

  openDialog({
    title: 'Conferir holerite',
    size: 'lg',
    submitLabel: 'Importar',
    body: html`
      <div class="form-grid">
        ${monthField({ label: 'Competência', name: 'competence', value: plan.competence, hint: 'Mês trabalhado a que o holerite se refere.' })}
        ${moneyField({ label: 'Salário base (Sal. Base)', name: 'baseSalary', cents: plan.baseSalary, required: false, hint: 'Vale a partir da competência.' })}
      </div>

      <ul class="pimport" aria-label="Verbas do holerite">
        ${active.map((x) => {
          const i = plan.items.indexOf(x);
          const value = x.provento || x.desconto;
          return html`
            <li class="pimport__row ${x.action === 'ignore' ? 'is-muted' : ''}">
              <label class="check pimport__check">
                <input type="checkbox" name="inc-${i}" ${x.include ? 'checked' : ''} ${x.action === 'ignore' || x.action === 'base' ? 'disabled' : ''}>
                <span class="sr-only">Importar ${x.description}</span>
              </label>
              <span class="pimport__icon" aria-hidden="true">${icon(ACTION_ICON[x.action] || 'plus')}</span>
              <span class="pimport__main">
                <strong>${friendlyName(x.description)}</strong>
                <small>${x.code !== '—' ? `${x.code} · ` : ''}${x.label}</small>
                ${x.action === 'loan' ? html`
                  <span class="pimport__loan">
                    <label>Nº de parcelas <input class="input input--sm" name="loanCount-${i}" inputmode="numeric" value="${x.params.count}" placeholder="ex.: 24"></label>
                    <label>Já descontadas antes de ${formatMonthShort(plan.competence)} <input class="input input--sm" name="loanPaid-${i}" inputmode="numeric" value="${x.params.paid}" placeholder="0"></label>
                  </span>` : ''}
              </span>
              <span class="pimport__value money ${x.desconto ? 'neg' : x.provento ? 'pos' : 'muted'}">${value ? `${x.desconto ? '−' : '+'}${formatBRL(value)}` : '—'}</span>
            </li>`;
        })}
      </ul>
      ${zeroed.length ? html`<p class="field__hint">${zeroed.length} verba(s) zerada(s) neste holerite ficaram de fora: ${zeroed.map((x) => friendlyName(x.description)).join(', ')}.</p>` : ''}

      ${plan.net != null ? switchField({ label: `Usar ${formatBRL(plan.net)} como líquido conferido do mês`, name: 'useNet', checked: plan.useNet, hint: 'O app passa a usar o valor real na renda (e mostra a diferença para a estimativa).' }) : ''}

      <div class="pcompare" data-compare aria-live="polite"></div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const update = () => {
        const box = dlg.querySelector('[data-compare]');
        try {
          const p = simulate(readPlan(form, plan));
          const net = plan.net;
          const diff = net != null ? p.net - net : null;
          box.innerHTML = html`
            <div class="pcompare__grid">
              <div><span>Bruto</span><strong class="money">${formatBRL(p.gross)}</strong>${plan.totals?.proventos ? html`<small>holerite ${formatBRL(plan.totals.proventos)}</small>` : ''}</div>
              <div><span>${p.inssLabel}</span><strong class="money">${formatBRL(p.inss)}</strong>${inssOf(plan) ? html`<small>holerite ${formatBRL(inssOf(plan))}</small>` : ''}</div>
              <div><span>IR</span><strong class="money">${formatBRL(p.ir.value)}</strong></div>
              <div><span>Líquido pelo app</span><strong class="money">${formatBRL(p.net)}</strong>${net != null ? html`<small>holerite ${formatBRL(net)}</small>` : ''}</div>
            </div>
            ${diff == null ? '' : diff === 0
              ? html`<p class="pcompare__ok">${icon('circle-check', 'icon--xs')} O cálculo do app bate centavo a centavo com o holerite.</p>`
              : html`<p class="pcompare__warn">${icon('info', 'icon--xs')} Diferença de ${formatBRL(Math.abs(diff))}. Confira as verbas marcadas — ${diff > 0 ? 'o app calculou a mais' : 'o app calculou a menos'}. O líquido conferido do holerite continua valendo na renda.</p>`}
            ${lineTable(plan.items, p)}`.toString();
        } catch (err) {
          box.innerHTML = html`<p class="pcompare__warn">${icon('info', 'icon--xs')} ${err.message}</p>`.toString();
        }
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },
    onSubmit: (form) => {
      const final = readPlan(form, plan);
      A.importPayslip(final);
      store.setUI({ ym: final.competence });
      toast(`Holerite de ${formatMonth(final.competence)} importado.`);
    },
  });
}

/** Tabela verba a verba: holerite × app (sugestão 49). */
function lineTable(items, p) {
  const rows = compareLines(items, p);
  if (!rows.length) return '';
  const cell = (v, sign) => (v == null ? html`<span class="muted">—</span>` : `${sign < 0 ? '−' : ''}${formatBRL(v)}`);
  const bad = rows.filter((r) => r.diff != null && Math.abs(r.diff) > 1).length;
  return html`
    <details class="details" ${bad ? 'open' : ''}>
      <summary>${icon('list-checks', 'icon--xs')} Conferir verba a verba${bad ? ` (${bad} com diferença)` : ''}</summary>
      <div class="table-wrap">
        <table class="table table--compact">
          <thead><tr><th scope="col" class="text-left">Verba</th><th scope="col" class="num">Holerite</th><th scope="col" class="num">App</th><th scope="col" class="num">Diferença</th></tr></thead>
          <tbody>${rows.map((r) => html`
            <tr>
              <th scope="row" class="text-left">${friendlyName(r.label)}</th>
              <td class="num money">${cell(r.payslip, r.sign)}</td>
              <td class="num money">${cell(r.app, r.sign)}</td>
              <td class="num money ${r.diff == null ? 'muted' : Math.abs(r.diff) <= 1 ? 'pos' : 'neg'}">${r.diff == null ? 'só de um lado' : Math.abs(r.diff) <= 1 ? 'ok' : `${r.diff > 0 ? '+' : '−'}${formatBRL(Math.abs(r.diff))}`}</td>
            </tr>`)}</tbody>
        </table>
      </div>
    </details>`;
}

const inssOf = (plan) => plan.items.find((x) => /^i\.?\s?n\.?\s?s\.?\s?s/i.test(x.description))?.desconto || 0;

function readPlan(form, plan) {
  const items = plan.items.map((x, i) => {
    const box = form.querySelector(`[name="inc-${i}"]`);
    const include = box ? box.checked && !box.disabled : false;
    const params = { ...x.params };
    if (x.action === 'loan') {
      params.count = form.querySelector(`[name="loanCount-${i}"]`)?.value.trim() || '';
      params.paid = form.querySelector(`[name="loanPaid-${i}"]`)?.value.trim() || '';
    }
    return { ...x, include, params };
  });
  const base = form.baseSalary.value.trim();
  return {
    ...plan,
    competence: form.competence.value || plan.competence,
    baseSalary: base ? toCents(base) : plan.baseSalary,
    useNet: form.useNet ? form.useNet.checked : false,
    items,
  };
}

/** Aplica o plano numa CÓPIA dos dados e calcula o contracheque. */
function simulate(plan) {
  const copy = structuredClone(store.data);
  const p = { ...plan, items: plan.items.map((x) => (x.action === 'loan' && !x.params.count ? { ...x, params: { ...x.params, count: 999 } } : x)) };
  A.applyPayslipTo(copy, p);
  return payrollFor(copy.settings, plan.competence);
}
