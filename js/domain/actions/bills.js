// =============================================================
// actions/bills.js — Contas avulsas, recorrentes, parcelamentos,
// pagamento, ações em lote, contas a receber e dívidas
// =============================================================

import { store } from '../../core/store.js';
import { MAX_CENTS } from '../../core/money.js';
import { isValidYM, ymOf, todayISO, currentYM, monthsBetween, addMonthsYM } from '../../core/dates.js';
import { newId } from '../schema.js';
import { planInstallment, FREQ_DAYS, recurringDates } from '../ledger.js';
import { invoiceKey } from '../cards.js';
import {
  ValidationError, text, cents, date, intRange, refs, splits, assertOpen, findOrThrow, entry, cleanupEntry, tags,
} from './core.js';

const accountRef = (d, id) => ((d.accounts || []).some((a) => a.id === id) ? id : null);

// ---------- Despesas avulsas ----------

export function saveExpense(input) {
  return store.commit((d) => {
    const value = cents(input.cents, 'cents');
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: value,
      dueDate: date(input.dueDate, 'dueDate'),
      paidAt: input.paid ? date(input.paidAt || input.dueDate, 'paidAt') : null,
      ...refs(d, input),
      accountId: accountRef(d, input.accountId),
      splits: splits(d, input.splits, value),
    };
    if (input.boleto) item.boleto = { line: String(input.boleto.line || '').replace(/\D/g, '').slice(0, 60), bank: String(input.boleto.bank || '').slice(0, 40) };
    if (input.pix) item.pix = { key: String(input.pix.key || '').slice(0, 120), name: String(input.pix.name || '').slice(0, 60), city: String(input.pix.city || '').slice(0, 40) };
    if (Array.isArray(input.attachments)) item.attachments = cleanAttachments(input.attachments);
    assertOpen(d, ymOf(item.dueDate));
    if (input.id) {
      const current = findOrThrow(d.expenses, input.id, 'Despesa');
      assertOpen(d, ymOf(current.dueDate));
      Object.assign(current, item);
      return current;
    }
    const created = { id: newId(), attachments: [], ...item };
    d.expenses.push(created);
    return created;
  });
}

export function deleteExpense(id) {
  return store.commit((d) => {
    const current = findOrThrow(d.expenses, id, 'Despesa');
    assertOpen(d, ymOf(current.dueDate));
    d.expenses = d.expenses.filter((x) => x.id !== id);
    return current;
  }, 'change', { undo: 'Conta excluída' });
}

/** Adia uma despesa avulsa para outra data. */
export function postponeExpense(id, newDate) {
  return store.commit((d) => {
    const current = findOrThrow(d.expenses, id, 'Despesa');
    assertOpen(d, ymOf(current.dueDate));
    date(newDate, 'dueDate');
    assertOpen(d, ymOf(newDate));
    current.dueDate = newDate;
  }, 'change', { undo: 'Conta adiada' });
}

/** Resumo dos anexos guardado no lançamento; `k` é a chave do arquivo cifrado na nuvem. */
const cleanAttachments = (list) => list.slice(0, 10).map((a) => ({
  id: a.id, name: String(a.name || 'anexo').slice(0, 120), type: String(a.type || '').slice(0, 80), size: Number(a.size) || 0,
  ...(typeof a.k === 'string' ? { k: a.k } : {}),
}));

/** Anexos de uma despesa (os arquivos ficam cifrados na nuvem: ver ui/attachments.js). */
export function setExpenseAttachments(id, attachments) {
  return store.commit((d) => {
    const e = findOrThrow(d.expenses, id, 'Despesa');
    e.attachments = cleanAttachments(attachments);
  });
}

// ---------- Recorrentes ----------

const FREQS = ['monthly', 'weekly', 'biweekly', 'bimonthly', 'quarterly', 'semiannual', 'annual'];

export function saveRecurring(input) {
  return store.commit((d) => applyRecurring(d, input));
}

/**
 * Cadastra várias recorrentes de uma vez, num commit só: se uma
 * falhar, nenhuma é salva (o erro leva `index` = posição na lista).
 */
export function saveRecurringMany(inputs) {
  return store.commit((d) => inputs.map((input, index) => {
    try { return applyRecurring(d, input); } catch (err) { err.index = index; throw err; }
  }));
}

/**
 * Edita uma recorrente cujo VALOR mudou, escolhendo o alcance:
 *   'month'  → só no mês `ym`: o cadastro fica com o valor antigo e o mês
 *              ganha o valor novo (como "Ajustar este mês")
 *   'future' → de `ym` em diante: meses anteriores ainda em aberto
 *              continuam com o valor antigo
 *   'open'   → todos os meses em aberto (não pagos) passam ao valor
 *              novo, inclusive os que tinham um valor ajustado à mão
 * Meses pagos nunca mudam (o valor pago fica fixado); meses fechados
 * também não.
 */
export function saveRecurringScoped(input, scope, ym) {
  return store.commit((d) => {
    const current = findOrThrow(d.recurring, input.id, 'Recorrente');
    const oldCents = current.cents;
    const newCents = cents(input.cents, 'cents');
    if (!isValidYM(ym)) throw new ValidationError('Mês inválido.', 'cents');
    if (scope === 'month') {
      const saved = applyRecurring(d, { ...input, cents: oldCents });
      if (FREQ_DAYS[saved.freq]) throw new ValidationError('Nas semanais/quinzenais, ajuste o valor de cada data na lista de contas.', 'cents');
      if (!recurringDates(saved, ym).length) throw new ValidationError(`Esta recorrente não vence em ${ym.slice(5)}/${ym.slice(0, 4)}.`, 'cents');
      assertOpen(d, ym, 'cents');
      const [key, e] = entry(d, saved.id, ym);
      if (!e.paidAt) e.cents = newCents;
      cleanupEntry(d, key);
      return saved;
    }
    const saved = applyRecurring(d, input);
    const prefix = `${saved.id}|`;
    if (scope === 'future') {
      // fixa o valor antigo nos meses anteriores ainda sem valor próprio
      pinOldValueBefore(d, saved, oldCents, ym);
    } else if (scope === 'open') {
      for (const [key, e] of Object.entries(d.recurringEntries)) {
        if (!key.startsWith(prefix) || e.paidAt || e.cents == null) continue;
        if (d.closedMonths[key.slice(prefix.length, prefix.length + 7)]) continue;
        e.cents = null;
        cleanupEntry(d, key);
      }
    }
    return saved;
  });
}

/**
 * Fixa o valor antigo nos meses anteriores a `ym` ainda em aberto e sem
 * valor próprio, para que trocar o valor do cadastro só valha de `ym` em
 * diante (meses fechados e pagos não mudam de qualquer forma).
 */
function pinOldValueBefore(d, rec, oldCents, ym) {
  let guard = 0;
  for (let m = rec.startYM; m < ym && guard < 600; m = addMonthsYM(m, 1), guard++) {
    if (d.closedMonths[m]) continue;
    for (const due of recurringDates(rec, m)) {
      const [key, e] = entry(d, rec.id, FREQ_DAYS[rec.freq] ? due : m);
      if (!e.paidAt && !e.skipped && e.cents == null) e.cents = oldCents;
      cleanupEntry(d, key);
    }
  }
}

function applyRecurring(d, input) {
  {
    const freq = FREQS.includes(input.freq) ? input.freq : 'monthly';
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      cents: cents(input.cents, 'cents'),
      dueDay: intRange(input.dueDay, 'dueDay', 1, 31, 'O dia de vencimento'),
      startYM: isValidYM(input.startYM) ? input.startYM : (() => { throw new ValidationError('Mês de início inválido.', 'startYM'); })(),
      endYM: input.endYM ? (isValidYM(input.endYM) ? input.endYM : (() => { throw new ValidationError('Mês final inválido.', 'endYM'); })()) : null,
      ...refs(d, input),
      freq,
      anchorDate: FREQ_DAYS[freq] ? date(input.anchorDate || `${input.startYM}-${String(input.dueDay).padStart(2, '0')}`, 'anchorDate') : null,
      variable: Boolean(input.variable),
      subscription: Boolean(input.subscription),
      renewal: date(input.renewal, 'renewal', { required: false }),
      adjust: input.adjust?.index && ['ipca', 'igpm', 'fixo'].includes(input.adjust.index)
        ? { index: input.adjust.index, month: intRange(input.adjust.month, 'adjustMonth', 1, 12, 'O mês do reajuste'), pctBp: input.adjust.index === 'fixo' ? intRange(input.adjust.pctBp ?? 0, 'adjustPct', 0, 10000, 'O percentual') : 0, lastYM: input.adjust.lastYM || null }
        : null,
      accountId: accountRef(d, input.accountId),
      cardId: (d.cards || []).some((c) => c.id === input.cardId) ? input.cardId : null,
    };
    if (item.endYM && item.endYM < item.startYM) throw new ValidationError('O fim deve ser depois do início.', 'endYM');
    if (input.id) {
      const current = findOrThrow(d.recurring, input.id, 'Recorrente');
      // Histórico de preço: assinaturas e reajustes guardam cada mudança de valor
      const history = current.priceHistory?.length ? current.priceHistory : [{ date: `${current.startYM}-01`, cents: current.cents }];
      if (current.cents !== item.cents) history.push({ date: todayISO(), cents: item.cents });
      Object.assign(current, item, { priceHistory: history.slice(-50) });
      return current;
    }
    const created = { id: newId(), ...item, priceHistory: [{ date: todayISO(), cents: item.cents }] };
    d.recurring.push(created);
    return created;
  }
}

/** Encerra a recorrente: deixa de aparecer a partir do mês seguinte a `lastYM`. */
export function endRecurring(id, lastYM = currentYM()) {
  return store.commit((d) => {
    const rec = findOrThrow(d.recurring, id, 'Recorrente');
    rec.endYM = lastYM < rec.startYM ? rec.startYM : lastYM;
  }, 'change', { undo: 'Recorrente encerrada' });
}

export function resumeRecurring(id) {
  return store.commit((d) => { findOrThrow(d.recurring, id, 'Recorrente').endYM = null; });
}

/** Apaga a recorrente e todo o histórico de pagamentos dela. */
export function deleteRecurring(id) {
  return store.commit((d) => {
    findOrThrow(d.recurring, id, 'Recorrente');
    d.recurring = d.recurring.filter((r) => r.id !== id);
    for (const key of Object.keys(d.recurringEntries)) {
      if (key.startsWith(`${id}|`)) delete d.recurringEntries[key];
    }
  }, 'change', { undo: 'Recorrente excluída' });
}

/** Ajusta o valor só deste mês (ex.: conta de luz variou). null = volta ao padrão/estimativa. */
export function setRecurringMonthAmount(id, ymOrDate, value) {
  return store.commit((d) => {
    findOrThrow(d.recurring, id, 'Recorrente');
    assertOpen(d, ymOf(ymOrDate.length === 7 ? `${ymOrDate}-01` : ymOrDate), 'cents');
    const [key, e] = entry(d, id, ymOrDate);
    e.cents = value == null ? null : cents(value, 'cents');
    cleanupEntry(d, key);
  });
}

/** Pula a recorrente só neste mês (ou nesta data, nas semanais). */
export function skipRecurringMonth(id, ymOrDate, skipped = true) {
  return store.commit((d) => {
    findOrThrow(d.recurring, id, 'Recorrente');
    assertOpen(d, ymOrDate.slice(0, 7));
    const [key, e] = entry(d, id, ymOrDate);
    e.skipped = skipped;
    if (skipped) e.paidAt = null;
    cleanupEntry(d, key);
  });
}

/**
 * Reajuste automático (aluguel pelo IGP-M/IPCA no mês do aniversário).
 * Roda ao abrir o app: no mês do reajuste, aplica o índice acumulado em
 * 12 meses (settings.indices) ou o % fixo. Cada recorrente reajusta
 * uma vez por ano. → [{ id, description, from, to, pctBp }]
 */
export function applyReadjustments(today = todayISO()) {
  const ym = ymOf(today);
  const m = Number(ym.slice(5));
  const pending = (store.data.recurring || []).filter((r) => r.adjust && r.adjust.month === m && r.adjust.lastYM !== ym
    && r.startYM < ym && (!r.endYM || r.endYM >= ym) && monthsBetween(r.startYM, ym) >= 11);
  if (!pending.length) return [];
  return store.commit((d) => {
    const out = [];
    const idx = d.settings.indices || {};
    for (const r of d.recurring) {
      if (!pending.some((p) => p.id === r.id)) continue;
      const pctBp = r.adjust.index === 'fixo' ? r.adjust.pctBp : r.adjust.index === 'igpm' ? idx.igpm12Bp ?? 0 : idx.ipca12Bp ?? 0;
      const from = r.cents;
      // índice negativo (deflação do IGP-M) não reduz o valor sem você decidir
      const to = Math.max(from, Math.round(from * (1 + pctBp / 10000)));
      // o reajuste vale do mês do aniversário em diante: meses anteriores ainda
      // não pagos continuam com o valor antigo (como o alcance 'future' ao editar).
      // Nas variáveis o valor vem da média dos meses, não do cadastro.
      if (to !== from && !r.variable) pinOldValueBefore(d, r, from, ym);
      r.cents = Math.min(MAX_CENTS, to);
      r.adjust = { ...r.adjust, lastYM: ym };
      r.priceHistory = [...(r.priceHistory || []), { date: today, cents: r.cents }].slice(-50);
      out.push({ id: r.id, description: r.description, from, to: r.cents, pctBp });
    }
    return out;
  });
}

// ---------- Parcelamentos ----------

/**
 * Salva um parcelamento informando:
 *   parcelCents  valor de cada parcela
 *   count        nº de parcelas
 *   paidCount    quantas já foram pagas
 *   nextDueDate  vencimento da próxima parcela a pagar
 * O total, a data da 1ª e da última parcela são calculados (planInstallment).
 * `keepTotalCents` preserva o total original na edição (quando a parcela não mudou).
 */
export function saveInstallment(input) {
  return store.commit((d) => {
    const count = intRange(input.count, 'count', 1, 420, 'O número de parcelas');
    const parcelCents = cents(input.parcelCents, 'parcelCents');
    const paidCount = intRange(input.paidCount ?? 0, 'paidCount', 0, count, 'Parcelas já pagas');
    const nextDueDate = date(input.nextDueDate, 'nextDueDate');
    const dueDay = intRange(input.dueDay ?? Number(nextDueDate.slice(8, 10)), 'dueDay', 1, 31, 'O dia de vencimento');
    const plan = planInstallment({ parcelCents, count, paidCount, nextDueDate, dueDay });

    const item = {
      description: text(input.description, 'description', 'a descrição'),
      totalCents: Number.isInteger(input.keepTotalCents) ? input.keepTotalCents : plan.totalCents,
      count,
      firstDueDate: plan.firstDueDate,
      dueDay: plan.dueDay,
      ...refs(d, input),
    };
    if (item.totalCents > MAX_CENTS) throw new ValidationError('Valor total alto demais.', 'parcelCents');
    const firstN = Array.from({ length: paidCount }, (_, i) => i + 1);

    if (input.id) {
      const current = findOrThrow(d.installments, input.id, 'Parcelamento');
      // Mantém marcações individuais (e as datas reais) se a quantidade paga não mudou
      const keepPaid = current.paid.length === paidCount && current.paid.every((n) => n <= count);
      Object.assign(current, item);
      current.paid = keepPaid ? current.paid : firstN;
      if (!keepPaid) current.paidOn = Object.fromEntries(Object.entries(current.paidOn || {}).filter(([n]) => current.paid.includes(Number(n))));
      return current;
    }
    const created = { id: newId(), ...item, paid: firstN, paidOn: {} };
    d.installments.push(created);
    return created;
  });
}

export function deleteInstallment(id) {
  return store.commit((d) => {
    findOrThrow(d.installments, id, 'Parcelamento');
    d.installments = d.installments.filter((x) => x.id !== id);
  }, 'change', { undo: 'Parcelamento excluído' });
}

/** Marca/desmarca UMA parcela específica, guardando a data REAL do pagamento. */
export function setParcelPaid(id, n, paid, paidAt = todayISO()) {
  return store.commit((d) => markParcel(d, id, n, paid, paidAt));
}

function markParcel(d, id, n, paid, paidAt) {
  const inst = findOrThrow(d.installments, id, 'Parcelamento');
  const set = new Set(inst.paid);
  inst.paidOn ||= {};
  if (paid) { set.add(n); inst.paidOn[n] = date(paidAt, 'paidAt'); } else { set.delete(n); delete inst.paidOn[n]; }
  inst.paid = [...set].filter((x) => x >= 1 && x <= inst.count).sort((a, b) => a - b);
}

// ---------- Pagar / desfazer (qualquer item do mês) ----------

/**
 * Marca um item do mês como pago (ou desfaz).
 * `item` vem de ledger.monthItems(). opts: { cents, accountId } — valor
 * realmente pago (recorrentes/faturas) e conta de onde saiu.
 */
export function setItemPaid(item, paid, paidAt = todayISO(), opts = {}) {
  return store.commit((d) => markItem(d, item, paid, paidAt, opts));
}

function markItem(d, item, paid, paidAt, { cents: value = null, accountId } = {}) {
  if (paid) date(paidAt, 'paidAt');
  if (item.kind === 'expense') {
    const e = findOrThrow(d.expenses, item.refId, 'Despesa');
    e.paidAt = paid ? paidAt : null;
    if (accountId !== undefined) e.accountId = accountRef(d, accountId);
    return;
  }
  if (item.kind === 'recurring') {
    const rec = findOrThrow(d.recurring, item.refId, 'Recorrente');
    const k = item.entryKey ? item.entryKey.split('|')[1] : ymOf(item.dueDate);
    const [key, e] = entry(d, item.refId, k);
    e.paidAt = paid ? paidAt : null;
    // Fixa o valor pago: editar a recorrente depois não altera meses já pagos
    if (paid) e.cents = Number.isInteger(value) && value > 0 ? value : (e.cents ?? item.cents ?? rec.cents);
    else if (rec.variable && e.cents === item.cents && item.estimated) e.cents = null;
    cleanupEntry(d, key);
    return;
  }
  if (item.kind === 'installment') {
    markParcel(d, item.refId, item.parcel.n, paid, paidAt);
    return;
  }
  if (item.kind === 'invoice') {
    const key = invoiceKey(item.refId, ymOf(item.dueDate));
    d.cardInvoices ||= {};
    // Guarda o valor pago: mexer depois numa compra ou assinatura não muda uma fatura já paga
    if (paid) d.cardInvoices[key] = { paidAt, cents: Number.isInteger(value) && value > 0 ? value : item.cents > 0 ? item.cents : null };
    else delete d.cardInvoices[key];
    return;
  }
  throw new ValidationError('Tipo de item desconhecido.');
}

// ---------- Ações em lote ----------

/** Marca vários itens como pagos (ou não) de uma vez. */
export function setItemsPaid(items, paid, paidAt = todayISO()) {
  return store.commit((d) => {
    for (const item of items) markItem(d, item, paid, paidAt);
    return items.length;
  }, 'change', { undo: paid ? `${items.length} contas marcadas como pagas` : `${items.length} pagamentos desfeitos` });
}

/** Muda a categoria de vários itens (avulsas, recorrentes, parcelamentos e compras no cartão). */
export function setItemsCategory(items, categoryId, subcategoryId = null) {
  return store.commit((d) => {
    const cat = d.categories.find((c) => c.id === categoryId);
    const sub = cat?.subcategories.some((s) => s.id === subcategoryId) ? subcategoryId : null;
    const lists = { expense: d.expenses, recurring: d.recurring, installment: d.installments, purchase: d.cardPurchases };
    let n = 0;
    for (const item of items) {
      const target = lists[item.kind]?.find((x) => x.id === item.refId);
      if (!target) continue;
      target.categoryId = cat?.id || null;
      target.subcategoryId = sub;
      if (target.splits) target.splits = [];
      n++;
    }
    return n;
  }, 'change', { undo: 'Categoria alterada' });
}

/** Acrescenta etiquetas a vários itens. */
export function addItemsTags(items, newTags) {
  return store.commit((d) => {
    const add = tags(newTags);
    const lists = { expense: d.expenses, recurring: d.recurring, installment: d.installments, purchase: d.cardPurchases };
    for (const item of items) {
      const target = lists[item.kind]?.find((x) => x.id === item.refId);
      if (target) target.tags = [...new Set([...(target.tags || []), ...add])].slice(0, 12);
    }
  }, 'change', { undo: 'Etiquetas adicionadas' });
}

/**
 * Exclui vários itens: avulsas são apagadas; recorrentes são PULADAS só
 * naquele mês; parcelas e faturas não são apagadas por aqui.
 */
export function deleteItems(items) {
  return store.commit((d) => {
    let n = 0;
    for (const item of items) {
      if (item.kind === 'expense') {
        const e = d.expenses.find((x) => x.id === item.refId);
        if (!e) continue;
        assertOpen(d, ymOf(e.dueDate));
        d.expenses = d.expenses.filter((x) => x.id !== item.refId);
        n++;
      } else if (item.kind === 'recurring') {
        assertOpen(d, ymOf(item.dueDate));
        const [, e] = entry(d, item.refId, item.entryKey ? item.entryKey.split('|')[1] : ymOf(item.dueDate));
        e.skipped = true;
        e.paidAt = null;
        n++;
      }
    }
    return n;
  }, 'change', { undo: 'Itens excluídos' });
}

// ---------- Contas a receber ("quem me deve") ----------

export function saveReceivable(input) {
  return store.commit((d) => {
    const cred = d.creditors.find((c) => c.id === input.creditorId);
    const item = {
      creditorId: cred?.id || null,
      person: cred ? cred.name : text(input.person, 'person', 'quem deve', { max: 80 }),
      description: text(input.description || 'Empréstimo', 'description', 'a descrição', { max: 120 }),
      cents: cents(input.cents, 'cents'),
      date: date(input.date, 'date'),
      dueDate: date(input.dueDate, 'dueDate', { required: false }),
      notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }),
    };
    if (input.id) { Object.assign(findOrThrow(d.receivables, input.id, 'Valor a receber'), item); return null; }
    const created = { id: newId(), ...item, receivedAt: null, partials: [] };
    d.receivables.push(created);
    return created;
  });
}

/** Registra um recebimento (parcial ou total). Quitou → receivedAt. */
export function receivePayment(id, value, when = todayISO()) {
  return store.commit((d) => {
    const r = findOrThrow(d.receivables, id, 'Valor a receber');
    const v = cents(value, 'cents');
    const paid = (r.partials || []).reduce((a, p) => a + p.cents, 0);
    if (paid + v > r.cents) throw new ValidationError('O valor é maior que o que falta receber.', 'cents');
    r.partials = [...(r.partials || []), { id: newId(), date: date(when, 'date'), cents: v }];
    if (paid + v === r.cents) r.receivedAt = when;
  });
}

export function reopenReceivable(id) {
  return store.commit((d) => { const r = findOrThrow(d.receivables, id, 'Valor a receber'); r.receivedAt = null; r.partials = []; });
}

export function deleteReceivable(id) {
  return store.commit((d) => { d.receivables = d.receivables.filter((x) => x.id !== id); }, 'change', { undo: 'Valor a receber excluído' });
}

// ---------- Dívidas e renegociações ----------

export function saveDebt(input) {
  return store.commit((d) => {
    const item = {
      name: text(input.name, 'name', 'o nome da dívida', { max: 80 }),
      creditorId: d.creditors.some((c) => c.id === input.creditorId) ? input.creditorId : null,
      balanceCents: cents(input.balanceCents, 'balanceCents', { allowZero: true }),
      rateMonthlyBp: intRange(input.rateMonthlyBp ?? 0, 'rate', 0, 5000, 'Os juros ao mês (em centésimos de %)'),
      paymentCents: cents(input.paymentCents ?? 0, 'paymentCents', { allowZero: true }),
      notes: text(input.notes, 'notes', 'a observação', { max: 500, required: false }),
      installmentId: d.installments.some((x) => x.id === input.installmentId) ? input.installmentId : null,
    };
    if (input.id) { Object.assign(findOrThrow(d.debts, input.id, 'Dívida'), item); return null; }
    const created = { id: newId(), ...item };
    d.debts.push(created);
    return created;
  });
}

export function deleteDebt(id) {
  return store.commit((d) => { d.debts = d.debts.filter((x) => x.id !== id); }, 'change', { undo: 'Dívida excluída' });
}
