// =============================================================
// investEditors.js — Janelas da tela Investimentos
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog, actionSheet, confirmDialog } from './dialog.js';
import { field, moneyField, dateField, selectField, switchField, textareaField, readForm } from './forms.js';
import { toast } from './toast.js';
import { parsePercent, percentToInput } from './payrollEditor.js';
import { store } from '../core/store.js';
import { toCents, centsToInput, formatBRL } from '../core/money.js';
import { todayISO, formatDateBR } from '../core/dates.js';
import {
  INVEST_TYPES, INVEST_CLASSES, CLASS_KEYS, RATE_KINDS, LIQUIDITY, MOVEMENT_KINDS,
  annualRate, positionAt, investingOf, typeOf, irRate,
} from '../domain/investments.js';
import * as A from '../domain/actions.js';

const data = () => store.data;
const investing = () => investingOf(store.data.settings);
const pctText = (rate) => `${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.a.`;

const INSTITUTIONS = ['Nubank', 'Inter', 'Itaú', 'Bradesco', 'Banco do Brasil', 'Caixa', 'Santander', 'C6 Bank', 'BTG Pactual', 'XP Investimentos', 'Rico', 'Clear', 'NuInvest', 'Mercado Pago', 'PicPay', 'PagBank', 'Tesouro Direto', 'Binance'];

// ---------- Novo / editar investimento ----------

export function editInvestment(inv = null) {
  const isNew = !inv;
  const i = inv || { name: '', type: 'cdb', institution: '', rate: { ...INVEST_TYPES.cdb.rate }, liquidity: INVEST_TYPES.cdb.liquidity, maturity: '', emergency: false, notes: '', ticker: '', pension: '' };
  const typeOptions = CLASS_KEYS.flatMap((cls) => Object.entries(INVEST_TYPES).filter(([, t]) => t.cls === cls)
    .map(([value, t]) => ({ value, label: `${t.icon} ${t.label}` })));

  openDialog({
    title: isNew ? 'Novo investimento' : 'Editar investimento',
    submitLabel: isNew ? 'Adicionar' : 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: i.name, required: true, full: true, placeholder: 'Ex.: CDB Inter 2028, Tesouro Selic, PETR4', extra: { maxlength: 80, autocomplete: 'off' } })}
        ${selectField({ label: 'Tipo', name: 'type', value: i.type, options: typeOptions })}
        ${field({ label: 'Instituição (opcional)', name: 'institution', value: i.institution, placeholder: 'Banco ou corretora', extra: { maxlength: 60, autocomplete: 'off', list: 'inv-institutions' } })}
        <datalist id="inv-institutions">${INSTITUTIONS.map((x) => html`<option value="${x}">`)}</datalist>

        ${selectField({ label: 'Como rende', name: 'rateKind', value: i.rate.kind, options: Object.entries(RATE_KINDS).map(([value, r]) => ({ value, label: r.label })) })}
        <div class="field" data-rate-bp>
          <label class="field__label" for="inv-rate" data-rate-label>Taxa</label>
          <div class="field__control has-prefix">
            <span class="field__prefix" aria-hidden="true">%</span>
            <input class="input" id="inv-rate" name="rateBp" inputmode="decimal" autocomplete="off" value="${i.rate.bp ? percentToInput(i.rate.bp) : ''}">
          </div>
        </div>

        <div class="field" data-ticker>
          <label class="field__label" for="inv-ticker">Código na bolsa (opcional)</label>
          <input class="input" id="inv-ticker" name="ticker" value="${i.ticker || ''}" placeholder="PETR4, HGLG11, BOVA11" maxlength="8" autocapitalize="characters" autocomplete="off">
          <p class="field__hint">Com o código e a quantidade de cotas, o saldo segue a cotação (botão "Atualizar cotações").</p>
        </div>
        <div class="field" data-pension>
          ${selectField({ label: 'Plano de previdência', name: 'pension', value: i.pension || '', options: [{ value: '', label: 'Não é previdência' }, { value: 'pgbl', label: 'PGBL (deduz até 12% da renda no IR)' }, { value: 'vgbl', label: 'VGBL (IR só sobre o rendimento)' }] })}
        </div>
        ${selectField({ label: 'Liquidez (resgate)', name: 'liquidity', value: i.liquidity, options: Object.entries(LIQUIDITY).map(([value, label]) => ({ value, label })) })}
        ${dateField({ label: 'Vencimento (opcional)', name: 'maturity', value: i.maturity || '', required: false })}

        ${isNew ? html`
          ${moneyField({ label: 'Valor já aplicado (opcional)', name: 'initialCents', required: false, hint: 'Vira o primeiro aporte.' })}
          ${dateField({ label: 'Data da aplicação', name: 'initialDate', value: todayISO(), required: false, max: todayISO() })}
          <div class="field" data-qty>
            <label class="field__label" for="inv-qty">Quantidade de cotas (opcional)</label>
            <input class="input" id="inv-qty" name="initialQty" inputmode="decimal" autocomplete="off" placeholder="Ex.: 100">
          </div>` : ''}

        ${switchField({ label: 'Faz parte da reserva de emergência', name: 'emergency', checked: i.emergency, hint: 'Entra no cálculo da Saúde financeira. Use só para algo com liquidez diária.' })}
        ${textareaField({ label: 'Observação', name: 'notes', value: i.notes || '' })}
      </div>
      <div class="preview" data-preview aria-live="polite"></div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      let syncing = false;
      const setSelect = (sel, value) => { syncing = true; sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); syncing = false; };

      const update = () => {
        const kind = form.rateKind.value;
        const needsBp = kind === 'cdi' || kind === 'pre' || kind === 'ipca';
        dlg.querySelector('[data-rate-bp]').hidden = !needsBp;
        const variable = ['acoes', 'fii', 'etf', 'bdr'].includes(form.type.value);
        dlg.querySelector('[data-ticker]').hidden = !variable;
        const qtyField = dlg.querySelector('[data-qty]');
        if (qtyField) qtyField.hidden = !variable;
        dlg.querySelector('[data-pension]').hidden = !/previd/.test(form.type.value);
        dlg.querySelector('[data-rate-label]').textContent = kind === 'cdi' ? 'Percentual do CDI' : kind === 'ipca' ? 'Taxa acima do IPCA (a.a.)' : 'Taxa ao ano';
        const preview = dlg.querySelector('[data-preview]');
        const probe = { type: form.type.value, rate: { kind, bp: parsePercent(form.rateBp.value) || 0 } };
        const rate = annualRate(probe, investing());
        const t = INVEST_TYPES[probe.type] || INVEST_TYPES.outro;
        if (rate == null) {
          preview.innerHTML = html`${icon('info', 'icon--xs')} Sem estimativa automática: use <strong>Atualizar saldo</strong> quando quiser registrar o valor de mercado (ações, FIIs, cripto, fundos…).`.toString();
          return;
        }
        const base = toCents(form.initialCents?.value || '') || positionAt(inv || { movements: [] }, investing()).value || 100000;
        const monthly = Math.round(base * ((1 + rate) ** (1 / 12) - 1));
        const netRate = t.taxed ? rate * (1 - irRate(721)) : rate;
        preview.innerHTML = html`Rende ≈ <strong>${pctText(rate)}</strong>${t.taxed ? html` · líquido de IR ≈ ${pctText(netRate)} (após 2 anos)` : ' · isento de IR'}
          <br><span class="muted">≈ ${formatBRL(monthly)}/mês sobre ${formatBRL(base)}. Premissas: CDI ${percentToInput(investing().cdiBp)}% e IPCA ${percentToInput(investing().ipcaBp)}% (mude em Configurar).</span>`.toString();
      };

      // Trocar o tipo sugere a taxa e a liquidez mais comuns dele
      form.type.addEventListener('change', () => {
        if (syncing) return;
        const t = INVEST_TYPES[form.type.value];
        if (!t) return;
        setSelect(form.rateKind, t.rate.kind);
        form.rateBp.value = t.rate.bp ? percentToInput(t.rate.bp) : '';
        setSelect(form.liquidity, t.liquidity);
        update();
      });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const kind = v.rateKind;
      const needsBp = kind === 'cdi' || kind === 'pre' || kind === 'ipca';
      const initial = v.initialCents ? toCents(v.initialCents) : 0;
      if (v.initialCents && (!Number.isFinite(initial) || initial <= 0)) throw new A.ValidationError('Valor inválido.', 'initialCents');
      A.saveInvestment({
        ...v, id: inv?.id, rateKind: kind, rateBp: needsBp ? parsePercent(v.rateBp) : 0,
        maturity: v.maturity || null, initialCents: initial, initialDate: v.initialDate || todayISO(),
        ticker: v.ticker || '', pension: v.pension || '', initialQty: v.initialQty ? Number(String(v.initialQty).replace(',', '.')) : 0,
      });
      toast(isNew ? 'Investimento adicionado.' : 'Investimento atualizado.');
    },
  });
}

// ---------- Movimentos ----------

const MOVE_TEXT = {
  aporte: { title: (n) => `Aporte em "${n}"`, submit: 'Registrar aporte', done: 'Aporte registrado.' },
  resgate: { title: (n) => `Resgate de "${n}"`, submit: 'Registrar resgate', done: 'Resgate registrado.' },
  provento: { title: (n) => `Provento de "${n}"`, submit: 'Registrar provento', done: 'Provento registrado.' },
  saldo: { title: (n) => `Atualizar saldo de "${n}"`, submit: 'Atualizar', done: 'Saldo atualizado.' },
  venda: { title: (n) => `Venda de "${n}"`, submit: 'Registrar venda', done: 'Venda registrada. Veja o IR em Investimentos → IR nas vendas.' },
};

export function movementDialog(inv, kind = 'aporte') {
  const pos = positionAt(inv, investing(), todayISO(), store.data.settings.quotes);
  const t = MOVE_TEXT[kind];
  openDialog({
    title: t.title(inv.name),
    size: 'sm',
    submitLabel: t.submit,
    body: html`
      <dl class="kv kv--2">
        <div><span>Saldo ${pos.estimated ? 'estimado' : 'atual'}</span><strong class="money">${formatBRL(pos.value)}</strong></div>
        <div><span>Investido</span><strong class="money">${formatBRL(pos.principal)}</strong></div>
      </dl>
      <div class="form-grid">
        ${moneyField({ label: kind === 'saldo' ? 'Saldo total hoje (bruto)' : kind === 'provento' ? 'Valor recebido' : 'Valor', name: 'cents', cents: kind === 'saldo' ? pos.value : null,
          hint: kind === 'saldo' ? 'O valor que aparece no app do banco ou corretora. Corrige a estimativa.'
            : kind === 'provento' ? 'Dividendos, JCP, rendimentos de FII ou cupom de juros que caíram na conta.'
            : kind === 'resgate' ? html`<button type="button" class="link" data-fill="${centsToInput(pos.value)}">Resgatar tudo (${formatBRL(pos.value)})</button>` : '' })}
        ${dateField({ label: 'Data', name: 'date', value: todayISO(), max: todayISO() })}
        ${inv.ticker && ['aporte', 'venda', 'resgate'].includes(kind) ? html`
          <div class="field">
            <label class="field__label" for="mov-qty">Cotas ${kind === 'aporte' ? 'compradas' : 'vendidas'}${pos.qty ? ` (você tem ${pos.qty.toLocaleString('pt-BR')})` : ''}</label>
            <input class="input" id="mov-qty" name="qty" inputmode="decimal" autocomplete="off">
          </div>` : ''}
        ${kind === 'aporte' ? switchField({ label: 'Descontar do saldo do mês', name: 'asExpense', checked: Boolean(store.ui.filters.investAsExpense), hint: 'Lança também um gasto pago na categoria Investimentos, para o Painel mostrar que o dinheiro saiu da conta.' }) : ''}
        ${field({ label: 'Observação (opcional)', name: 'note', full: true, extra: { maxlength: 120, autocomplete: 'off' } })}
      </div>`,
    onMount: (dlg) => {
      dlg.querySelector('[data-fill]')?.addEventListener('click', (ev) => {
        const input = dlg.querySelector('[name="cents"]');
        input.value = ev.currentTarget.dataset.fill;
        input.focus();
      });
    },
    onSubmit: (form) => {
      const value = toCents(form.cents.value);
      if (!Number.isFinite(value) || (kind === 'saldo' ? value < 0 : value <= 0)) throw new A.ValidationError('Informe um valor.', 'cents');
      const asExpense = kind === 'aporte' && form.asExpense.checked;
      const qty = form.qty ? Number(String(form.qty.value).replace(',', '.')) || 0 : 0;
      A.addInvestmentMovement(inv.id, { kind, cents: value, date: form.date.value, note: form.note.value, asExpense, qty });
      if (kind === 'aporte') store.setUI({ filters: { ...store.ui.filters, investAsExpense: asExpense } });
      toast(t.done);
    },
  });
}

/** "Aporte em investimento" a partir do menu Novo / busca rápida: escolhe o investimento antes. */
export function quickMovement(kind = 'aporte') {
  const list = data().investments || [];
  if (!list.length) return editInvestment();
  if (list.length === 1) return movementDialog(list[0], kind);
  actionSheet({
    title: kind === 'aporte' ? 'Aportar em qual investimento?' : 'Qual investimento?',
    actions: [
      ...list.map((inv) => ({ label: inv.name, hint: `${typeOf(inv).label} · ${formatBRL(positionAt(inv, investing()).value)}`, icon: 'coins', run: () => movementDialog(inv, kind) })),
      { label: 'Novo investimento', icon: 'plus', run: () => editInvestment() },
    ],
  });
}

// ---------- Histórico ----------

export function investmentHistory(inv) {
  const render = () => {
    const current = (data().investments || []).find((x) => x.id === inv.id) || inv;
    const pos = positionAt(current, investing());
    const list = [...current.movements].sort((a, b) => b.date.localeCompare(a.date));
    return html`
      <dl class="kv">
        <div><span>Saldo ${pos.estimated ? 'estimado' : ''}</span><strong class="money">${formatBRL(pos.value)}</strong></div>
        <div><span>Investido</span><strong class="money">${formatBRL(pos.principal)}</strong></div>
        <div><span>Rendimento</span><strong class="money ${pos.gain < 0 ? 'neg' : 'pos'}">${pos.gain < 0 ? '−' : '+'}${formatBRL(Math.abs(pos.gain))}</strong></div>
        <div><span>Proventos</span><strong class="money">${formatBRL(pos.income)}</strong></div>
      </dl>
      ${list.length ? html`
        <ul class="mini-list">
          ${list.map((m) => html`
            <li>
              <span>${MOVEMENT_KINDS[m.kind].label} <small class="muted">${formatDateBR(m.date)}${m.note ? ` · ${m.note}` : ''}${m.expenseId ? ' · lançado no mês' : ''}</small></span>
              <span class="money ${m.kind === 'resgate' ? 'neg' : m.kind === 'saldo' ? '' : 'pos'}">${m.kind === 'saldo' ? '= ' : m.kind === 'resgate' ? '−' : '+'}${formatBRL(m.cents)}</span>
              <span class="mini-list__actions">
                <button type="button" class="icon-btn icon-btn--sm" data-del="${m.id}" aria-label="Remover ${MOVEMENT_KINDS[m.kind].label} de ${formatDateBR(m.date)}">${icon('trash-2')}</button>
              </span>
            </li>`)}
        </ul>` : html`<p class="muted">Nenhum movimento ainda.</p>`}`;
  };
  const { dialog } = openDialog({ title: `${typeOf(inv).icon} ${inv.name}`, body: render() });
  dialog.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    const ok = await confirmDialog({ title: 'Remover movimento', message: 'Remover este movimento? O saldo e o rendimento serão recalculados.', confirmLabel: 'Remover', danger: true });
    if (!ok) return;
    try {
      A.deleteInvestmentMovement(inv.id, btn.dataset.del);
      dialog.querySelector('.dialog__body').innerHTML = render().toString();
      toast('Movimento removido.');
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });
}

// ---------- Configurações da carteira ----------

export function investingSettings() {
  const cfg = investing();
  openDialog({
    title: 'Configurar investimentos',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">As taxas são usadas para <strong>estimar</strong> o rendimento da renda fixa. Confira os valores atuais no site do Banco Central ou da sua corretora.</p>
      <div class="form-grid">
        ${percentField('cdi', 'CDI (% ao ano)', cfg.cdiBp, 'Quase igual à Selic.')}
        ${percentField('ipca', 'IPCA (% ao ano)', cfg.ipcaBp, 'Inflação esperada para 12 meses.')}
        ${moneyField({ label: 'Meta de aporte por mês', name: 'monthlyTargetCents', cents: cfg.monthlyTargetCents, required: false, full: true, hint: 'Quanto você quer investir todo mês. Deixe vazio para não usar.' })}
      </div>

      <h3 class="dialog__subtitle">Carteira ideal</h3>
      <p class="field__hint">Quanto de cada classe você quer ter. Os aportes são sugeridos para chegar perto disso, sem vender nada. Deixe vazio para não usar.</p>
      <div class="form-grid form-grid--3">
        ${CLASS_KEYS.map((k) => html`
          <div class="field">
            <label class="field__label" for="target-${k}"><span class="dot" style="background:${INVEST_CLASSES[k].color}"></span> ${INVEST_CLASSES[k].label}</label>
            <div class="field__control has-prefix">
              <span class="field__prefix" aria-hidden="true">%</span>
              <input class="input" id="target-${k}" name="target-${k}" inputmode="numeric" autocomplete="off" value="${cfg.targets[k] || ''}" placeholder="0">
            </div>
          </div>`)}
      </div>
      <p class="preview" data-sum aria-live="polite"></p>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form');
      const sync = () => {
        const total = CLASS_KEYS.reduce((a, k) => a + (Number(form[`target-${k}`].value) || 0), 0);
        const box = dlg.querySelector('[data-sum]');
        box.textContent = total === 0 ? 'Carteira ideal desligada.' : total === 100 ? 'Soma 100% ✓' : `Soma ${total}%: ajuste para 100%.`;
        box.classList.toggle('preview--warn', total !== 0 && total !== 100);
      };
      form.addEventListener('input', sync);
      sync();
    },
    onSubmit: (form) => {
      const targets = Object.fromEntries(CLASS_KEYS.map((k) => {
        const raw = form[`target-${k}`].value.trim();
        const n = raw ? Number(raw.replace(',', '.')) : 0;
        if (raw && (!Number.isInteger(n) || n < 0 || n > 100)) throw new A.ValidationError('Use números inteiros de 0 a 100.', `target-${k}`);
        return [k, n];
      }));
      const monthly = form.monthlyTargetCents.value.trim() ? toCents(form.monthlyTargetCents.value) : 0;
      if (!Number.isFinite(monthly) || monthly < 0) throw new A.ValidationError('Valor inválido.', 'monthlyTargetCents');
      A.saveInvestingSettings({ cdiBp: parsePercent(form.cdi.value), ipcaBp: parsePercent(form.ipca.value), monthlyTargetCents: monthly, targets });
      toast('Configurações salvas.');
    },
  });
}

function percentField(name, label, bp, hint) {
  return html`
    <div class="field">
      <label class="field__label" for="inv-${name}">${label}</label>
      <div class="field__control has-prefix">
        <span class="field__prefix" aria-hidden="true">%</span>
        <input class="input" id="inv-${name}" name="${name}" inputmode="decimal" autocomplete="off" required value="${percentToInput(bp)}">
      </div>
      <p class="field__hint">${hint}</p>
    </div>`;
}

