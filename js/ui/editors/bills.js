// =============================================================
// editors/bills.js — Contas avulsas, recorrentes, parcelamentos e anexos
// =============================================================

import { html } from '../dom.js';
import { icon } from '../icons.js';
import { openDialog, confirmDialog, actionSheet } from '../dialog.js';
import { toast, toastError } from '../toast.js';
import {
  field, moneyField, dateField, monthField, numberField, textareaField, selectField, switchField,
  categoryFields, bindCategorySelects, creditorField, readForm, tagsField, accountField, cardField,
  splitsField, bindSplits, readSplits, maskCents, catText,
} from '../forms.js';
import { saveAttachment, attachmentURL, removeAttachment, pickFiles } from '../attachments.js';
import { scanCode, canScan } from '../scan.js';
import { store } from '../../core/store.js';
import { toCents, formatBRL } from '../../core/money.js';
import {
  todayISO, currentYM, dateInMonth, formatDateBR, formatMonth, ymOf, addDaysISO, parseISO, nextPayday,
} from '../../core/dates.js';
import * as A from '../../domain/actions.js';
import { installmentSummary, entryKey, planInstallment, FREQ_LABELS, FREQ_DAYS } from '../../domain/ledger.js';
import { parseBoleto, formatLine } from '../../domain/boleto.js';
import { parsePix } from '../../domain/pix.js';
import { cleanDescription } from '../../domain/importer.js';

const data = () => store.data;

/** Data padrão para novos lançamentos: hoje, se o mês exibido for o atual; senão dia 1 do mês exibido. */
export function defaultDate() {
  const ym = store.ui.ym;
  return ym === currentYM() ? todayISO() : dateInMonth(ym, 1);
}

/** Etiquetas já usadas (sugestões). */
export function knownTags() {
  const d = data();
  return [...new Set([...d.expenses, ...d.recurring, ...d.installments, ...(d.cardPurchases || [])].flatMap((x) => x.tags || []))].sort().slice(0, 60);
}

// ---------- Excluir com "Desfazer" ----------

/**
 * Exclui na hora e oferece "Desfazer" no aviso (todas as ações
 * destrutivas usam isso). `run` deve chamar uma ação com undo.
 */
export function deleteWithUndo(run, message = 'Excluído.') {
  try { run(); } catch (err) { toastError(err.message); return; }
  toast(message, { action: { label: 'Desfazer', run: () => { const label = store.undo(); if (label) toast('Desfeito.', { type: 'info' }); } } });
}

/** Confirmação para exclusões grandes; também pode ser desfeita depois. */
export async function confirmDelete(what, run) {
  const ok = await confirmDialog({ title: 'Excluir', message: `Excluir ${what}?`, confirmLabel: 'Excluir', danger: true });
  if (ok) deleteWithUndo(run, 'Excluído.');
}

// ---------- Boleto e Pix ----------

/** Janela "Ler boleto": cola a linha digitável ou lê o código de barras pela câmera. */
export function boletoDialog(onRead) {
  openDialog({
    title: 'Ler boleto',
    size: 'sm',
    submitLabel: 'Usar',
    body: html`
      <p class="dialog__text muted">Cole a linha digitável (os números embaixo do código) ou o código de barras. O app preenche valor e vencimento.</p>
      <div class="field field--full">
        <label class="field__label" for="boleto-line">Linha digitável</label>
        <textarea class="input textarea" id="boleto-line" name="line" rows="2" inputmode="numeric" autocomplete="off" placeholder="34191.79001 01043.510047 91020.150008 1 75870026000"></textarea>
      </div>
      ${canScan() ? html`<button type="button" class="btn btn--secondary btn--sm" data-scan>${icon('scan-line', 'icon--xs')} Ler com a câmera</button>` : ''}`,
    onMount: (dlg) => dlg.querySelector('[data-scan]')?.addEventListener('click', async () => {
      const code = await scanCode({ formats: ['itf', 'code_128'], title: 'Aponte para o código de barras' });
      if (code) { dlg.querySelector('[name="line"]').value = code; dlg.querySelector('form').requestSubmit(); }
    }),
    onSubmit: (form) => {
      let b;
      try { b = parseBoleto(form.line.value); } catch (err) { throw new A.ValidationError(err.message, 'line'); }
      onRead(b);
    },
  });
}

/** Janela "Pix Copia e Cola": cola o código (ou lê o QR) e o app entende valor e recebedor. */
export async function pixDialog(onRead) {
  let pasted = '';
  try { pasted = (await navigator.clipboard?.readText?.()) || ''; } catch { /* sem permissão */ }
  openDialog({
    title: 'Pix Copia e Cola',
    size: 'sm',
    submitLabel: 'Usar',
    body: html`
      <p class="dialog__text muted">Cole o código do Pix. O app lê o valor, o recebedor e a chave — nada é enviado a lugar nenhum.</p>
      <div class="field field--full">
        <label class="field__label" for="pix-code">Código Pix</label>
        <textarea class="input textarea" id="pix-code" name="code" rows="3" autocomplete="off" placeholder="00020126…">${/^000201/.test(pasted.trim()) ? pasted.trim() : ''}</textarea>
      </div>
      ${canScan() ? html`<button type="button" class="btn btn--secondary btn--sm" data-scan>${icon('qr-code', 'icon--xs')} Ler o QR Code</button>` : ''}`,
    onMount: (dlg) => dlg.querySelector('[data-scan]')?.addEventListener('click', async () => {
      const code = await scanCode({ formats: ['qr_code'], title: 'Aponte para o QR Code do Pix' });
      if (code) { dlg.querySelector('[name="code"]').value = code; dlg.querySelector('form').requestSubmit(); }
    }),
    onSubmit: (form) => {
      let p;
      try { p = parsePix(form.code.value); } catch (err) { throw new A.ValidationError(err.message, 'code'); }
      onRead(p);
    },
  });
}

// ---------- Menu "Novo" ----------

/**
 * Menu "Novo": os 6 mais usados primeiro e "Mais…" com o resto
 * (nada some — só fica um toque mais longe).
 */
export function openNewMenu() {
  const hasCards = (data().cards || []).some((c) => !c.archived);
  const installment = { label: 'Parcelamento (carnê, empréstimo)', hint: 'Fora do cartão de crédito', icon: 'calendar-range', run: () => editInstallment() };
  const main = [
    { label: 'Gasto já pago', hint: 'Registrar algo que você já pagou', icon: 'circle-check', run: () => editExpense(null, { paid: true }) },
    { label: 'Conta a pagar', hint: 'Boleto, Pix ou conta com vencimento', icon: 'receipt', run: () => editExpense() },
    hasCards ? { label: 'Compra no cartão', hint: 'Entra na fatura certa sozinha', icon: 'credit-card', run: () => import('./wallet.js').then((m) => m.editPurchase()) } : installment,
    { label: 'Despesa recorrente', hint: 'Aluguel, internet, assinaturas, IPVA…', icon: 'repeat', run: () => editRecurring() },
    { label: 'Receita', hint: 'Plantão, freela, reembolso, venda, presente…', icon: 'trending-up', run: () => import('./income.js').then((m) => m.editExtraIncome()) },
    { label: 'Lançamento rápido', hint: 'Escreva "mercado 120 ontem" · Ctrl+K', icon: 'zap', run: () => document.dispatchEvent(new CustomEvent('dhenors:palette')) },
  ];
  const more = [
    ...(hasCards ? [installment] : []),
    { label: 'Marcar plantão', hint: 'Na escala de plantões', icon: 'stethoscope', run: () => { location.hash = '#/salario?aba=plantoes&novo=1'; } },
    { label: 'Transferência entre contas bancárias', icon: 'arrow-left-right', run: () => import('./wallet.js').then((m) => m.transferDialog()) },
    { label: 'Alguém me deve', hint: 'Empréstimo para amigo, valor a receber', icon: 'hand-coins', run: () => import('./people.js').then((m) => m.editReceivable()) },
    { label: 'Aporte em investimento', hint: 'CDB, Tesouro, ações, FII, cripto…', icon: 'coins', run: () => import('../investEditors.js').then((m) => m.quickMovement('aporte')) },
    { label: 'Importar extrato ou fatura', hint: 'OFX, CSV ou PDF do cartão', icon: 'file-up', run: () => { location.hash = '#/importar'; } },
  ];
  actionSheet({
    title: 'Novo lançamento',
    actions: [
      ...main,
      { label: 'Mais…', hint: more.map((a) => a.label.split(' (')[0]).join(', '), icon: 'ellipsis', run: () => actionSheet({ title: 'Novo lançamento · mais opções', actions: more }) },
    ],
  });
}

// ---------- Despesa avulsa ----------

export function editExpense(expense = null, { paid = false, preset = {} } = {}) {
  const e = expense || { description: '', cents: null, dueDate: defaultDate(), paidAt: paid ? defaultDate() : null, tags: [], splits: [], attachments: [], ...preset };
  const isPaid = Boolean(e.paidAt);
  const before = expense ? { categoryId: expense.categoryId, subcategoryId: expense.subcategoryId } : null;
  const extra = { boleto: e.boleto || null, pix: e.pix || null };
  let attachments = [...(e.attachments || [])];
  openDialog({
    title: expense ? 'Editar despesa' : (paid ? 'Registrar gasto pago' : 'Nova conta a pagar'),
    submitLabel: expense ? 'Salvar' : 'Adicionar',
    body: html`
      ${expense ? '' : html`
        <div class="quick-fill">
          <button type="button" class="btn btn--ghost btn--sm" data-boleto>${icon('barcode', 'icon--xs')} Ler boleto</button>
          <button type="button" class="btn btn--ghost btn--sm" data-pix>${icon('qr-code', 'icon--xs')} Pix Copia e Cola</button>
        </div>`}
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: e.description, required: true, placeholder: 'Ex.: Conta de luz', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor', name: 'cents', cents: e.cents })}
        ${dateField({ label: isPaid && !expense ? 'Data do pagamento' : 'Vencimento', name: 'dueDate', value: e.dueDate })}
        ${categoryFields(data(), e)}
        ${splitsField(data(), e.splits || [])}
        ${accountField(data(), e.accountId)}
        ${creditorField(data(), e.creditorId)}
        <div class="field field--full">
          <label class="check"><input type="checkbox" name="paid" ${isPaid ? 'checked' : ''}> Já está pago</label>
        </div>
        ${tagsField({ value: e.tags || [], suggestions: knownTags() })}
        ${textareaField({ label: 'Observação', name: 'notes', value: e.notes || '' })}
        <div class="field field--full">
          <span class="field__label">Anexos</span>
          <div class="attach-list" data-attach-list></div>
          <button type="button" class="btn btn--ghost btn--sm" data-attach>${icon('paperclip', 'icon--xs')} Foto do comprovante ou boleto</button>
          <p class="field__hint">Ficam só neste aparelho (não vão para a nuvem nem para o backup).</p>
        </div>
        <div class="field field--full" data-extra-info aria-live="polite"></div>
      </div>`,
    onMount: (dlg) => {
      bindCategorySelects(dlg, data());
      bindSplits(dlg, data());
      const form = dlg.querySelector('form');
      const info = dlg.querySelector('[data-extra-info]');
      const showInfo = () => {
        info.innerHTML = [
          extra.boleto ? html`<p class="note">${icon('barcode')}<span>Boleto ${extra.boleto.bank ? `· ${extra.boleto.bank}` : ''}<br><code class="small">${formatLine(extra.boleto.line)}</code></span></p>` : '',
          extra.pix ? html`<p class="note">${icon('qr-code')}<span>Pix para <strong>${extra.pix.name}</strong>${extra.pix.city ? ` (${extra.pix.city})` : ''}${extra.pix.key ? html`<br><small>Chave: ${extra.pix.key}</small>` : ''}</span></p>` : '',
        ].map(String).join('');
      };
      const renderAttach = () => {
        dlg.querySelector('[data-attach-list]').innerHTML = attachments.map((a) => String(html`
          <span class="attach-chip">${icon(a.type.startsWith('image/') ? 'image' : 'file-text', 'icon--xs')} ${a.name}
            <button type="button" class="icon-btn icon-btn--sm" data-attach-del="${a.id}" aria-label="Remover ${a.name}">${icon('x')}</button></span>`)).join('');
      };
      showInfo();
      renderAttach();
      dlg.querySelector('[data-boleto]')?.addEventListener('click', () => boletoDialog((b) => {
        if (b.cents) form.cents.value = maskCents(b.cents);
        if (b.dueDate) form.dueDate.value = b.dueDate;
        if (!form.description.value) form.description.value = b.kind === 'arrecadacao' ? b.bank : `Boleto ${b.bank}`;
        extra.boleto = { line: b.line, bank: b.bank };
        showInfo();
        toast(b.cents ? `Boleto lido: ${formatBRL(b.cents)}${b.dueDate ? ` · vence ${formatDateBR(b.dueDate)}` : ''}.` : 'Boleto lido. Este tipo não traz o valor: digite.', { type: 'info' });
      }));
      dlg.querySelector('[data-pix]')?.addEventListener('click', () => pixDialog((p) => {
        if (p.cents) form.cents.value = maskCents(p.cents);
        if (!form.description.value) form.description.value = p.description || `Pix ${p.name}`.trim();
        extra.pix = { key: p.key, name: p.name, city: p.city };
        showInfo();
        toast(`Pix lido: ${p.name || 'recebedor'}${p.cents ? ` · ${formatBRL(p.cents)}` : ' · sem valor no código'}.`, { type: 'info' });
      }));
      dlg.querySelector('[data-attach]').addEventListener('click', async () => {
        const files = await pickFiles();
        for (const f of files) {
          try { attachments.push(await saveAttachment(f)); } catch (err) { toastError(err.message); }
        }
        renderAttach();
      });
      dlg.querySelector('[data-attach-list]').addEventListener('click', async (ev) => {
        const del = ev.target.closest('[data-attach-del]');
        if (!del) return;
        attachments = attachments.filter((a) => a.id !== del.dataset.attachDel);
        if (!expense?.attachments?.some((a) => a.id === del.dataset.attachDel)) removeAttachment(del.dataset.attachDel);
        renderAttach();
      });
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const saved = A.saveExpense({
        ...v, id: expense?.id, cents: toCents(v.cents), splits: readSplits(form), attachments,
        paidAt: v.paid ? (expense?.paidAt || (v.dueDate <= todayISO() ? v.dueDate : todayISO())) : null,
        boleto: extra.boleto, pix: extra.pix,
      });
      for (const a of expense?.attachments || []) if (!attachments.some((x) => x.id === a.id)) removeAttachment(a.id);
      toast(expense ? 'Despesa atualizada.' : 'Despesa adicionada.');
      // Aprender ao recategorizar: "Sempre colocar UBER em Transporte?"
      if (before && v.categoryId && v.categoryId !== before.categoryId) offerRule(saved.description, v.categoryId, v.subcategoryId);
    },
  });
}

/** Pergunta se deve criar a regra a partir da recategorização. */
export function offerRule(description, categoryId, subcategoryId) {
  const words = cleanDescription(description).split(' ').filter((w) => w.length >= 3);
  if (!words.length) return;
  const pattern = words.slice(0, words[0].length >= 5 ? 1 : 2).join(' ').toLowerCase();
  if ((data().settings.rules || []).some((r) => r.pattern.toLowerCase() === pattern && r.categoryId === categoryId)) return;
  const cat = data().categories.find((c) => c.id === categoryId);
  setTimeout(() => toast(`Sempre colocar "${pattern.toUpperCase()}" em ${cat?.name}?`, {
    type: 'info', duration: 9000,
    action: { label: 'Sim, criar regra', run: () => { const n = A.learnRule({ pattern, categoryId, subcategoryId }); toast(`Regra criada${n ? ` e aplicada em ${n} lançamento(s) sem categoria` : ''}.`); } },
  }), 400);
}

export function postponeExpenseDialog(expense) {
  openDialog({
    title: 'Adiar conta',
    size: 'sm',
    submitLabel: 'Adiar',
    body: html`
      <p class="dialog__text">${expense.description} · ${formatBRL(expense.cents)}</p>
      ${dateField({ label: 'Nova data de vencimento', name: 'dueDate', value: addDaysISO(expense.dueDate, 7) })}`,
    onSubmit: (form) => {
      A.postponeExpense(expense.id, form.dueDate.value);
      toast(`Adiada para ${formatDateBR(form.dueDate.value)}.`, { action: { label: 'Desfazer', run: () => store.undo() } });
    },
  });
}

/** Anexos de uma despesa já salva: ver, baixar, incluir, remover. */
export function attachmentsDialog(expense) {
  const render = () => {
    const e = data().expenses.find((x) => x.id === expense.id);
    return html`
      ${(e.attachments || []).length ? html`<ul class="attach-grid">${e.attachments.map((a) => html`
        <li><button type="button" class="attach-thumb" data-open="${a.id}">${icon(a.type.startsWith('image/') ? 'image' : 'file-text')}<span>${a.name}</span></button>
          <button type="button" class="icon-btn icon-btn--sm danger" data-del="${a.id}" aria-label="Remover ${a.name}">${icon('trash-2')}</button></li>`)}</ul>`
        : html`<p class="muted">Nenhum anexo ainda.</p>`}
      <div class="card__actions"><button type="button" class="btn btn--secondary btn--sm" data-add>${icon('camera', 'icon--xs')} Adicionar foto ou PDF</button></div>
      <div data-preview></div>`;
  };
  const { dialog } = openDialog({ title: `Anexos · ${expense.description}`, body: render() });
  const body = dialog.querySelector('.dialog__body');
  body.addEventListener('click', async (ev) => {
    const e = data().expenses.find((x) => x.id === expense.id);
    if (ev.target.closest('[data-add]')) {
      const files = await pickFiles();
      const added = [];
      for (const f of files) { try { added.push(await saveAttachment(f)); } catch (err) { toastError(err.message); } }
      A.setExpenseAttachments(e.id, [...(e.attachments || []), ...added]);
      body.innerHTML = render().toString();
    }
    const del = ev.target.closest('[data-del]');
    if (del) {
      A.setExpenseAttachments(e.id, e.attachments.filter((a) => a.id !== del.dataset.del));
      removeAttachment(del.dataset.del);
      body.innerHTML = render().toString();
    }
    const open = ev.target.closest('[data-open]');
    if (open) {
      try {
        const a = e.attachments.find((x) => x.id === open.dataset.open);
        const url = await attachmentURL(a.id);
        if (!url) return toastError('Este anexo não está neste aparelho.');
        const box = body.querySelector('[data-preview]');
        box.innerHTML = a.type.startsWith('image/')
          ? `<img class="attach-preview" src="${url}" alt="${a.name.replace(/"/g, '')}">`
          : `<p><a class="btn btn--secondary btn--sm" href="${url}" download="${a.name.replace(/"/g, '')}" target="_blank" rel="noopener">Abrir ${a.name.replace(/</g, '')}</a></p>`;
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } catch (err) { toastError(err.message); }
    }
  });
}

// ---------- Recorrente ----------

const FREQ_OPTIONS = Object.entries(FREQ_LABELS).map(([value, label]) => ({ value, label }));
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function editRecurring(rec = null, { preset = {} } = {}) {
  const r = rec || { description: '', cents: null, dueDay: 10, startYM: store.ui.ym, endYM: null, freq: 'monthly', tags: [], ...preset };
  openDialog({
    title: rec ? 'Editar recorrente' : 'Nova despesa recorrente',
    submitLabel: rec ? 'Salvar' : 'Adicionar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: r.description, required: true, placeholder: 'Ex.: Internet, Aluguel, IPVA', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor', name: 'cents', cents: r.cents, hint: 'Se variar em algum mês, ajuste só aquele mês na lista de contas.' })}
        ${selectField({ label: 'Repete', name: 'freq', value: r.freq || 'monthly', options: FREQ_OPTIONS })}
        ${numberField({ label: 'Dia do vencimento', name: 'dueDay', value: r.dueDay, min: 1, max: 31, hint: 'Em meses mais curtos, vence no último dia.' })}
        <div data-anchor ${FREQ_DAYS[r.freq] ? '' : 'hidden'}>${dateField({ label: 'Primeira data', name: 'anchorDate', value: r.anchorDate || dateInMonth(r.startYM, r.dueDay), required: false, hint: 'As próximas contam de 7 em 7 (ou 14 em 14) dias a partir dela.' })}</div>
        ${monthField({ label: 'Começa em', name: 'startYM', value: r.startYM, hint: 'Bimestral, anual etc. contam a partir deste mês.' })}
        ${monthField({ label: 'Termina em (opcional)', name: 'endYM', value: r.endYM || '', required: false, hint: 'Deixe vazio se não tem fim.' })}
        ${categoryFields(data(), r)}
        ${accountField(data(), r.accountId, { label: 'Debitada da conta (opcional)' })}
        ${(data().cards || []).length ? cardField(data(), r.cardId, { label: 'Cobrada no cartão (opcional)', none: 'Não: é uma conta separada' }) : ''}
        ${creditorField(data(), r.creditorId)}
        ${switchField({ label: 'Valor muda todo mês (luz, água)', name: 'variable', checked: r.variable, hint: 'O app estima pela média dos últimos meses e você confirma quando a conta chegar.' })}
        ${switchField({ label: 'É uma assinatura', name: 'subscription', checked: r.subscription, hint: 'Entra na lista de assinaturas com o custo anual e avisos de aumento e renovação.' })}
        <div data-renewal ${r.subscription ? '' : 'hidden'}>${dateField({ label: 'Próxima renovação (planos anuais)', name: 'renewal', value: r.renewal || '', required: false })}</div>
        <fieldset class="field field--full">
          <legend class="field__label">Reajuste automático (aluguel, contratos)</legend>
          <div class="form-grid">
            ${selectField({ label: 'Índice', name: 'adjustIndex', value: r.adjust?.index || '', options: [{ value: '', label: 'Sem reajuste' }, { value: 'igpm', label: 'IGP-M (12 meses)' }, { value: 'ipca', label: 'IPCA (12 meses)' }, { value: 'fixo', label: 'Percentual fixo' }] })}
            ${selectField({ label: 'Mês do aniversário', name: 'adjustMonth', value: r.adjust?.month || Number(r.startYM.slice(5)), options: MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m })) })}
            ${field({ label: '% fixo ao ano', name: 'adjustPct', value: r.adjust?.pctBp ? (r.adjust.pctBp / 100).toLocaleString('pt-BR') : '', placeholder: '5', extra: { inputmode: 'decimal' } })}
          </div>
          <p class="field__hint">No mês do aniversário, o valor sobe pelo índice acumulado (atualizado pelo Banco Central em Investimentos → Atualizar taxas).</p>
        </fieldset>
        ${tagsField({ value: r.tags || [], suggestions: knownTags() })}
        ${textareaField({ label: 'Observação', name: 'notes', value: r.notes || '' })}
      </div>`,
    onMount: (dlg) => {
      bindCategorySelects(dlg, data());
      const form = dlg.querySelector('form');
      form.freq.addEventListener('change', () => { dlg.querySelector('[data-anchor]').hidden = !FREQ_DAYS[form.freq.value]; });
      form.subscription.addEventListener('change', () => { dlg.querySelector('[data-renewal]').hidden = !form.subscription.checked; });
    },
    onSubmit: async (form) => {
      const v = readForm(form);
      const pct = Math.round(parseFloat(String(v.adjustPct || '0').replace(',', '.')) * 100) || 0;
      const input = {
        ...v, id: rec?.id, cents: toCents(v.cents), dueDay: Number(v.dueDay), endYM: v.endYM || null,
        anchorDate: FREQ_DAYS[v.freq] ? v.anchorDate : null, renewal: v.subscription ? v.renewal || null : null,
        adjust: v.adjustIndex ? { index: v.adjustIndex, month: Number(v.adjustMonth), pctBp: pct, lastYM: rec?.adjust?.lastYM || null } : null,
      };
      // Valor mudou numa recorrente já existente (de valor fixo): pergunta o alcance
      if (rec?.id && !rec.variable && !v.variable && Number.isInteger(input.cents) && input.cents > 0 && input.cents !== rec.cents) {
        const ym = store.ui.ym;
        const scope = await askRecurringScope(rec, input.cents, ym, { perDate: Boolean(FREQ_DAYS[v.freq]) });
        if (!scope) return true; // desistiu: a janela de edição continua aberta
        A.saveRecurringScoped(input, scope, ym);
        toast(scope === 'month' ? `Valor de ${formatMonth(ym)} ajustado.` : scope === 'future' ? `Recorrente atualizada a partir de ${formatMonth(ym)}.` : 'Recorrente atualizada em todos os meses em aberto.');
        return undefined;
      }
      A.saveRecurring(input);
      toast(rec ? 'Recorrente atualizada.' : 'Recorrente adicionada.');
      return undefined;
    },
  });
}

/**
 * Pergunta o alcance da mudança de valor de uma recorrente.
 * → Promise<'month' | 'future' | 'open' | null> (null = cancelou)
 */
function askRecurringScope(rec, newCents, ym, { perDate = false } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const opts = [
      ...(perDate ? [] : [{ id: 'month', label: `Só em ${formatMonth(ym)}`, hint: `O cadastro continua com ${formatBRL(rec.cents)}.`, icon: 'calendar-days' }]),
      { id: 'future', label: `De ${formatMonth(ym)} em diante`, hint: 'Meses anteriores em aberto ficam com o valor antigo.', icon: 'arrow-right' },
      { id: 'all', label: 'Todos os meses em aberto', hint: 'Inclusive atrasados e ajustes feitos à mão. Os já pagos não mudam.', icon: 'repeat' },
    ];
    const { dialog, close } = openDialog({
      title: 'Aplicar o novo valor onde?',
      size: 'sm',
      body: html`
        <p class="dialog__text">${rec.description}: ${formatBRL(rec.cents)} → <strong>${formatBRL(newCents)}</strong></p>
        <ul class="sheet-list">
          ${opts.map((o) => html`
            <li><button type="button" class="sheet-item" data-scope="${o.id}">${icon(o.icon)}<span>${o.label}<small>${o.hint}</small></span></button></li>`)}
        </ul>`,
    });
    dialog.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-scope]');
      if (!btn) return;
      chosen = btn.dataset.scope === 'all' ? 'open' : btn.dataset.scope;
      close();
    });
    dialog.addEventListener('close', () => resolve(chosen));
  });
}

/** Ajusta (ou confirma) o valor de uma recorrente só em um mês. */
export function adjustRecurringMonth(item) {
  const ym = ymOf(item.dueDate);
  const k = item.entryKey ? item.entryKey.split('|')[1] : ym;
  const rec = data().recurring.find((r) => r.id === item.refId);
  const entry = data().recurringEntries[entryKey(item.refId, k)];
  openDialog({
    title: rec.variable ? `Conta de ${formatMonth(ym)}` : `Valor de ${formatMonth(ym)}`,
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text">${rec.description} · ${rec.variable ? `estimativa ${formatBRL(item.cents)} (média)` : `valor padrão ${formatBRL(rec.cents)}`}</p>
      ${moneyField({ label: rec.variable ? 'Valor da conta que chegou' : 'Valor neste mês', name: 'cents', cents: entry?.cents ?? item.cents })}`,
    footer: entry?.cents != null ? html`<button type="button" class="btn btn--ghost" data-reset>${rec.variable ? 'Voltar à estimativa' : 'Voltar ao padrão'}</button>` : '',
    onMount: (dlg) => dlg.querySelector('[data-reset]')?.addEventListener('click', () => {
      A.setRecurringMonthAmount(item.refId, k, null);
      dlg.close();
      toast('Valor padrão restaurado.');
    }),
    onSubmit: (form) => {
      A.setRecurringMonthAmount(item.refId, k, toCents(form.cents.value));
      toast(rec.variable ? 'Valor confirmado.' : 'Valor do mês ajustado.');
    },
  });
}

// ---------- Parcelamento ----------

export function editInstallment(inst = null) {
  // Valores iniciais: na edição, deduz parcela, pagas e próximo vencimento do cadastro atual
  let init;
  if (inst) {
    const s = installmentSummary(inst);
    init = { ...inst, parcelCents: Math.round(inst.totalCents / inst.count), paidCount: s.paidCount, nextDueDate: s.nextOpen?.dueDate || nextPayday(inst.dueDay), dueDay: inst.dueDay };
  } else {
    init = { description: '', parcelCents: null, count: 10, paidCount: 0, dueDay: 10, nextDueDate: nextPayday(10), tags: [] };
  }
  let nextTouched = Boolean(inst); // se o usuário mexer na data, paramos de sugerir

  openDialog({
    title: inst ? 'Editar parcelamento' : 'Novo parcelamento',
    submitLabel: inst ? 'Salvar' : 'Adicionar',
    body: html`
      ${(data().cards || []).length && !inst ? html`<p class="note">${icon('info')}<span>Compra parcelada no <strong>cartão de crédito</strong>? Use "Compra no cartão": as parcelas entram na fatura certa.</span></p>` : ''}
      <div class="form-grid">
        ${field({ label: 'Descrição', name: 'description', value: init.description, required: true, placeholder: 'Ex.: Carnê da loja, Empréstimo', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
        ${moneyField({ label: 'Valor da parcela', name: 'parcelCents', cents: init.parcelCents })}
        ${numberField({ label: 'Nº de parcelas', name: 'count', value: init.count, min: 1, max: 420 })}
        ${numberField({ label: 'Parcelas já pagas', name: 'paidCount', value: init.paidCount, min: 0, max: 420, hint: 'Compra nova? Deixe 0.' })}
        ${numberField({ label: 'Dia do vencimento', name: 'dueDay', value: init.dueDay, min: 1, max: 31 })}
        ${dateField({ label: 'Próxima parcela a pagar vence em', name: 'nextDueDate', value: init.nextDueDate, hint: 'Calculada pelo dia do vencimento. Ajuste se já pagou a deste mês.' })}
        <div class="field field--full"><div class="preview preview--plan" data-preview aria-live="polite"></div></div>
        ${categoryFields(data(), init)}
        ${creditorField(data(), init.creditorId)}
        ${tagsField({ value: init.tags || [], suggestions: knownTags() })}
        ${textareaField({ label: 'Observação', name: 'notes', value: init.notes || '' })}
      </div>`,
    onMount: (dlg) => {
      bindCategorySelects(dlg, data());
      const form = dlg.querySelector('form');
      const preview = dlg.querySelector('[data-preview]');
      const read = () => ({
        parcelCents: toCents(form.parcelCents.value),
        count: Number(form.count.value),
        paidCount: Number(form.paidCount.value || 0),
        nextDueDate: form.nextDueDate.value,
        dueDay: Number(form.dueDay.value),
      });
      const update = () => {
        const v = read();
        if (!Number.isFinite(v.parcelCents) || v.parcelCents <= 0 || !Number.isInteger(v.count) || v.count < 1 || v.count > 420
          || !Number.isInteger(v.paidCount) || v.paidCount < 0 || v.paidCount > v.count || !parseISO(v.nextDueDate)) {
          preview.textContent = 'Preencha o valor da parcela, o nº de parcelas e quantas já pagou para ver o resumo.';
          return;
        }
        const plan = planInstallment(v);
        const remaining = v.count - v.paidCount;
        preview.innerHTML = html`
          <dl class="plan">
            <div><dt>Valor total</dt><dd class="money">${formatBRL(plan.totalCents)}</dd></div>
            <div><dt>Começou em</dt><dd>${formatDateBR(plan.firstDueDate)}</dd></div>
            <div><dt>Termina em</dt><dd>${formatDateBR(plan.lastDueDate)}</dd></div>
            <div><dt>Falta pagar</dt><dd class="money">${remaining ? `${remaining}× · ${formatBRL(remaining * v.parcelCents)}` : 'quitado'}</dd></div>
          </dl>
          ${remaining ? html`<p class="small">Próxima: parcela <strong>${v.paidCount + 1}/${v.count}</strong> em ${formatDateBR(v.nextDueDate)}</p>` : ''}`.toString();
      };
      form.dueDay.addEventListener('input', () => {
        const day = Number(form.dueDay.value);
        if (!nextTouched && Number.isInteger(day) && day >= 1 && day <= 31) form.nextDueDate.value = nextPayday(day);
        else if (nextTouched && Number.isInteger(day) && day >= 1 && day <= 31 && parseISO(form.nextDueDate.value)) {
          form.nextDueDate.value = dateInMonth(ymOf(form.nextDueDate.value), day);
        }
      });
      form.nextDueDate.addEventListener('change', () => {
        nextTouched = true;
        const p = parseISO(form.nextDueDate.value);
        if (p && !(Number(form.dueDay.value) > p.d && dateInMonth(ymOf(form.nextDueDate.value), Number(form.dueDay.value)) === form.nextDueDate.value)) form.dueDay.value = p.d;
      });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const parcelCents = toCents(v.parcelCents);
      const count = Number(v.count);
      const keepTotalCents = inst && count === inst.count && parcelCents === init.parcelCents ? inst.totalCents : undefined;
      A.saveInstallment({
        ...v, id: inst?.id, parcelCents, count, keepTotalCents,
        paidCount: Number(v.paidCount || 0), nextDueDate: v.nextDueDate, dueDay: Number(v.dueDay),
      });
      toast(inst ? 'Parcelamento atualizado.' : 'Parcelamento adicionado.');
    },
  });
}

/** Cronograma com marcação individual de parcelas e a DATA real de cada pagamento. */
export function installmentDetails(instId) {
  const render = () => {
    const inst = data().installments.find((x) => x.id === instId);
    if (!inst) return html`<p>Parcelamento removido.</p>`;
    const s = installmentSummary(inst);
    return html`
      <div class="kv">
        <div><span>Total</span><strong>${formatBRL(inst.totalCents)}</strong></div>
        <div><span>Pago</span><strong class="pos">${formatBRL(s.paidCents)}</strong></div>
        <div><span>Restante</span><strong>${formatBRL(s.remainingCents)}</strong></div>
        <div><span>Termina</span><strong>${formatDateBR(s.lastDueDate)}</strong></div>
      </div>
      <ol class="schedule">
        ${s.schedule.map((p) => html`
          <li class="schedule__row ${p.paid ? 'is-paid' : ''}">
            <label class="check">
              <input type="checkbox" data-parcel="${p.n}" ${p.paid ? 'checked' : ''}>
              <span>${p.n}/${inst.count}</span>
            </label>
            <span class="schedule__date">${formatDateBR(p.dueDate)}${p.paid ? html`<small class="muted">${p.paidAtKnown ? `pago em ${formatDateBR(p.paidAt)}` : 'pago (data não informada)'}</small>` : ''}</span>
            <span class="schedule__value">${formatBRL(p.cents)}</span>
            ${p.paid ? html`<label class="sr-only" for="paid-${p.n}">Data do pagamento da parcela ${p.n}</label><input class="input input--sm" type="date" id="paid-${p.n}" data-paid-date="${p.n}" value="${p.paidAtKnown ? p.paidAt : ''}" max="${todayISO()}">` : html`<span></span>`}
          </li>`)}
      </ol>`;
  };
  const inst = data().installments.find((x) => x.id === instId);
  const { dialog } = openDialog({ title: inst.description, body: render(), size: 'md' });
  const body = dialog.querySelector('.dialog__body');
  const redraw = () => { const scroll = body.scrollTop; body.innerHTML = render().toString(); body.scrollTop = scroll; };
  body.addEventListener('change', (ev) => {
    const box = ev.target.closest('[data-parcel]');
    if (box) { A.setParcelPaid(instId, Number(box.dataset.parcel), box.checked, todayISO()); redraw(); return; }
    const when = ev.target.closest('[data-paid-date]');
    if (when?.value) { A.setParcelPaid(instId, Number(when.dataset.paidDate), true, when.value); redraw(); }
  });
}

/** Rótulo de categoria (reexportado para as telas). */
export { catText };
