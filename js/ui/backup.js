// =============================================================
// backup.js — Backup (JSON), restauração e exportação CSV
// =============================================================

import { store } from '../core/store.js';
import { todayISO, formatDateBR } from '../core/dates.js';
import { centsToInput } from '../core/money.js';
import { computeMonth } from '../domain/ledger.js';
import { markBackupDone } from '../domain/actions.js';
import { confirmDialog } from './dialog.js';
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

/** Baixa um arquivo .json com TODOS os dados. */
export async function exportBackup() {
  markBackupDone(); // antes de gerar o arquivo, para o backup já sair com a data dele
  await store.flush();
  const payload = { ...store.data, exportedAt: new Date().toISOString(), app: 'Dhenors' };
  download(`dhenors-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Backup baixado. Guarde o arquivo em um lugar seguro (Drive, e-mail…).');
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

