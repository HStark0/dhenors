// =============================================================
// backup.js — Backup (JSON), restauração e exportação CSV
// -------------------------------------------------------------
// O backup pode (e deve) ser CRIPTOGRAFADO com uma senha: o arquivo
// fica ilegível para quem achar o arquivo no Drive ou no e-mail.
// Sem senha, é um JSON aberto (dá para ler em qualquer editor).
// Anexos (fotos) não vão no backup: ficam só no aparelho.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { store } from '../core/store.js';
import { todayISO, formatDateBR } from '../core/dates.js';
import { centsToInput } from '../core/money.js';
import { encryptWithPassword, decryptWithPassword, isEncryptedBackup, passwordStrength } from '../core/crypto.js';
import { computeMonth } from '../domain/ledger.js';
import { markBackupDone } from '../domain/actions.js';
import { confirmDialog, openDialog } from './dialog.js';
import { field, switchField } from './forms.js';
import { toast, toastError } from './toast.js';

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Baixa um arquivo .json com TODOS os dados (com senha, recomendado). */
export function exportBackup() {
  const hasAttachments = store.data.expenses.some((e) => e.attachments?.length);
  openDialog({
    title: 'Baixar backup',
    size: 'sm',
    submitLabel: 'Baixar',
    body: html`
      <p class="dialog__text muted">${store.data.lastBackupAt ? `Último backup: ${formatDateBR(todayISO(new Date(store.data.lastBackupAt)))}.` : 'Você ainda não fez nenhum backup.'}</p>
      ${switchField({ label: 'Proteger com senha (recomendado)', name: 'protect', checked: true, hint: 'O arquivo fica criptografado (AES-256). Sem a senha, ninguém lê — nem você: anote-a.' })}
      <div class="form-grid" data-pass>
        ${field({ label: 'Senha do backup', name: 'pass', type: 'password', full: true, extra: { autocomplete: 'new-password', minlength: 8 } })}
        ${field({ label: 'Repita a senha', name: 'pass2', type: 'password', full: true, extra: { autocomplete: 'new-password' } })}
        <p class="field__hint field--full" data-strength aria-live="polite"></p>
      </div>
      ${hasAttachments ? html`<p class="note">${icon('paperclip')}<span>As fotos anexadas não vão no backup (ficam só neste aparelho).</span></p>` : ''}`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => { dlg.querySelector('[data-pass]').hidden = !form.protect.checked; };
      form.protect.addEventListener('change', sync);
      form.pass.addEventListener('input', () => {
        const s = passwordStrength(form.pass.value);
        dlg.querySelector('[data-strength]').textContent = form.pass.value ? `Força: ${s.label}` : '';
      });
      sync();
    },
    onSubmit: async (form) => {
      if (form.protect.checked) {
        if (form.pass.value.length < 8) { const e = new Error('Use pelo menos 8 caracteres.'); e.field = 'pass'; throw e; }
        if (form.pass.value !== form.pass2.value) { const e = new Error('As senhas não conferem.'); e.field = 'pass2'; throw e; }
      }
      markBackupDone(); // antes de gerar o arquivo, para o backup já sair com a data dele
      await store.flush();
      const json = JSON.stringify({ ...store.data, exportedAt: new Date().toISOString(), app: 'Dhenors' }, null, form.protect.checked ? 0 : 2);
      const content = form.protect.checked ? JSON.stringify(await encryptWithPassword(json, form.pass.value)) : json;
      download(`dhenors-backup-${todayISO()}${form.protect.checked ? '-protegido' : ''}.json`, content, 'application/json');
      toast('Backup baixado. Guarde o arquivo em um lugar seguro (Drive, e-mail…).');
    },
  });
}

/** Pede a senha de um backup criptografado. → texto do JSON (ou null se cancelou). */
function askBackupPassword(file) {
  return new Promise((resolve) => {
    let result = null;
    const { dialog } = openDialog({
      title: 'Backup protegido',
      size: 'sm',
      submitLabel: 'Abrir',
      body: html`
        <p class="dialog__text muted">Este backup foi salvo com senha.</p>
        ${field({ label: 'Senha do backup', name: 'pass', type: 'password', required: true, full: true, extra: { autocomplete: 'current-password' } })}`,
      onSubmit: async (form) => {
        try { result = await decryptWithPassword(file, form.pass.value); } catch (err) { err.field = 'pass'; throw err; }
      },
    });
    dialog.addEventListener('close', () => resolve(result));
  });
}

/** Abre o seletor de arquivo e restaura um backup (substitui os dados atuais). */
export function importBackup() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toastError('Arquivo grande demais para ser um backup.');
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return toastError('O arquivo não é um JSON válido.');
    }
    if (isEncryptedBackup(parsed)) {
      const text = await askBackupPassword(parsed);
      if (!text) return;
      try { parsed = JSON.parse(text); } catch { return toastError('Backup corrompido.'); }
    }
    const ok = await confirmDialog({
      title: 'Restaurar backup',
      message: `Os dados atuais deste aparelho serão SUBSTITUÍDOS pelos do arquivo "${file.name}". Deseja continuar?`,
      confirmLabel: 'Restaurar',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.replace(parsed);
      toast('Backup restaurado.');
    } catch (err) {
      toastError(err.message || 'Não foi possível restaurar o backup.');
    }
  });
  input.click();
}

/**
 * Célula CSV segura: aspas escapadas e proteção contra fórmulas
 * (=, +, -, @ no início viram texto no Excel).
 */
function cell(value) {
  if (value instanceof NumberCell) return value.text; // números saem sem proteção (podem ser negativos)
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

class NumberCell { constructor(cents) { this.text = centsToInput(cents); } }
export const num = (cents) => new NumberCell(cents);

/** Monta um CSV (separador ";", com BOM para o Excel abrir acentos). */
export function toCSV(rows) {
  return '\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

const KIND = { expense: 'Avulsa', recurring: 'Recorrente', installment: 'Parcela' };
const STATUS = { paid: 'Pago', overdue: 'Atrasado', today: 'Vence hoje', soon: 'A vencer', upcoming: 'A vencer' };

/** CSV das contas de um mês (abre no Excel/Planilhas com acentos corretos). */
export function exportMonthCSV(ym) {
  const d = store.data;
  const m = computeMonth(d, ym, todayISO());
  const catName = (id) => d.categories.find((c) => c.id === id)?.name || '';
  const subName = (cid, sid) => d.categories.find((c) => c.id === cid)?.subcategories.find((s) => s.id === sid)?.name || '';
  const credName = (id) => d.creditors.find((c) => c.id === id)?.name || '';

  const rows = [['Vencimento', 'Descrição', 'Tipo', 'Parcela', 'Categoria', 'Subcategoria', 'Credor', 'Situação', 'Valor (R$)']];
  for (const i of m.items) {
    rows.push([
      formatDateBR(i.dueDate), i.description, KIND[i.kind], i.parcel ? `${i.parcel.n}/${i.parcel.count}` : '',
      catName(i.categoryId), subName(i.categoryId, i.subcategoryId), credName(i.creditorId),
      STATUS[i.status], num(i.cents),
    ]);
  }
  rows.push([]);
  rows.push(['', 'Renda do mês', '', '', '', '', '', '', num(m.income.total)]);
  rows.push(['', 'Total de contas', '', '', '', '', '', '', num(m.totals.all)]);
  rows.push(['', 'Saldo previsto', '', '', '', '', '', '', num(m.balance)]);

  // ";" é o separador padrão do Excel em português
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  download(`dhenors-contas-${ym}.csv`, csv, 'text/csv;charset=utf-8');
  toast('Planilha exportada.');
}

