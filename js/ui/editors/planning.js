// =============================================================
// editors/planning.js — Reservas, desejos e envelopes
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
import { goalProgress, goalTarget } from '../../domain/planning.js';
import { GOAL_KINDS } from '../../domain/goals.js';
import { positionAt, investingOf } from '../../domain/investments.js';

const data = () => store.data;
const GOAL_ICONS = ['i:shield', 'i:shopping-bag', 'i:coins', 'i:piggy-bank', 'i:plane', 'i:graduation-cap', 'i:tree-palm', 'i:target', 'i:house', 'i:car', 'i:heart', 'i:laptop', 'i:smartphone', 'i:baby', 'i:gift', 'i:trophy'];

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

// ---------- Reservas (antigas "Metas") ----------

/** Escolha do tipo da reserva (ver GOAL_KINDS em domain/goals.js). */
function kindPicker(selected, locked) {
  return html`
    <fieldset class="field field--full picker">
      <legend class="field__label">Para que é esta reserva?</legend>
      <div class="kind-grid">
        ${GOAL_KINDS.map((k) => html`
          <label class="kind-opt">
            <input type="radio" name="kind" value="${k.id}" ${k.id === selected ? 'checked' : ''} ${locked && k.id !== selected ? 'disabled' : ''}>
            <span><span class="kind-opt__icon" aria-hidden="true">${icon(k.icon.slice(2))}</span><strong>${k.label}</strong><small>${k.hint}</small></span>
          </label>`)}
      </div>
      ${locked ? html`<p class="field__hint">A Reserva de emergência é padrão em toda conta: o tipo não muda e ela não pode ser excluída.</p>` : ''}
    </fieldset>`;
}

export function editGoal(goal = null, preset = {}) {
  const g = goal || { description: '', kind: 'compra', targetCents: null, autoTarget: false, deadline: '', icon: 'i:shopping-bag', investmentIds: [], ...preset };
  const invs = data().investments || [];
  const taken = new Map(data().goals.filter((x) => x.id !== goal?.id).flatMap((x) => (x.investmentIds || []).map((id) => [id, x.description])));
  const investing = investingOf(data().settings);
  const autoNow = goalTarget(data(), { ...g, autoTarget: true });
  openDialog({
    title: goal ? 'Editar reserva' : 'Nova reserva',
    submitLabel: goal ? 'Salvar' : 'Criar reserva',
    body: html`
      <div class="form-grid">
        ${kindPicker(g.kind || (g.emergency ? 'emergencia' : 'outro'), Boolean(g.system))}
        ${field({ label: 'Nome', name: 'description', value: g.description, required: true, placeholder: 'Ex.: Carro novo, Viagem de férias', full: true, extra: { maxlength: 120 } })}
        <div class="field field--full" data-show="emergencia">
          ${switchField({ label: 'Calcular o alvo sozinho', name: 'autoTarget', checked: g.autoTarget, hint: `6 meses dos seus gastos${autoNow ? `: hoje, ${formatBRL(autoNow)}` : ' (aparece quando houver gastos lançados)'}. Atualiza sozinho.` })}
        </div>
        <div data-target>${moneyField({ label: 'Valor alvo', name: 'targetCents', cents: g.autoTarget ? null : g.targetCents, required: false })}</div>
        <div data-hide="mensal">${dateField({ label: 'Prazo (opcional)', name: 'deadline', value: g.deadline || '', required: false, min: todayISO() })}</div>
        ${goal ? '' : moneyField({ label: 'Já guardado (opcional)', name: 'initialCents', required: false, hint: 'Fora dos investimentos ligados abaixo.' })}
        ${invs.length ? html`
          <fieldset class="field field--full">
            <legend class="field__label">Ligar a investimentos (o dinheiro da reserva está aplicado)</legend>
            <p class="field__hint">O saldo desses investimentos conta como guardado na reserva, sem contar em dobro.</p>
            <div class="check-list">
              ${invs.map((inv) => html`
                <label class="check check--sm ${taken.has(inv.id) ? 'is-disabled' : ''}">
                  <input type="checkbox" name="inv" value="${inv.id}" ${(g.investmentIds || []).includes(inv.id) ? 'checked' : ''} ${taken.has(inv.id) ? 'disabled' : ''}>
                  <span class="stack-text"><span>${inv.name}</span>
                    <small class="muted">${formatBRL(positionAt(inv, investing, todayISO(), data().settings.quotes).value)}${taken.has(inv.id) ? ` · já na reserva "${taken.get(inv.id)}"` : ''}</small></span>
                </label>`)}
            </div>
          </fieldset>` : ''}
        ${iconPicker('icon', GOAL_ICONS, g.icon, { svg: true })}
      </div>`,
    onMount: (dlg) => {
      const form = dlg.querySelector('form') || dlg;
      const sync = (ev) => {
        const kind = form.querySelector('[name="kind"]:checked')?.value || 'outro';
        const auto = kind === 'emergencia' && form.querySelector('[name="autoTarget"]')?.checked;
        form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== kind; });
        form.querySelectorAll('[data-hide]').forEach((el) => { el.hidden = el.dataset.hide === kind; });
        const target = form.querySelector('[data-target]');
        target.hidden = auto;
        const label = target.querySelector('.field__label');
        if (label) label.textContent = kind === 'mensal' ? 'Quanto guardar por mês' : 'Valor alvo';
        // trocou o tipo: o ícone acompanha (se ainda era o ícone de um tipo)
        if (ev?.target?.name === 'kind') {
          const icon = GOAL_KINDS.find((k) => k.id === kind)?.icon;
          const current = form.querySelector('[name="icon"]:checked')?.value;
          if (icon && (!current || GOAL_KINDS.some((k) => k.icon === current))) {
            const opt = form.querySelector(`[name="icon"][value="${icon}"]`);
            if (opt) opt.checked = true;
          }
        }
      };
      form.addEventListener('change', sync);
      sync();
    },
    onSubmit: (form) => {
      const v = readForm(form);
      const kind = form.querySelector('[name="kind"]:checked')?.value || 'outro';
      const autoTarget = kind === 'emergencia' && Boolean(form.autoTarget?.checked);
      const targetCents = autoTarget ? 0 : toCents(v.targetCents || '');
      if (!autoTarget && !(targetCents > 0)) throw new A.ValidationError(kind === 'mensal' ? 'Informe quanto guardar por mês.' : 'Informe o valor alvo.', 'targetCents');
      A.saveGoal({
        description: v.description, id: goal?.id, kind, autoTarget, targetCents,
        deadline: kind === 'mensal' ? null : v.deadline || null,
        initialCents: v.initialCents ? toCents(v.initialCents) : 0,
        icon: form.querySelector('[name="icon"]:checked')?.value || 'i:target',
        investmentIds: [...form.querySelectorAll('[name="inv"]:checked')].map((el) => el.value),
      });
      toast(goal ? 'Reserva atualizada.' : 'Reserva criada.');
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
      <p class="dialog__text muted">${plan.monthly ? `Neste mês: ${formatBRL(plan.monthSaved)} de ${formatBRL(plan.target)}` : `Guardado: ${formatBRL(plan.saved)}${plan.target ? ` de ${formatBRL(plan.target)}` : ''}`}
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
        toast(`Reserva "${goal.description}" completa!`, { duration: 7000 });
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
        ${selectField({ label: 'Juntar dinheiro na reserva', name: 'goalId', value: w.goalId || '', options: [{ value: '', label: 'Nenhuma' }, ...data().goals.map((g) => ({ value: g.id, label: g.description }))] })}
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
  const e = env || { name: '', icon: 'i:inbox', monthlyCents: null, categoryIds: [], rollover: true };
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
