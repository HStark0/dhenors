// =============================================================
// Importar — extrato do banco (OFX / CSV) ou
// fatura do cartão (PDF ou texto colado)
// -------------------------------------------------------------
// 1. Escolha o arquivo  2. Revise (categorias sugeridas e contas já
// lançadas reconhecidas)  3. Importe.
//  • Extrato: saídas que batem com uma conta em aberto (mesmo valor,
//    até 7 dias) marcam ESSA conta como paga — sem duplicar. O resto
//    vira gasto pago; entradas viram renda extra. Pode escolher a
//    conta bancária de onde saiu o dinheiro.
//  • Fatura: as compras entram no cartão escolhido (parceladas com a
//    parcela certa nesta fatura).
// O arquivo é lido no próprio aparelho e não é enviado a lugar nenhum.
// =============================================================

import { html, render } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { catText } from '../ui/forms.js';
import { store } from '../core/store.js';
import { formatBRL, plural } from '../core/money.js';
import { formatDateBR, ymOf, todayISO } from '../core/dates.js';
import { pdfToText } from '../core/pdftext.js';
import { parseStatement, suggestCategory, fingerprint, cleanDescription } from '../domain/importer.js';
import { reconcile } from '../domain/reconcile.js';
import { parseCardInvoice, alignToInvoice } from '../domain/cardInvoice.js';
import { invoiceMonthFor } from '../domain/cards.js';
import * as A from '../domain/actions.js';

/**
 * Sessão de importação (só na memória até você confirmar).
 * { kind: 'statement'|'invoice', filename, format, learn, accountId, cardId, dueDate, rows }
 */
let session = null;
// Entrou ou saiu da conta: a revisão comparava com outros dados (exemplo × conta) e
// mostraria o extrato de quem saiu para o visitante — recomeça do zero
store.subscribe((reason) => { if (reason === 'open' || reason === 'close') session = null; });

export default {
  id: 'importar',
  title: 'Importar',

  render() {
    if (!session) return pickStep();
    return session.kind === 'invoice' ? invoiceStep() : statementStep();
  },

  actions: {
    'imp:pick': () => pickFile(),
    'imp:paste': () => pasteInvoice(),
    'imp:cancel': () => { session = null; store.setUI({}); },
    'imp:invert': () => {
      for (const r of session.rows) {
        r.cents = -r.cents;
        r.fingerprint = fingerprint(r);
        r.duplicate = (store.data.importFingerprints || []).includes(r.fingerprint);
        r.include = !r.duplicate && !r.closed;
      }
      rematch();
      store.setUI({});
    },
    'imp:unmatch': (el) => { const r = session.rows[Number(el.dataset.index)]; r.ignoreMatch = !r.ignoreMatch; store.setUI({}); },
    'imp:confirm': () => (session.kind === 'invoice' ? confirmInvoice() : confirmStatement()),
  },

  // Cada clique atualiza SÓ a linha mudada e o resumo do topo: redesenhar
  // a tabela inteira recriava centenas de listas de categoria a cada clique.
  onFilter(name, value, el) {
    if (!session) return;
    const r = el.dataset.index != null ? session.rows[Number(el.dataset.index)] : null;
    const tableEl = el.closest('.table--import');
    if (name === 'row') { r.include = el.checked; el.closest('tr')?.classList.toggle('is-off', !r.include); }
    if (name === 'all') {
      for (const x of session.rows) if (!x.closed) x.include = el.checked;
      tableEl?.querySelectorAll('tbody [data-filter="row"]').forEach((box) => {
        const row = session.rows[Number(box.dataset.index)];
        box.checked = row.include;
        box.closest('tr')?.classList.toggle('is-off', !row.include);
      });
    }
    if (name === 'learn') session.learn = el.checked;
    if (name === 'account') session.accountId = value || null;
    if (name === 'card') session.cardId = value || null;
    if (name === 'cat') {
      r.categoryId = value || null; r.subcategoryId = null; r.source = '';
      el.closest('tr')?.querySelector('.table__desc .badge--info')?.remove(); // "auto" não vale mais
    }
    if (name === 'row' || name === 'all') refreshSummary(tableEl);
  },
};

/** Redesenha só o cabeçalho (botão "Importar N") e os números do topo. */
function refreshSummary(tableEl) {
  const box = document.querySelector('[data-imp-summary]');
  if (!box) { store.setUI({}); return; }
  const rows = session.rows;
  const chosen = rows.filter((r) => r.include);
  render(box, session.kind === 'invoice' ? invoiceSummary(rows, chosen) : statementSummary(rows, chosen));
  const all = tableEl?.querySelector('[data-filter="all"]');
  if (all) all.checked = chosen.length === rows.filter((r) => !r.closed).length;
}

// ---------- Passo 1 ----------

function pickStep() {
  return html`
    <article class="card import-drop" data-drop>
      <span class="import-drop__icon">${icon('file-up', 'icon--lg')}</span>
      <h2>Traga o extrato do banco ou a fatura do cartão</h2>
      <p class="muted">Extrato em <strong>OFX</strong> ou <strong>CSV</strong>, ou a fatura do cartão em <strong>PDF</strong>. As contas que você já lançou são reconhecidas e marcadas como pagas — nada é duplicado.</p>
      <div class="card__actions center">
        <button type="button" class="btn btn--primary" data-action="imp:pick">${icon('upload')} Escolher arquivo</button>
        <button type="button" class="btn btn--ghost" data-action="imp:paste">${icon('clipboard-paste')} Colar texto da fatura</button>
      </div>
      <p class="field__hint">ou arraste o arquivo para cá · tudo é lido no seu aparelho, nada é enviado</p>
    </article>

    <section class="grid grid--two">
      <article class="card">
        <h3 class="card__title">${icon('info')} Onde encontro o arquivo?</h3>
        <ul class="tips">
          <li><strong>Nubank:</strong> app → fatura → "Exportar fatura" (CSV ou PDF) · conta: "Extrato" → exportar.</li>
          <li><strong>Itaú, Bradesco, Santander, Caixa, BB:</strong> internet banking → extrato → salvar como <em>OFX</em>. Fatura do cartão: baixar o PDF.</li>
          <li><strong>Inter, C6, PicPay:</strong> extrato → exportar em CSV ou OFX; fatura em PDF.</li>
          <li>No celular: no app do banco, baixe o PDF da fatura e escolha o arquivo aqui.</li>
        </ul>
      </article>
      <article class="card">
        <h3 class="card__title">${icon('sparkles')} Categorias e conciliação</h3>
        <p class="muted small">Categorias sugeridas por: suas regras (Ajustes → Regras), lançamentos parecidos e palavras comuns (Uber, iFood, farmácia…). Saídas com o mesmo valor de uma conta em aberto (até 7 dias de diferença) aparecem como <strong>"é a conta X"</strong> e só marcam essa conta como paga.</p>
      </article>
    </section>`;
}

// ---------- Extrato ----------

function statementSummary(rows, chosen) {
  const matched = chosen.filter((r) => r.match && !r.ignoreMatch);
  const fresh = chosen.filter((r) => !(r.match && !r.ignoreMatch));
  const out = fresh.filter((r) => r.cents > 0).reduce((s, r) => s + r.cents, 0);
  const inn = fresh.filter((r) => r.cents < 0).reduce((s, r) => s - r.cents, 0);
  return html`
    ${head(rows, chosen, true)}
    <section class="grid grid--kpis grid--kpis-3">
      ${stat('Contas reconhecidas', String(matched.length), `${formatBRL(matched.reduce((s, r) => s + r.cents, 0))} → marcadas como pagas`)}
      ${stat('Gastos novos', formatBRL(out), `${fresh.filter((r) => r.cents > 0).length} → contas pagas`)}
      ${stat('Entradas', formatBRL(inn), `${fresh.filter((r) => r.cents < 0).length} → renda extra`)}
    </section>`;
}

function statementStep() {
  const d = store.data;
  const rows = session.rows;
  const chosen = rows.filter((r) => r.include);
  const accounts = (d.accounts || []).filter((a) => !a.archived);
  return html`
    <div data-imp-summary>${statementSummary(rows, chosen)}</div>
    <article class="card">
      <div class="form-grid">
        ${accounts.length ? html`
          <div class="field">
            <label class="field__label" for="imp-acc">De qual conta é este extrato?</label>
            <select class="input select" id="imp-acc" data-filter="account">
              <option value="">Não informar</option>
              ${accounts.map((a) => html`<option value="${a.id}" ${a.id === session.accountId ? 'selected' : ''}>${a.name}</option>`)}
            </select>
          </div>` : ''}
        ${learnSwitch()}
      </div>
      ${table(rows, chosen, true)}
    </article>`;
}

function confirmStatement() {
  const chosen = session.rows.filter((r) => r.include);
  const result = A.importTransactions(chosen, { accountId: session.accountId });
  learn(chosen);
  session = null;
  toast(`Importados: ${plural(result.expenses, 'gasto')} e ${plural(result.incomes, 'entrada')}${result.matched ? ` · ${plural(result.matched, 'conta marcada como paga', 'contas marcadas como pagas')}` : ''}${result.skipped ? ` · ${plural(result.skipped, 'ignorado')}` : ''}.`);
  location.hash = '#/contas';
}

// ---------- Fatura do cartão ----------

function invoiceSummary(rows, chosen) {
  const total = chosen.reduce((s, r) => s + Math.round(r.cents / (r.count || 1)), 0);
  return html`
    ${head(rows, chosen, false)}
    <section class="grid grid--kpis grid--kpis-3">
      ${stat('Vencimento', session.dueDate ? formatDateBR(session.dueDate) : '—', session.dueDate ? 'lido da fatura' : 'não encontrado: usa a data das compras')}
      ${stat('Nesta fatura', formatBRL(total), `${chosen.length} compras selecionadas`)}
      ${stat('Parceladas', String(chosen.filter((r) => r.count > 1).length), 'entram com o valor total')}
    </section>`;
}

function invoiceStep() {
  const d = store.data;
  const rows = session.rows;
  const chosen = rows.filter((r) => r.include);
  const cards = (d.cards || []).filter((c) => !c.archived);
  return html`
    <div data-imp-summary>${invoiceSummary(rows, chosen)}</div>
    <article class="card">
      ${cards.length ? html`
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="imp-card">Cartão</label>
            <select class="input select" id="imp-card" data-filter="card">
              ${cards.map((c) => html`<option value="${c.id}" ${c.id === session.cardId ? 'selected' : ''}>${c.name}</option>`)}
            </select>
          </div>
          ${learnSwitch()}
        </div>` : html`<div class="note note--warn">${icon('triangle-alert')}<span>Cadastre o cartão antes (Cartões e contas bancárias → Novo cartão) para importar a fatura. <a href="#/carteira">Abrir</a></span></div>`}
      ${table(rows, chosen, false)}
    </article>`;
}

function confirmInvoice() {
  const d = store.data;
  const card = (d.cards || []).find((c) => c.id === session.cardId);
  if (!card) return toastError('Escolha o cartão.');
  const dueYM = session.dueDate ? ymOf(session.dueDate) : null;
  const chosen = session.rows.filter((r) => r.include).map((r) => alignToInvoice(card, r, dueYM, invoiceMonthFor));
  const result = A.importCardPurchases(card.id, chosen);
  learn(chosen);
  session = null;
  toast(`${plural(result.added, 'compra importada', 'compras importadas')} no ${card.name}${result.skipped ? ` · ${plural(result.skipped, 'ignorada')}` : ''}.`);
  location.hash = '#/carteira';
}

// ---------- Partes comuns ----------

function head(rows, chosen, statement) {
  return html`
    <div class="page-head">
      <div>
        <p class="strong">${session.filename}</p>
        <p class="muted small">${session.format} · ${plural(rows.length, 'lançamento')} · ${plural(rows.filter((r) => r.duplicate).length, 'já importado', 'já importados')}</p>
      </div>
      <div class="page-head__actions">
        <button type="button" class="btn btn--ghost" data-action="imp:cancel">${icon('x')} Cancelar</button>
        ${statement ? html`<button type="button" class="btn btn--ghost" data-action="imp:invert" title="Use se gastos aparecerem como entradas">${icon('repeat')} Inverter sinais</button>` : ''}
        <button type="button" class="btn btn--primary" data-action="imp:confirm" ${chosen.length ? '' : 'disabled'}>${icon('check')} Importar ${chosen.length}</button>
      </div>
    </div>`;
}

function learnSwitch() {
  return html`
    <label class="switch field--full">
      <input type="checkbox" role="switch" data-filter="learn" ${session.learn ? 'checked' : ''}>
      <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
      <span class="switch__label">Aprender: lembrar as categorias que eu escolher</span>
    </label>`;
}

function table(rows, chosen, statement) {
  const catOptions = [{ id: '', name: 'Sem categoria', icon: '' }, ...store.data.categories];
  return html`
    <div class="table-wrap">
      <table class="table table--import">
        <thead><tr>
          <th scope="col"><input type="checkbox" aria-label="Selecionar todos" data-filter="all" ${chosen.length === rows.filter((r) => !r.closed).length ? 'checked' : ''}></th>
          <th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col" class="num">Valor</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => {
            const m = statement && r.match && !r.ignoreMatch ? r.match : null;
            return html`
              <tr class="${r.include ? '' : 'is-off'} ${m ? 'is-matched' : ''}">
                <td><input type="checkbox" aria-label="Importar ${r.description}" data-filter="row" data-index="${i}" ${r.include ? 'checked' : ''} ${r.closed ? 'disabled' : ''}></td>
                <td>${formatDateBR(r.date)}</td>
                <td class="table__desc">${r.description}
                  ${r.count > 1 ? html`<span class="badge">${r.n}/${r.count}</span>` : ''}
                  ${r.duplicate ? html`<span class="badge badge--muted">já importado</span>` : ''}
                  ${r.closed ? html`<span class="badge badge--muted">mês fechado</span>` : ''}
                  ${r.source && !m ? html`<span class="badge badge--info" title="Categoria sugerida por ${r.source}">auto</span>` : ''}
                  ${statement && r.match ? html`
                    <span class="match ${r.ignoreMatch ? 'is-off' : ''}">
                      ${icon('link', 'icon--xs')} ${r.ignoreMatch ? 'Não é' : 'É'} a conta <strong>${r.match.description}</strong> (vence ${formatDateBR(r.match.dueDate)}, ${formatBRL(r.match.cents)})
                      <button type="button" class="link" data-action="imp:unmatch" data-index="${i}">${r.ignoreMatch ? 'É sim' : 'Não é'}</button>
                    </span>` : ''}</td>
                <td>
                  ${m ? html`<span class="badge badge--good">${icon('check', 'icon--xs')} marca como paga</span>`
                  : r.cents > 0 ? html`
                    <label class="sr-only" for="imp-cat-${i}">Categoria de ${r.description}</label>
                    <select class="input select input--sm" id="imp-cat-${i}" data-filter="cat" data-index="${i}">
                      ${catOptions.map((c) => html`<option value="${c.id}" ${c.id === (r.categoryId || '') ? 'selected' : ''}>${c.id ? catText(c) : c.name}</option>`)}
                    </select>` : html`<span class="badge badge--good">${statement ? 'renda extra' : 'crédito'}</span>`}
                </td>
                <td class="money num ${r.cents < 0 ? 'pos' : ''}">${r.cents < 0 ? '+' : '−'}${formatBRL(Math.abs(r.cents))}</td>
              </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

function stat(label, value, sub) {
  return html`
    <article class="card kpi">
      <div class="kpi__body">
        <p class="kpi__label">${label}</p>
        <p class="kpi__value money">${value}</p>
        <p class="kpi__sub">${sub}</p>
      </div>
    </article>`;
}

/** Aprende regras com as categorias escolhidas à mão. */
function learn(rows) {
  if (!session?.learn) return;
  const seen = new Set();
  for (const r of rows) {
    if (!r.categoryId || r.cents <= 0 || r.source === 'regra' || (r.match && !r.ignoreMatch)) continue;
    const pattern = cleanDescription(r.description).split(' ').slice(0, 2).join(' ');
    if (pattern.length < 3 || seen.has(pattern)) continue;
    seen.add(pattern);
    try { A.saveRule({ pattern: pattern.toLowerCase(), categoryId: r.categoryId, subcategoryId: r.subcategoryId }); } catch { /* ignora */ }
  }
}

function prepare(t) {
  const d = store.data;
  const known = new Set(d.importFingerprints || []);
  const fp = t.fingerprint || fingerprint(t);
  const s = t.cents > 0 ? suggestCategory(d, t.description) : null;
  const closed = Boolean(d.closedMonths[ymOf(t.date)]);
  return { ...t, fingerprint: fp, duplicate: known.has(fp), closed, include: !known.has(fp) && !closed, categoryId: s?.categoryId || null, subcategoryId: s?.subcategoryId || null, source: s?.source || '' };
}

function rematch() {
  const out = reconcile(store.data, session.rows, todayISO());
  session.rows.forEach((r, i) => { r.match = r.duplicate ? null : out[i].match; });
}

function open() {
  if (location.hash.split('?')[0] !== '#/importar') location.hash = '#/importar'; else store.setUI({});
}

// ---------- Entradas ----------

export function pickFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ofx,.csv,.txt,.pdf,text/csv,application/x-ofx,application/pdf' });
  input.addEventListener('change', () => input.files?.[0] && loadFile(input.files[0]));
  input.click();
}

/** Linhas já no formato do importador → tela de revisão do extrato. */
export function loadRows(rows, filename, format = 'Extrato') {
  if (!rows.length) return toastError('Nenhum lançamento encontrado.');
  session = { kind: 'statement', filename, format, learn: true, accountId: null, rows: rows.map(prepare).sort((a, b) => a.date.localeCompare(b.date)) };
  rematch();
  open();
}

/** Texto da fatura do cartão → tela de revisão da fatura. */
export function loadInvoiceText(text, filename) {
  const { dueDate, rows } = parseCardInvoice(text);
  if (!rows.length) return toastError('Não encontrei compras nessa fatura. Tente colar o texto ou exportar em CSV.');
  const cards = (store.data.cards || []).filter((c) => !c.archived);
  session = { kind: 'invoice', filename, format: 'Fatura do cartão', learn: true, dueDate, cardId: cards[0]?.id || null, rows: rows.map(prepare).sort((a, b) => a.date.localeCompare(b.date)) };
  open();
  return undefined;
}

export async function loadFile(file) {
  if (file.size > 8 * 1024 * 1024) return toastError('Arquivo grande demais (máx. 8 MB).');
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    try {
      const text = await pdfToText(await file.arrayBuffer());
      return loadInvoiceText(text, file.name);
    } catch (err) {
      return toastError(`Não consegui ler esse PDF (${err.message}). Tente "Colar texto da fatura".`);
    }
  }
  let text = await file.text();
  // Alguns bancos exportam em Latin-1: tenta de novo se aparecerem caracteres inválidos
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
  const { format, rows } = parseStatement(text, file.name);
  if (!rows.length) return toastError('Não encontrei lançamentos nesse arquivo. Confira se é OFX ou CSV do banco.');
  return loadRows(rows, file.name, format);
}

async function pasteInvoice() {
  const { openDialog } = await import('../ui/dialog.js');
  openDialog({
    title: 'Colar a fatura',
    submitLabel: 'Ler compras',
    body: html`
      <p class="dialog__text muted">Abra a fatura (PDF ou site do banco), selecione tudo, copie e cole aqui.</p>
      <div class="field"><label class="field__label" for="inv-text">Texto da fatura</label><textarea class="input textarea" id="inv-text" name="text" rows="10" required></textarea></div>`,
    onSubmit: (form) => { loadInvoiceText(form.text.value, 'Fatura colada'); },
  });
}

/** Arrastar e soltar arquivo em qualquer lugar da tela de importação. */
export function bindDrop() {
  const here = () => location.hash.split('?')[0] === '#/importar';
  document.addEventListener('dragover', (ev) => { if (here()) { ev.preventDefault(); document.body.classList.add('is-dragging'); } });
  document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) document.body.classList.remove('is-dragging'); });
  document.addEventListener('drop', (ev) => {
    document.body.classList.remove('is-dragging');
    if (!here()) return;
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
}
