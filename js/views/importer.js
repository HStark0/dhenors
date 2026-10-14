// =============================================================
// Importar — extrato do banco ou fatura do cartão (OFX / CSV)
// -------------------------------------------------------------
// 1. Escolha o arquivo  2. Revise (categorias já sugeridas)
// 3. Importe. Gastos viram contas pagas; entradas viram renda extra.
// O arquivo é lido no próprio aparelho e não é enviado a lugar nenhum.
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { store } from '../core/store.js';
import { formatBRL, plural } from '../core/money.js';
import { formatDateBR, ymOf } from '../core/dates.js';
import { parseStatement, suggestCategory, fingerprint, cleanDescription } from '../domain/importer.js';
import * as A from '../domain/actions.js';

/** Sessão de importação (só na memória até você confirmar). */
let session = null; // { filename, format, rows: [{ ...t, include, categoryId, subcategoryId, source, duplicate, closed }] }

export default {
  id: 'importar',
  title: 'Importar extrato',

  render() {
    if (!session) return pickStep();
    const d = store.data;
    const rows = session.rows;
    const chosen = rows.filter((r) => r.include);
    const out = chosen.filter((r) => r.cents > 0).reduce((s, r) => s + r.cents, 0);
    const inn = chosen.filter((r) => r.cents < 0).reduce((s, r) => s - r.cents, 0);
    const catOptions = [{ id: '', name: 'Sem categoria', icon: '' }, ...d.categories];

    return html`
      <div class="page-head">
        <div>
          <p class="strong">${session.filename}</p>
          <p class="muted small">${session.format} · ${plural(rows.length, 'lançamento')} · ${plural(rows.filter((r) => r.duplicate).length, 'já importado', 'já importados')}</p>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--ghost" data-action="imp:cancel">${icon('x')} Cancelar</button>
          <button type="button" class="btn btn--ghost" data-action="imp:invert" title="Use se gastos aparecerem como entradas">${icon('repeat')} Inverter sinais</button>
          <button type="button" class="btn btn--primary" data-action="imp:confirm" ${chosen.length ? '' : 'disabled'}>${icon('check')} Importar ${chosen.length}</button>
        </div>
      </div>

      <section class="grid grid--kpis grid--kpis-3">
        ${stat('Gastos selecionados', formatBRL(out), `${chosen.filter((r) => r.cents > 0).length} → contas pagas`)}
        ${stat('Entradas selecionadas', formatBRL(inn), `${chosen.filter((r) => r.cents < 0).length} → renda extra`)}
        ${stat('Categorizados', `${chosen.filter((r) => r.categoryId).length}/${chosen.length}`, 'sugestões automáticas')}
      </section>

      <article class="card">
        <label class="switch">
          <input type="checkbox" role="switch" id="imp-learn" data-filter="learn" ${session.learn ? 'checked' : ''}>
          <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
          <span class="switch__label">Aprender: lembrar as categorias que eu escolher para as próximas importações</span>
        </label>
        <div class="table-wrap">
          <table class="table table--import">
            <thead><tr>
              <th scope="col"><input type="checkbox" aria-label="Selecionar todos" data-filter="all" ${chosen.length === rows.filter((r) => !r.closed).length ? 'checked' : ''}></th>
              <th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col">Valor</th>
            </tr></thead>
            <tbody>
              ${rows.map((r, i) => html`
                <tr class="${r.include ? '' : 'is-off'}">
                  <td><input type="checkbox" aria-label="Importar ${r.description}" data-filter="row" data-index="${i}" ${r.include ? 'checked' : ''} ${r.closed ? 'disabled' : ''}></td>
                  <td>${formatDateBR(r.date)}</td>
                  <td class="table__desc">${r.description}
                    ${r.duplicate ? html`<span class="badge badge--muted">já importado</span>` : ''}
                    ${r.closed ? html`<span class="badge badge--muted">mês fechado</span>` : ''}
                    ${r.source ? html`<span class="badge badge--info" title="Categoria sugerida por ${r.source}">auto</span>` : ''}</td>
                  <td>
                    ${r.cents > 0 ? html`
                      <label class="sr-only" for="imp-cat-${i}">Categoria de ${r.description}</label>
                      <select class="input select input--sm" id="imp-cat-${i}" data-filter="cat" data-index="${i}">
                        ${catOptions.map((c) => html`<option value="${c.id}" ${c.id === (r.categoryId || '') ? 'selected' : ''}>${c.icon} ${c.name}</option>`)}
                      </select>` : html`<span class="badge badge--good">renda extra</span>`}
                  </td>
                  <td class="money ${r.cents < 0 ? 'pos' : ''}">${r.cents < 0 ? '+' : '−'}${formatBRL(Math.abs(r.cents))}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </article>`;
  },

  actions: {
    'imp:pick': () => pickFile(),
    'imp:cancel': () => { session = null; store.setUI({}); },
    'imp:invert': () => {
      for (const r of session.rows) {
        r.cents = -r.cents;
        r.fingerprint = fingerprint(r);
        r.duplicate = (store.data.importFingerprints || []).includes(r.fingerprint);
        r.include = !r.duplicate && !r.closed;
      }
      store.setUI({});
    },
    'imp:confirm': () => {
      const chosen = session.rows.filter((r) => r.include);
      const result = A.importTransactions(chosen);
      if (session.learn) {
        const seen = new Set();
        for (const r of chosen) {
          if (!r.categoryId || r.cents <= 0 || r.source === 'regra') continue;
          const pattern = cleanDescription(r.description).split(' ').slice(0, 2).join(' ');
          if (pattern.length < 3 || seen.has(pattern)) continue;
          seen.add(pattern);
          try { A.saveRule({ pattern: pattern.toLowerCase(), categoryId: r.categoryId, subcategoryId: r.subcategoryId }); } catch { /* ignora */ }
        }
      }
      session = null;
      toast(`Importados: ${plural(result.expenses, 'gasto')} e ${plural(result.incomes, 'entrada')}${result.skipped ? ` · ${plural(result.skipped, 'ignorado')}` : ''}.`);
      location.hash = '#/contas';
    },
  },

  onFilter(name, value, el) {
    if (!session) return;
    if (name === 'row') session.rows[Number(el.dataset.index)].include = el.checked;
    if (name === 'all') for (const r of session.rows) if (!r.closed) r.include = el.checked;
    if (name === 'learn') session.learn = el.checked;
    if (name === 'cat') {
      const r = session.rows[Number(el.dataset.index)];
      r.categoryId = value || null;
      r.subcategoryId = null;
      r.source = '';
    }
    store.setUI({});
  },
};

function pickStep() {
  return html`
    <article class="card import-drop" data-drop>
      <span class="import-drop__icon">${icon('file-up', 'icon--lg')}</span>
      <h2>Traga o extrato do banco ou a fatura do cartão</h2>
      <p class="muted">Arquivos <strong>OFX</strong> ou <strong>CSV</strong>. Os gastos entram como contas pagas e já vêm com categoria sugerida. Lançamentos repetidos são ignorados.</p>
      <button type="button" class="btn btn--primary" data-action="imp:pick">${icon('upload')} Escolher arquivo</button>
      <p class="field__hint">ou arraste o arquivo para cá · tudo é lido no seu aparelho, nada é enviado</p>
    </article>

    <section class="grid grid--two">
      <article class="card">
        <h3 class="card__title">${icon('info')} Onde encontro o arquivo?</h3>
        <ul class="tips">
          <li><strong>Nubank:</strong> app → fatura → "Exportar fatura" (CSV) · conta: "Extrato" → exportar.</li>
          <li><strong>Itaú, Bradesco, Santander, Caixa, BB:</strong> internet banking → extrato → salvar como <em>OFX</em> (ou Money/Quicken).</li>
          <li><strong>Inter, C6, PicPay:</strong> extrato → exportar em CSV ou OFX.</li>
        </ul>
      </article>
      <article class="card">
        <h3 class="card__title">${icon('sparkles')} Categorização automática</h3>
        <p class="muted small">O app usa, nesta ordem: suas regras (Ajustes → Regras), lançamentos parecidos que você já fez e palavras-chave comuns (Uber, iFood, farmácia, Netflix…). Ao importar, ele pode aprender com as suas escolhas.</p>
      </article>
    </section>`;
}

export function pickFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ofx,.csv,.txt,text/csv,application/x-ofx' });
  input.addEventListener('change', () => input.files?.[0] && loadFile(input.files[0]));
  input.click();
}

export async function loadFile(file) {
  if (file.size > 5 * 1024 * 1024) return toastError('Arquivo grande demais (máx. 5 MB).');
  let text = await file.text();
  // Alguns bancos exportam em Latin-1: tenta de novo se aparecerem caracteres inválidos
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
  const { format, rows } = parseStatement(text, file.name);
  if (!rows.length) return toastError('Não encontrei lançamentos nesse arquivo. Confira se é OFX ou CSV do banco.');
  const d = store.data;
  const known = new Set(d.importFingerprints || []);
  session = {
    filename: file.name,
    format,
    learn: true,
    rows: rows.map((t) => {
      const fp = fingerprint(t);
      const s = t.cents > 0 ? suggestCategory(d, t.description) : null;
      const closed = Boolean(d.closedMonths[ymOf(t.date)]);
      return { ...t, fingerprint: fp, duplicate: known.has(fp), closed, include: !known.has(fp) && !closed, categoryId: s?.categoryId || null, subcategoryId: s?.subcategoryId || null, source: s?.source || '' };
    }).sort((a, b) => a.date.localeCompare(b.date)),
  };
  if (location.hash !== '#/importar') location.hash = '#/importar'; else store.setUI({});
}

/** Arrastar e soltar arquivo em qualquer lugar da tela de importação. */
export function bindDrop() {
  document.addEventListener('dragover', (ev) => { if (location.hash === '#/importar') { ev.preventDefault(); document.body.classList.add('is-dragging'); } });
  document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) document.body.classList.remove('is-dragging'); });
  document.addEventListener('drop', (ev) => {
    document.body.classList.remove('is-dragging');
    if (location.hash !== '#/importar') return;
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
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
