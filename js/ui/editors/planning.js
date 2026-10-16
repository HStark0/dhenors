// =============================================================
// editors/planning.js — Metas, desejos e envelopes
// =============================================================

import { html } from '../dom.js';
import { icon } from '../icons.js';
import { openDialog } from '../dialog.js';
import { toast } from '../toast.js';
import { confetti } from '../confetti.js';
import { buzz } from '../pay.js';
import { field, moneyField, dateField, selectField, switchField, readForm, catText } from '../forms.js';
import { store } from '../../core/store.js';
import { toCents, formatBRL } from '../../core/money.js';
import { todayISO } from '../../core/dates.js';
import * as A from '../../domain/actions.js';
import { goalProgress } from '../../domain/planning.js';
import { positionAt, investingOf } from '../../domain/investments.js';

const data = () => store.data;
const GOAL_ICONS = ['🎯', '✈️', '🏠', '🚗', '🎓', '💍', '🛡️', '💻', '📱', '🏖️', '👶', '🐷'];

export function iconPicker(name, icons, selected, { svg = false } = {}) {
  const list = icons.includes(selected) ? icons : [selected, ...icons];
  return html`
    <fieldset class="field field--full picker">
      <legend class="field__label">Ícone</legend>
      <div class="emoji-grid">
        ${list.map((e) => html`
          <label class="emoji-opt">
            <input type="radio" name="${name}" value="${e}" ${e === selected ? 'checked' : ''}>
            ${svg && String(e).startsWith('i:') ? html`<span aria-hidden="true">${icon(e.slice(2))}</span>` : html`<span aria-hidden="true">${e}</span>`}<span class="sr-only">${String(e).replace('i:', '')}</span>
          </label>`)}
      </div>
    </fieldset>`;
}

// ---------- Metas ----------

export function editGoal(goal = null) {
  const g = goal || { description: '', targetCents: null, deadline: '', icon: '🎯', emergency: false, investmentIds: [] };
  const invs = data().investments || [];
  const taken = new Map(data().goals.filter((x) => x.id !== goal?.id).flatMap((x) => (x.investmentIds || []).map((id) => [id, x.description])));
  const investing = investingOf(data().settings);
  openDialog({
    title: goal ? 'Editar meta' : 'Nova meta',
    submitLabel: goal ? 'Salvar' : 'Criar meta',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Objetivo', name: 'description', value: g.description, required: true, placeholder: 'Ex.: Reserva de emergência, Viagem', full: true, extra: { maxlength: 120 } })}
        ${moneyField({ label: 'Valor da meta', name: 'targetCents', cents: g.targetCents })}
        ${dateField({ label: 'Prazo (opcional)', name: 'deadline', value: g.deadline || '', required: false, min: todayISO() })}
        ${goal ? '' : moneyField({ label: 'Já guardado (opcional)', name: 'initialCents', required: false, hint: 'Fora dos investimentos ligados abaixo.' })}
        ${switchField({ label: 'É a minha reserva de emergência', name: 'emergency', checked: g.emergency, hint: 'Entra na Saúde financeira. O app não adivinha mais pelo nome.' })}
        ${invs.length ? html`
          <fieldset class="field field--full">
            <legend class="field__label">Ligar a investimentos (o dinheiro da meta está aplicado)</legend>
            <p class="field__hint">O saldo desses investimentos conta como guardado na meta — sem contar em dobro na reserva.</p>
            <div class="check-list">
              ${invs.map((inv) => html`
                <label class="check check--sm ${taken.has(inv.id) ? 'is-disabled' : ''}">
                  <input type="checkbox" name="inv" value="${inv.id}" ${(g.investmentIds || []).includes(inv.id) ? 'checked' : ''} ${taken.has(inv.id) ? 'disabled' : ''}>
                  ${inv.name} <span class="muted">${formatBRL(positionAt(inv, investing, todayISO(), data().settings.quotes).value)}${taken.has(inv.id) ? ` · já na meta "${taken.get(inv.id)}"` : ''}</span>
                </label>`)}
            </div>
          </fieldset>` : ''}
        ${iconPicker('icon', GOAL_ICONS, g.icon)}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveGoal({
        ...v, id: goal?.id, targetCents: toCents(v.targetCents), deadline: v.deadline || null,
        initialCents: v.initialCents ? toCents(v.initialCents) : 0,
        icon: form.querySelector('[name="icon"]:checked')?.value || '🎯',
        emergency: form.emergency.checked,
        investmentIds: [...form.querySelectorAll('[name="inv"]:checked')].map((el) => el.value),
      });
      toast(goal ? 'Meta atualizada.' : 'Meta criada.');
    },
  });
}

export function contributeGoal(goal, withdraw = false) {
  const plan = goalProgress(data(), goal);
  openDialog({
    title: withdraw ? `Retirar de "${goal.description}"` : `Guardar em "${goal.description}"`,
    size: 'sm',
    submitLabel: withdraw ? 'Retirar' : 'Guardar',
    body: html`
      <p class="dialog__text muted">Guardado: ${formatBRL(plan.saved)} de ${formatBRL(goal.targetCents)}
        ${plan.linked ? html` (${formatBRL(plan.linked)} nos investimentos ligados)` : ''}
        ${plan.perMonth ? html` · sugestão: ${formatBRL(plan.perMonth)}/mês` : ''}</p>
      ${moneyField({ label: 'Valor', name: 'cents', cents: !withdraw && plan.perMonth ? plan.perMonth : null })}
      ${dateField({ label: 'Data', name: 'date', value: todayISO() })}`,
    onSubmit: (form) => {
      const value = toCents(form.cents.value);
      if (!Number.isFinite(value) || value <= 0) throw new A.ValidationError('Informe um valor.', 'cents');
      const r = A.addContribution(goal.id, withdraw ? -value : value, form.date.value);
      if (r?.reached) {
        confetti();
        buzz([20, 40, 20]);
        toast(`Meta "${goal.description}" alcançada!`, { duration: 7000 });
      } else toast(withdraw ? 'Retirada registrada.' : 'Valor guardado.');
    },
  });
}

// ---------- Lista de desejos ----------

export function editWish(wish = null) {
  const w = wish || { name: '', targetPriceCents: null, currentPriceCents: null, url: '', goalId: '', priority: 'media' };
  openDialog({
    title: wish ? 'Editar desejo' : 'Novo desejo',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'O que você quer', name: 'name', value: w.name, required: true, full: true, placeholder: 'Ex.: Notebook, Bicicleta', extra: { maxlength: 80 } })}
        ${moneyField({ label: 'Preço-alvo (quanto quer pagar)', name: 'targetPriceCents', cents: w.targetPriceCents, required: false })}
        ${moneyField({ label: 'Preço hoje', name: 'currentPriceCents', cents: w.currentPriceCents, required: false, hint: 'Atualize de vez em quando: o app avisa quando chegar no alvo.' })}
        ${field({ label: 'Link (opcional)', name: 'url', value: w.url, full: true, type: 'url', placeholder: 'https://…' })}
        ${selectField({ label: 'Prioridade', name: 'priority', value: w.priority, options: [{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Média' }, { value: 'baixa', label: 'Baixa' }] })}
        ${selectField({ label: 'Juntar dinheiro na meta', name: 'goalId', value: w.goalId || '', options: [{ value: '', label: 'Nenhuma' }, ...data().goals.map((g) => ({ value: g.id, label: g.description }))] })}
      </div>`,
    onSubmit: (form) => {
      const v = readForm(form);
      A.saveWish({ ...v, id: wish?.id, targetPriceCents: v.targetPriceCents ? toCents(v.targetPriceCents) : 0, currentPriceCents: v.currentPriceCents ? toCents(v.currentPriceCents) : 0 });
      toast('Desejo salvo.');
    },
  });
}

// ---------- Envelopes ----------

export function editEnvelope(env = null) {
  const e = env || { name: '', icon: '🫙', monthlyCents: null, categoryIds: [], rollover: true };
  const used = new Map((data().settings.envelopes || []).filter((x) => x.id !== env?.id).flatMap((x) => x.categoryIds.map((id) => [id, x.name])));
  openDialog({
    title: env ? 'Editar envelope' : 'Novo envelope',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Logo depois do salário, separe o dinheiro do mês em "potes". Os gastos das categorias escolhidas saem deste pote.</p>
      <div class="form-grid">
        ${field({ label: 'Nome do pote', name: 'name', value: e.name, required: true, placeholder: 'Ex.: Mercado, Lazer', extra: { maxlength: 40 } })}
        ${moneyField({ label: 'Valor por mês', name: 'monthlyCents', cents: e.monthlyCents })}
        ${switchField({ label: 'O que sobrar passa para o mês seguinte', name: 'rollover', checked: e.rollover })}
        <fieldset class="field field--full">
          <legend class="field__label">Categorias que saem deste pote</legend>
          <div class="check-list check-list--cols">
            ${data().categories.map((c) => html`
              <label class="check check--sm ${used.has(c.id) ? 'is-disabled' : ''}"><input type="checkbox" name="cat" value="${c.id}" ${e.categoryIds.includes(c.id) ? 'checked' : ''} ${used.has(c.id) ? 'disabled' : ''}> ${catText(c)}${used.has(c.id) ? html` <span class="muted">(em ${used.get(c.id)})</span>` : ''}</label>`)}
          </div>
        </fieldset>
      </div>`,
    onSubmit: (form) => {
      A.saveEnvelope({
        id: env?.id, name: form.name.value, icon: e.icon, monthlyCents: toCents(form.monthlyCents.value),
        rollover: form.rollover.checked, categoryIds: [...form.querySelectorAll('[name="cat"]:checked')].map((x) => x.value),
      });
      toast('Envelope salvo.');
    },
  });
}
