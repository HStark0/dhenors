// =============================================================
// Recebidos — o que chegou pelo "Compartilhar" do celular
// -------------------------------------------------------------
// O service worker guarda os arquivos (cache 'dhenors-share') e abre
// #/recebidos. Aqui cada arquivo vira o que faz sentido:
//  • PDF de holerite → importar holerite
//  • PDF de fatura   → importar fatura do cartão
//  • OFX / CSV       → importar extrato
//  • Foto / PDF qualquer → comprovante de um gasto novo
//  • Texto com boleto ou Pix Copia e Cola → nova conta a pagar
// Nada sai do aparelho.
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { saveAttachment } from '../ui/attachments.js';
import { reviewPayslipText } from '../ui/payslipImport.js';
import * as E from '../ui/editors.js';
import { store } from '../core/store.js';
import { pdfToText } from '../core/pdftext.js';
import { formatBRL } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import { parsePayslipText } from '../domain/payslip.js';
import { parseCardInvoice } from '../domain/cardInvoice.js';
import { parseBoleto } from '../domain/boleto.js';
import { parsePix } from '../domain/pix.js';
import { loadFile, loadInvoiceText } from './importer.js';

const CACHE = 'dhenors-share';
let inbox = null; // { meta, files: [{ key, name, type, size, kind, text? }] }
let loading = false;

export default {
  id: 'recebidos',
  title: 'Recebidos',

  render() {
    if (!inbox && !loading) load();
    if (loading || !inbox) return html`<div class="card empty">${icon('loader', 'icon--lg spin')}<p class="muted">Abrindo o que você compartilhou…</p></div>`;
    const { meta, files, code } = inbox;
    if (!files.length && !meta.text && !meta.url) {
      return html`<div class="card empty">${icon('inbox', 'icon--lg')}<p><strong>Nada recebido.</strong></p><p class="muted">No celular, use "Compartilhar" em outro app (foto do comprovante, PDF da fatura, extrato) e escolha o Dhenors.</p><a class="btn btn--primary" href="#/painel">Ir para o Painel</a></div>`;
    }
    return html`
      <p class="muted">Escolha o que fazer com cada item. Os arquivos ficam só no aparelho.</p>
      ${code ? html`
        <article class="card">
          <h2 class="card__title">${icon(code.kind === 'pix' ? 'qr-code' : 'barcode')} ${code.kind === 'pix' ? 'Pix Copia e Cola' : 'Boleto'}</h2>
          <p>${code.info.cents ? html`<strong class="money">${formatBRL(code.info.cents)}</strong>` : 'Valor livre'}${code.info.name ? ` · ${code.info.name}` : ''}</p>
          <div class="card__actions"><button type="button" class="btn btn--primary btn--sm" data-action="rcv:code">${icon('plus', 'icon--xs')} Criar conta a pagar</button></div>
        </article>` : meta.text || meta.url ? html`
        <article class="card">
          <h2 class="card__title">${icon('text')} Texto</h2>
          <p class="pre-wrap small">${[meta.title, meta.text, meta.url].filter(Boolean).join('\n')}</p>
          <div class="card__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="rcv:textexp">${icon('plus', 'icon--xs')} Gasto com esse texto</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="rcv:textinv">${icon('credit-card', 'icon--xs')} É uma fatura</button>
          </div>
        </article>` : ''}
      ${files.map((f, i) => html`
        <article class="card received">
          <h2 class="card__title">${icon(f.type.startsWith('image/') ? 'image' : f.kind === 'statement' ? 'file-spreadsheet' : 'file-text')} ${f.name}</h2>
          <p class="muted small">${LABEL[f.kind]} · ${(f.size / 1024).toFixed(0)} KB</p>
          <div class="card__actions">
            ${f.kind === 'payslip' ? html`<button type="button" class="btn btn--primary btn--sm" data-action="rcv:payslip" data-i="${i}">${icon('banknote', 'icon--xs')} Importar holerite</button>` : ''}
            ${f.kind === 'invoice' ? html`<button type="button" class="btn btn--primary btn--sm" data-action="rcv:invoice" data-i="${i}">${icon('credit-card', 'icon--xs')} Importar fatura</button>` : ''}
            ${f.kind === 'statement' ? html`<button type="button" class="btn btn--primary btn--sm" data-action="rcv:statement" data-i="${i}">${icon('file-up', 'icon--xs')} Importar extrato</button>` : ''}
            ${f.kind !== 'statement' ? html`<button type="button" class="btn ${f.kind === 'attachment' ? 'btn--primary' : 'btn--ghost'} btn--sm" data-action="rcv:attach" data-i="${i}">${icon('paperclip', 'icon--xs')} Comprovante de um gasto</button>` : ''}
            <button type="button" class="btn btn--ghost btn--sm" data-action="rcv:drop" data-i="${i}">Descartar</button>
          </div>
        </article>`)}
      <div class="card__actions"><button type="button" class="btn btn--ghost" data-action="rcv:clear">${icon('trash-2', 'icon--xs')} Descartar tudo</button></div>`;
  },

  actions: {
    'rcv:payslip': async (el) => { const f = await take(el); if (f && reviewPayslipText(f.text)) done(f); },
    'rcv:invoice': async (el) => { const f = await take(el); if (f) { done(f); loadInvoiceText(f.text, f.name); } },
    'rcv:statement': async (el) => { const f = await take(el); if (f) { done(f); loadFile(f.file); } },
    'rcv:attach': async (el) => {
      const f = await take(el);
      if (!f) return;
      try {
        const att = await saveAttachment(f.file);
        done(f);
        E.editExpense(null, { paid: true, preset: { description: f.name.replace(/\.[^.]+$/, '').slice(0, 60), dueDate: todayISO(), paidAt: todayISO(), attachments: [att] } });
      } catch (err) { toastError(err.message); }
    },
    'rcv:drop': async (el) => { const f = inbox.files[Number(el.dataset.i)]; if (f) await done(f); },
    'rcv:clear': async () => { await caches.delete(CACHE).catch(() => {}); inbox = { meta: {}, files: [] }; toast('Tudo descartado.'); store.setUI({}); },
    'rcv:code': async () => {
      const { kind, info } = inbox.code;
      await clearText();
      E.editExpense(null, { preset: { description: info.name || (kind === 'pix' ? 'Pix' : 'Boleto'), cents: info.cents || null, dueDate: info.dueDate || todayISO(), [kind]: info } });
    },
    'rcv:textexp': async () => { const t = inbox.meta.title || inbox.meta.text || ''; await clearText(); E.editExpense(null, { paid: true, preset: { description: t.slice(0, 120), notes: inbox.meta.url || '' } }); },
    'rcv:textinv': async () => { const t = inbox.meta.text || ''; await clearText(); loadInvoiceText(t, 'Texto compartilhado'); },
  },
};

const LABEL = { payslip: 'Parece um holerite', invoice: 'Parece uma fatura de cartão', statement: 'Extrato (OFX/CSV)', attachment: 'Foto ou documento' };

async function load() {
  loading = true;
  try {
    const cache = await caches.open(CACHE);
    const metaRes = await cache.match('./share/meta');
    const meta = metaRes ? await metaRes.json() : { files: [] };
    const files = [];
    for (const m of meta.files || []) {
      const res = await cache.match(m.key);
      if (!res) continue;
      const blob = await res.blob();
      const file = new File([blob], m.name, { type: m.type || blob.type });
      files.push({ ...m, file, ...(await classify(file)) });
    }
    let code = null;
    const raw = `${meta.text || ''} ${meta.url || ''}`.trim();
    if (raw) {
      try { code = { kind: 'pix', info: parsePix(raw) }; } catch {
        try { code = { kind: 'boleto', info: parseBoleto(raw) }; } catch { code = null; }
      }
    }
    inbox = { meta, files, code };
  } catch (err) {
    inbox = { meta: {}, files: [] };
    toastError(`Não consegui abrir o que foi compartilhado (${err.message}).`);
  }
  loading = false;
  store.setUI({});
}

/** Decide o tipo pelo conteúdo. */
export async function classify(file) {
  if (/\.(ofx|csv)$/i.test(file.name) || /csv|ofx/.test(file.type)) return { kind: 'statement' };
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    try {
      const text = await pdfToText(await file.arrayBuffer());
      return { kind: classifyText(text), text };
    } catch { return { kind: 'attachment' }; }
  }
  if (/\.txt$/i.test(file.name)) { const text = await file.text(); return { kind: classifyText(text), text }; }
  return { kind: 'attachment' };
}

/** Texto → 'payslip' | 'invoice' | 'attachment' (puro, testável). */
export function classifyText(text) {
  if (parsePayslipText(text).items.length >= 2) return 'payslip';
  if (/fatura|cart[aã]o/i.test(text) && parseCardInvoice(text).rows.length >= 1) return 'invoice';
  return 'attachment';
}

async function take(el) {
  const f = inbox?.files[Number(el.dataset.i)];
  if (!f) toastError('Arquivo não encontrado.');
  return f || null;
}

async function done(f) {
  try { const cache = await caches.open(CACHE); await cache.delete(f.key); } catch { /* ignora */ }
  inbox.files = inbox.files.filter((x) => x !== f);
  await saveMeta();
  store.setUI({});
}

async function clearText() {
  inbox.meta = { ...inbox.meta, title: '', text: '', url: '' };
  inbox.code = null;
  await saveMeta();
}

async function saveMeta() {
  try {
    const cache = await caches.open(CACHE);
    const meta = { ...inbox.meta, files: inbox.files.map(({ key, name, type, size }) => ({ key, name, type, size })) };
    if (!meta.files.length && !meta.text && !meta.url) await caches.delete(CACHE);
    else await cache.put('./share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* ignora */ }
}

/** Ao voltar para a tela depois de um novo compartilhamento, relê. */
globalThis.addEventListener?.('hashchange', () => { if (location.hash.startsWith('#/recebidos')) inbox = null; });
