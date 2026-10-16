// =============================================================
// onboarding.js — Primeiros passos em etapas + dados de exemplo
// -------------------------------------------------------------
// Etapas: 1 salário · 2 contas fixas · 3 cartão · 4 meta · 5 nuvem.
// Dá para pular qualquer uma; o Painel mostra o checklist
// "Complete seu perfil" com o que faltou.
// Modo exemplo: guarda os seus dados num canto, carrega um mês de
// exemplo para experimentar e volta tudo como estava ao sair. Com o
// modo exemplo ligado, NADA é enviado para a nuvem.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { field, moneyField, numberField, readForm } from './forms.js';
import { store } from '../core/store.js';
import { requestPersistence, getItem, setItem } from '../core/storage.js';
import { toCents } from '../core/money.js';
import { currentYM } from '../core/dates.js';
import * as A from '../domain/actions.js';
import { createSampleState } from '../domain/sample.js';

const DEMO_FLAG = 'dhenors:demo';

export const isDemo = () => { try { return localStorage.getItem(DEMO_FLAG) === '1'; } catch { return false; } };

/** Liga o modo exemplo (guarda os dados atuais e carrega o exemplo). */
export async function startDemo({ confirm = true } = {}) {
  const ok = !confirm || await confirmDialog({
    title: 'Experimentar com dados de exemplo',
    message: 'Seus dados atuais ficam guardados neste aparelho e voltam quando você sair do modo exemplo. Enquanto isso, nada é enviado para a nuvem.',
    confirmLabel: 'Ver o exemplo',
  });
  if (!ok) return;
  await store.flush();
  await setItem('demo:backup', structuredClone(store.data));
  try { localStorage.setItem(DEMO_FLAG, '1'); } catch { /* ignora */ }
  await store.replace(createSampleState());
  location.hash = '#/painel';
  toast('Modo exemplo ligado. Mexa à vontade!', { type: 'info' });
}

/** Sai do modo exemplo e devolve os dados reais. */
export async function stopDemo() {
  const backup = await getItem('demo:backup');
  try { localStorage.removeItem(DEMO_FLAG); } catch { /* ignora */ }
  if (backup) await store.replace(backup); else await store.reset();
  await setItem('demo:backup', undefined);
  toast('Seus dados voltaram.');
}

/** Checklist "Complete seu perfil" (Painel). */
export function profileChecklist(d, { cloudLinked = false } = {}) {
  const steps = d.settings.onboardingSteps || {};
  const list = [
    { id: 'salary', label: 'Cadastrar o salário', done: d.settings.salaryHistory.length > 0, href: '#/salario', act: null },
    { id: 'bills', label: 'Lançar as contas fixas', done: d.recurring.length > 0 || steps.bills, href: null, act: 'onb:bills' },
    { id: 'card', label: 'Cadastrar o cartão de crédito', done: (d.cards || []).length > 0 || steps.card, href: null, act: 'onb:card' },
    { id: 'goal', label: 'Criar uma meta (ex.: reserva)', done: d.goals.length > 0 || steps.goal, href: null, act: 'onb:goal' },
    { id: 'cloud', label: 'Ligar a nuvem ou fazer backup', done: cloudLinked || Boolean(d.lastBackupAt) || steps.cloud, href: null, act: 'cloud:open' },
  ];
  return { list, done: list.filter((x) => x.done).length, total: list.length };
}

/** Primeiro acesso: assistente em 5 etapas. */
export function onboardingWizard() {
  let step = 1;
  const total = 5;
  const titles = { 1: 'Bem-vindo ao Dhenors 👋', 2: 'Contas fixas do mês', 3: 'Cartão de crédito', 4: 'Uma meta para começar', 5: 'Seus dados em qualquer lugar' };
  const body = () => {
    if (step === 1) {
      return html`
        <p class="dialog__text">Seu controle financeiro, direto no navegador. Funciona <strong>sem cadastro</strong> e salva neste aparelho.</p>
        <div class="form-grid">
          ${field({ label: 'Como quer ser chamado?', name: 'profileName', full: true, extra: { maxlength: 60, autocomplete: 'given-name' } })}
          ${moneyField({ label: 'Salário base bruto', name: 'salary', required: false, hint: 'O app calcula INSS e IR. Adicionais e descontos você ajusta depois, na tela Salário.' })}
          ${numberField({ label: 'Dia do pagamento', name: 'salaryDay', value: 5, min: 1, max: 31, hint: 'Recebe no 5º dia útil? Escolha depois em Salário → Editar.' })}
          ${numberField({ label: 'Dependentes (IR)', name: 'dependents', value: 0, min: 0, max: 20 })}
        </div>
        <div class="choice choice--inline">
          <button type="button" class="choice__opt" data-act="cloud">${icon('cloud-download')}<span><strong>Já uso em outro aparelho</strong><small>Entrar na nuvem</small></span></button>
          <button type="button" class="choice__opt" data-act="backup">${icon('upload')}<span><strong>Restaurar backup</strong><small>Arquivo .json</small></span></button>
          <button type="button" class="choice__opt" data-act="demo">${icon('sparkles')}<span><strong>Só quero ver como é</strong><small>Dados de exemplo</small></span></button>
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
    if (step === 4) {
      return html`
        <p class="dialog__text">A primeira meta da maioria das pessoas é a <strong>reserva de emergência</strong>: o ideal são 6 meses de gastos.</p>
        <div class="form-grid">
          ${field({ label: 'Meta', name: 'goal', value: 'Reserva de emergência', extra: { maxlength: 120 } })}
          ${moneyField({ label: 'Valor da meta', name: 'goalTarget', required: false })}
          ${moneyField({ label: 'Já tenho guardado', name: 'goalSaved', required: false })}
        </div>`;
    }
    return html`
      <p class="dialog__text">Os dados ficam neste aparelho. Para usar no celular e no computador com os mesmos números, ligue a nuvem (criptografada com uma frase que só você sabe). Ou faça backups de vez em quando.</p>
      <div class="choice">
        <button type="button" class="choice__opt" data-act="cloud">${icon('cloud-upload')}<span><strong>Ligar a nuvem agora</strong><small>Supabase gratuito, criptografado</small></span></button>
        <button type="button" class="choice__opt" data-act="pin">${icon('lock-keyhole')}<span><strong>Proteger com PIN ou senha</strong><small>Ajustes → Segurança</small></span></button>
      </div>`;
  };

  const { dialog, close } = openDialog({
    title: titles[1],
    submitLabel: 'Continuar',
    body: html`<div class="wizard"><ol class="wizard__dots" aria-label="Etapas">${Array.from({ length: total }, (_, i) => html`<li class="${i === 0 ? 'is-on' : ''}" aria-current="${i === 0 ? 'step' : 'false'}"><span class="sr-only">Etapa ${i + 1}</span></li>`)}</ol><div data-step>${body()}</div></div>`,
    footer: html`<button type="button" class="btn btn--ghost" data-skip>Pular etapa</button>`,
    onSubmit: (form) => {
      const v = readForm(form);
      if (step === 1) {
        A.completeOnboarding({ profileName: v.profileName, salaryCents: v.salary?.trim() ? toCents(v.salary) : 0, salaryDay: Number(v.salaryDay || 5), dependents: Number(v.dependents || 0) });
        requestPersistence();
      } else if (step === 2) {
        const labels = ['Aluguel', 'Condomínio', 'Luz', 'Internet', 'Celular', 'Plano de saúde'];
        const mor = store.data.categories.find((c) => c.name === 'Moradia');
        const sau = store.data.categories.find((c) => c.name === 'Saúde e bem-estar');
        let n = 0;
        labels.forEach((label, i) => {
          const cents = toCents(v[`bill${i}`] || '');
          if (!Number.isFinite(cents) || cents <= 0) return;
          A.saveRecurring({ description: label, cents, dueDay: Number(v[`day${i}`] || 10), startYM: currentYM(), categoryId: i === 5 ? sau?.id : mor?.id, variable: label === 'Luz' });
          n++;
        });
        A.setOnboardingStep('bills', true);
        if (n) toast(`${n} conta(s) fixa(s) cadastrada(s).`);
      } else if (step === 3) {
        if (v.card?.trim()) A.saveCard({ name: v.card, closingDay: Number(v.closing || 3), dueDay: Number(v.due || 10), limitCents: v.limit ? toCents(v.limit) : 0 });
        A.setOnboardingStep('card', true);
      } else if (step === 4) {
        const target = toCents(v.goalTarget || '');
        if (Number.isFinite(target) && target > 0) A.saveGoal({ description: v.goal || 'Reserva de emergência', targetCents: target, emergency: /reserva|emerg/i.test(v.goal || ''), initialCents: toCents(v.goalSaved || '') || 0, icon: '🛡️' });
        A.setOnboardingStep('goal', true);
      } else {
        A.setOnboardingStep('cloud', true);
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
      if (step === 1) A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 });
      next();
    }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'demo') { close(); A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 }); startDemo(); }
    if (act === 'cloud' || act === 'backup' || act === 'pin') {
      if (!store.data.onboarded) A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 });
      close();
      document.dispatchEvent(new CustomEvent('dhenors:action', { detail: act === 'cloud' ? 'cloud:open' : act === 'backup' ? 'backup:import' : 'pin:set' }));
    }
  });
  dialog.addEventListener('close', () => {
    if (!store.data.onboarded) A.completeOnboarding({ profileName: '', salaryCents: 0, salaryDay: 5 });
  });
}
