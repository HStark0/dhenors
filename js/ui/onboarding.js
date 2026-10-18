// =============================================================
// onboarding.js — Primeiros passos em etapas (conta nova)
// -------------------------------------------------------------
// Etapas: 1 salário · 2 contas fixas · 3 cartão · 4 meta.
// Dá para pular qualquer uma; o Painel mostra o checklist
// "Complete seu perfil" com o que faltou.
// (Os dados de exemplo agora são o que o visitante vê antes de entrar:
// ver core/store.js.)
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { field, moneyField, numberField, readForm } from './forms.js';
import { store } from '../core/store.js';
import { toCents } from '../core/money.js';
import { currentYM } from '../core/dates.js';
import * as A from '../domain/actions.js';

/** Checklist "Complete seu perfil" (Painel). */
export function profileChecklist(d) {
  const steps = d.settings.onboardingSteps || {};
  const list = [
    { id: 'salary', label: 'Cadastrar o salário', done: d.settings.salaryHistory.length > 0, href: '#/salario', act: null },
    { id: 'bills', label: 'Lançar as contas fixas', done: d.recurring.length > 0 || steps.bills, href: null, act: 'onb:bills' },
    { id: 'card', label: 'Cadastrar o cartão de crédito', done: (d.cards || []).length > 0 || steps.card, href: null, act: 'onb:card' },
    { id: 'goal', label: 'Criar uma meta (ex.: reserva)', done: d.goals.length > 0 || steps.goal, href: null, act: 'onb:goal' },
    { id: 'cloud', label: 'Baixar um backup (cópia extra, opcional)', done: Boolean(d.lastBackupAt) || steps.cloud, href: null, act: 'backup:export' },
  ];
  return { list, done: list.filter((x) => x.done).length, total: list.length };
}

/**
 * Conta nova: assistente em 4 etapas. Reaberto depois (checklist "Complete
 * seu perfil"), começa nas contas fixas: nome e salário já foram para a
 * tela Salário e não podem ser sobrescritos por campos vazios.
 */
export function onboardingWizard() {
  const reopened = Boolean(store.data.onboarded);
  let step = reopened ? 2 : 1;
  const total = 4;
  const titles = { 1: 'Bem-vindo ao Dhenors 👋', 2: 'Contas fixas do mês', 3: 'Cartão de crédito', 4: 'Uma meta para começar' };
  const body = () => {
    if (step === 1) {
      return html`
        <p class="dialog__text">Sua conta está pronta. Tudo o que você lançar fica na <strong>nuvem, criptografado</strong> — e abre em qualquer aparelho em que você entrar.</p>
        <div class="form-grid">
          ${field({ label: 'Como quer ser chamado?', name: 'profileName', full: true, extra: { maxlength: 60, autocomplete: 'given-name' } })}
          ${moneyField({ label: 'Salário base bruto', name: 'salary', required: false, hint: 'O app calcula INSS e IR. Adicionais e descontos você ajusta depois, na tela Salário.' })}
          ${numberField({ label: 'Dia do pagamento', name: 'salaryDay', value: 5, min: 1, max: 31, hint: 'Recebe no 5º dia útil? Escolha depois em Salário → Editar.' })}
          ${numberField({ label: 'Dependentes (IR)', name: 'dependents', value: 0, min: 0, max: 20 })}
        </div>
        <div class="choice choice--inline">
          <button type="button" class="choice__opt" data-act="backup">${icon('upload')}<span><strong>Tenho um backup</strong><small>Restaurar arquivo .json</small></span></button>
        </div>`;
    }
    if (step === 2) {
      return html`
        <p class="dialog__text">Contas que se repetem todo mês. Preencha as que você tem (dá para mudar depois):</p>
        <div class="form-grid">
          ${['Aluguel ou financiamento', 'Condomínio', 'Luz', 'Internet', 'Celular', 'Plano de saúde'].map((label, i) => html`
            <div class="onb-bill">
              <span>${label}</span>
              ${moneyField({ label: `Valor de ${label}`, name: `bill${i}`, required: false })}
              ${numberField({ label: 'Dia', name: `day${i}`, value: [10, 10, 20, 15, 15, 5][i], min: 1, max: 31, required: false })}
            </div>`)}
        </div>`;
    }
    if (step === 3) {
      return html`
        <p class="dialog__text">Com o cartão cadastrado, cada compra entra na fatura certa e a fatura vira uma conta do mês.</p>
        <div class="form-grid">
          ${field({ label: 'Nome do cartão', name: 'card', placeholder: 'Ex.: Nubank', extra: { maxlength: 60 } })}
          ${numberField({ label: 'Dia de fechamento', name: 'closing', value: 3, min: 1, max: 31, required: false })}
          ${numberField({ label: 'Dia de vencimento', name: 'due', value: 10, min: 1, max: 31, required: false })}
          ${moneyField({ label: 'Limite (opcional)', name: 'limit', required: false })}
        </div>`;
    }
    return html`
      <p class="dialog__text">A primeira meta da maioria das pessoas é a <strong>reserva de emergência</strong>: o ideal são 6 meses de gastos.</p>
      <div class="form-grid">
        ${field({ label: 'Meta', name: 'goal', value: 'Reserva de emergência', extra: { maxlength: 120 } })}
        ${moneyField({ label: 'Valor da meta', name: 'goalTarget', required: false })}
        ${moneyField({ label: 'Já tenho guardado', name: 'goalSaved', required: false })}
      </div>`;
  };

  const { dialog, close } = openDialog({
    title: titles[step],
    submitLabel: 'Continuar',
    body: html`<div class="wizard"><ol class="wizard__dots" aria-label="Etapas">${Array.from({ length: total }, (_, i) => html`<li class="${i < step ? 'is-on' : ''}" aria-current="${i === step - 1 ? 'step' : 'false'}"><span class="sr-only">Etapa ${i + 1}</span></li>`)}</ol><div data-step>${body()}</div></div>`,
    footer: html`<button type="button" class="btn btn--ghost" data-skip>Pular etapa</button>`,
    onSubmit: (form) => {
      const v = readForm(form);
      if (step === 1) {
        A.completeOnboarding({ profileName: v.profileName, salaryCents: v.salary?.trim() ? toCents(v.salary) : 0, salaryDay: Number(v.salaryDay || 5), dependents: Number(v.dependents || 0) });
      } else if (step === 2) {
        const labels = ['Aluguel', 'Condomínio', 'Luz', 'Internet', 'Celular', 'Plano de saúde'];
        const mor = store.data.categories.find((c) => c.name === 'Moradia');
        const sau = store.data.categories.find((c) => c.name === 'Saúde e bem-estar');
        // Valida TODAS antes e salva num commit só: um erro na 3ª conta
        // não deixa as duas primeiras salvas (que duplicariam ao reenviar).
        const list = [];
        const rows = [];
        labels.forEach((label, i) => {
          const raw = String(v[`bill${i}`] || '').trim();
          if (!raw) return;
          const cents = toCents(raw);
          if (!Number.isFinite(cents) || cents <= 0) throw new A.ValidationError(`Valor de ${label} inválido.`, `bill${i}`);
          const day = Number(v[`day${i}`] || 10);
          if (!Number.isInteger(day) || day < 1 || day > 31) throw new A.ValidationError('O dia deve ser entre 1 e 31.', `day${i}`);
          list.push({ description: label, cents, dueDay: day, startYM: currentYM(), categoryId: i === 5 ? sau?.id : mor?.id, variable: label === 'Luz' });
          rows.push(i);
        });
        if (list.length) {
          try {
            A.saveRecurringMany(list);
          } catch (err) {
            // o erro da ação vem com o nome do campo da ação (cents, dueDay…):
            // traduz para o campo desta etapa (bill0, day0…)
            if (Number.isInteger(err.index)) err.field = `${err.field === 'dueDay' ? 'day' : 'bill'}${rows[err.index]}`;
            throw err;
          }
        }
        A.setOnboardingStep('bills', true);
        if (list.length) toast(`${list.length} conta(s) fixa(s) cadastrada(s).`);
      } else if (step === 3) {
        if (v.card?.trim()) A.saveCard({ name: v.card, closingDay: Number(v.closing || 3), dueDay: Number(v.due || 10), limitCents: v.limit ? toCents(v.limit) : 0 });
        A.setOnboardingStep('card', true);
      } else {
        const target = toCents(v.goalTarget || '');
        if (Number.isFinite(target) && target > 0) A.saveGoal({ description: v.goal || 'Reserva de emergência', targetCents: target, emergency: /reserva|emerg/i.test(v.goal || ''), initialCents: toCents(v.goalSaved || '') || 0, icon: '🛡️' });
        A.setOnboardingStep('goal', true);
        toast('Tudo pronto! Use o botão "Novo" para lançar suas contas.');
        return undefined;
      }
      next();
      return true; // mantém a janela aberta
    },
  });

  const next = () => {
    step++;
    if (step > total) { close(); return; }
    dialog.querySelector('[data-step]').innerHTML = body().toString();
    dialog.querySelector('.dialog__title').textContent = titles[step];
    dialog.querySelectorAll('.wizard__dots li').forEach((li, i) => { li.classList.toggle('is-on', i < step); li.setAttribute('aria-current', i === step - 1 ? 'step' : 'false'); });
    dialog.querySelector('[type="submit"]').textContent = step === total ? 'Concluir' : 'Continuar';
    dialog.querySelector('.dialog__body input')?.focus();
  };

  dialog.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-skip]')) {
      if (step === 1 && !store.data.onboarded) safe(() => A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 }));
      next();
    }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'backup') {
      if (!store.data.onboarded) safe(() => A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 }));
      close();
      document.dispatchEvent(new CustomEvent('dhenors:action', { detail: 'backup:import' }));
    }
  });
  dialog.addEventListener('close', () => {
    if (!store.data.onboarded) safe(() => A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 }));
  });
}

/** Fora do formulário (cliques, fechar): erro vira aviso; sem login, a tela de entrar já abriu. */
function safe(fn) {
  try { fn(); } catch (err) { if (err?.name !== 'GuestError') toastError(err.message); }
}
