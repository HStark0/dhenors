// =============================================================
// Ajustes — perfil, renda, aparência e dados (backup)
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, categoryFields, bindCategorySelects } from '../ui/forms.js';
import { autoLockMinutes, setAutoLockMinutes } from '../ui/lock.js';
import { enableNotifications } from '../ui/notify.js';
import { cloudSettingsSection } from '../ui/cloudUI.js';
import { toast } from '../ui/toast.js';
import * as E from '../ui/editors.js';
import { exportBackup, importBackup } from '../ui/backup.js';
import { store } from '../core/store.js';
import { requestPersistence, storageInfo } from '../core/storage.js';
import { formatBRL, plural } from '../core/money.js';
import { formatDateBR, currentYM, todayISO } from '../core/dates.js';
import { payrollFor, payrollProfileFor, paydayLabel, nextPaydayFrom } from '../domain/payroll.js';
import * as A from '../domain/actions.js';

export const APP_VERSION = '3.2.0';

let storageCache = null;

export default {
  id: 'ajustes',
  title: 'Ajustes',

  render() {
    const d = store.data;
    const s = d.settings;
    if (!storageCache) storageInfo().then((info) => { storageCache = info; store.setUI({}); });
    const st = storageCache;

    return html`
      <div class="settings">
        <section class="card">
          <h2 class="card__title">${icon('user')} Perfil</h2>
          <div class="setting">
            <div><strong>Nome</strong><p class="muted small">${s.profileName || 'Não informado'}</p></div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="set:profile">Editar</button>
          </div>
        </section>

        ${cloudSettingsSection()}

        <section class="card">
          <h2 class="card__title">${icon('wallet')} Renda</h2>
          <div class="setting">
            <div><strong>Salário atual</strong><p class="muted small">${salaryLine(s)}</p></div>
            <div class="setting__actions">
              <a class="btn btn--secondary btn--sm" href="#/salario">${icon('banknote', 'icon--xs')} Abrir salário</a>
            </div>
          </div>
          <div class="setting">
            <div><strong>Data de recebimento</strong><p class="muted small">Salário cai ${paydayLabel(s)} · próximo em ${formatDateBR(nextPaydayFrom(s))}</p></div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="salary:edit">${icon('calendar-days', 'icon--xs')} Alterar</button>
          </div>
          <div class="setting">
            <div><strong>Meta de gastos mensal</strong><p class="muted small">${s.spendingLimitCents ? formatBRL(s.spendingLimitCents) : 'Desativada'}</p></div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="limit:edit">Alterar</button>
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">${icon('sun')} Aparência</h2>
          <div class="segmented" role="group" aria-label="Tema">
            ${[['auto', 'Automático', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']].map(([v, l, ic]) => html`
              <button type="button" class="segmented__btn" data-action="theme:set" data-theme="${v}" aria-pressed="${s.theme === v}">${icon(ic, 'icon--xs')} ${l}</button>`)}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">${icon('lock-keyhole')} Segurança</h2>
          <div class="setting">
            <div>
              <strong>Bloqueio por PIN</strong>
              <p class="muted small">${store.pinEnabled
                ? html`<span class="badge badge--good">Ativo</span> Os dados estão criptografados (AES-256) neste aparelho e o app abre pedindo o PIN.`
                : 'Proteja o app com um PIN de 4 a 8 números. Os dados passam a ser salvos criptografados.'}</p>
            </div>
            <div class="setting__actions">
              ${store.pinEnabled ? html`
                <button type="button" class="btn btn--ghost btn--sm" data-action="pin:set">Trocar PIN</button>
                <button type="button" class="btn btn--ghost btn--sm danger" data-action="pin:remove">Desativar</button>`
              : html`<button type="button" class="btn btn--primary btn--sm" data-action="pin:set">${icon('fingerprint', 'icon--xs')} Criar PIN</button>`}
            </div>
          </div>
          ${store.pinEnabled ? html`
            <div class="setting">
              <div><strong>Bloquear automaticamente</strong><p class="muted small">Depois de sair do app por um tempo.</p></div>
              <div class="segmented" role="group" aria-label="Bloquear automaticamente">
                ${[[0, 'Na hora'], [1, '1 min'], [5, '5 min'], [30, '30 min'], [-1, 'Nunca']].map(([m, l]) => html`
                  <button type="button" class="segmented__btn" data-action="pin:auto" data-min="${m}" aria-pressed="${autoLockMinutes() === m}">${l}</button>`)}
              </div>
            </div>
            <div class="setting">
              <div><strong>Bloquear agora</strong><p class="muted small">Atalho: botão de cadeado no topo.</p></div>
              <button type="button" class="btn btn--ghost btn--sm" data-action="lock:now">${icon('lock', 'icon--xs')} Bloquear</button>
            </div>` : ''}
        </section>

        <section class="card">
          <h2 class="card__title">${icon('bell-ring')} Lembretes</h2>
          <div class="setting">
            <div><strong>Avisos de vencimento</strong><p class="muted small">${s.reminders?.enabled ? 'Ligados: você recebe uma notificação ao abrir o app.' : 'Desligados'}</p></div>
            <button type="button" class="btn ${s.reminders?.enabled ? 'btn--ghost' : 'btn--secondary'} btn--sm" data-action="agenda:notify">${s.reminders?.enabled ? 'Desligar' : 'Ligar'}</button>
          </div>
          <div class="setting">
            <div><strong>Avisar com antecedência</strong><p class="muted small">Também vale para o arquivo de calendário (.ics).</p></div>
            <div class="segmented" role="group" aria-label="Antecedência dos lembretes">
              ${[[0, 'No dia'], [1, '1 dia'], [3, '3 dias'], [7, '7 dias']].map(([n, l]) => html`
                <button type="button" class="segmented__btn" data-action="rem:days" data-days="${n}" aria-pressed="${(s.reminders?.daysBefore ?? 1) === n}">${l}</button>`)}
            </div>
          </div>
          <div class="setting">
            <div><strong>Calendário do celular</strong><p class="muted small">Exporte os vencimentos com alarme para Google Agenda, iPhone ou Outlook.</p></div>
            <a class="btn btn--ghost btn--sm" href="#/agenda">${icon('calendar-days', 'icon--xs')} Abrir agenda</a>
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">${icon('wand-sparkles')} Regras de categorização</h2>
          <p class="muted small">Quando a descrição contém o texto, a categoria é escolhida sozinha na importação de extratos e na busca rápida.</p>
          ${(s.rules || []).length ? html`
            <ul class="mini-list">
              ${s.rules.map((rule) => {
                const cat = d.categories.find((c) => c.id === rule.categoryId);
                return html`
                  <li>
                    <span class="rule"><code>${rule.pattern}</code> ${icon('arrow-right', 'icon--xs')} ${cat ? `${cat.icon} ${cat.name}` : 'categoria removida'}</span>
                    <span class="mini-list__actions"><button type="button" class="icon-btn icon-btn--sm danger" data-action="rule:delete" data-id="${rule.id}" aria-label="Remover regra ${rule.pattern}">${icon('trash-2')}</button></span>
                  </li>`;
              })}
            </ul>` : html`<p class="muted small">Nenhuma regra ainda. Elas são criadas ao importar extratos (opção "Aprender") ou aqui.</p>`}
          <div class="card__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="rule:new">${icon('plus', 'icon--xs')} Nova regra</button>
            <a class="btn btn--ghost btn--sm" href="#/importar">${icon('file-up', 'icon--xs')} Importar extrato</a>
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">${icon('database')} Seus dados</h2>
          <p class="muted small">Tudo é salvo <strong>primeiro neste aparelho</strong> (funciona offline). Com a <a class="link" href="#/ajustes" data-action="cloud:open">nuvem</a> ligada, uma cópia criptografada vai para a sua conta. O backup em arquivo continua disponível.</p>
          <div class="setting">
            <div><strong>Backup</strong><p class="muted small">${d.lastBackupAt ? `Último: ${formatDateBR(todayISO(new Date(d.lastBackupAt)))}` : 'Nenhum backup feito ainda'}</p></div>
            <div class="setting__actions">
              <button type="button" class="btn btn--primary btn--sm" data-action="backup:export">${icon('download', 'icon--xs')} Baixar backup</button>
              <button type="button" class="btn btn--ghost btn--sm" data-action="backup:import">${icon('upload', 'icon--xs')} Restaurar</button>
            </div>
          </div>
          <div class="setting">
            <div><strong>Planilhas e holerites</strong><p class="muted small">Contracheques (proventos e descontos), resumo mensal de renda, gastos e saldo, holerite em PDF.</p></div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="export:open" data-kind="summary">${icon('file-spreadsheet', 'icon--xs')} Baixar dados</button>
          </div>
          <div class="setting">
            <div>
              <strong>Proteção do armazenamento</strong>
              <p class="muted small">${st == null ? 'Verificando…'
                : st.persisted ? 'Ativa: o navegador não apaga os dados para liberar espaço.'
                : 'Inativa: o navegador pode apagar dados se o aparelho ficar sem espaço.'}
                ${st?.usage != null ? ` · ${(st.usage / 1024).toFixed(0)} KB usados` : ''}</p>
            </div>
            ${st && !st.persisted ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="set:persist">${icon('shield-check', 'icon--xs')} Ativar</button>` : ''}
          </div>
        </section>

        <section class="card card--danger">
          <h2 class="card__title">${icon('triangle-alert')} Zona de perigo</h2>
          <div class="setting">
            <div><strong>Apagar todos os dados</strong><p class="muted small">Remove tudo deste aparelho. Faça um backup antes.</p></div>
            <button type="button" class="btn btn--danger btn--sm" data-action="set:wipe">Apagar tudo</button>
          </div>
        </section>

        <p class="muted small center">Dhenors ${APP_VERSION} · funciona offline · seus dados não saem deste aparelho</p>
      </div>`;
  },

  actions: {
    'set:profile': () => openDialog({
      title: 'Perfil',
      size: 'sm',
      submitLabel: 'Salvar',
      body: field({ label: 'Como quer ser chamado?', name: 'profileName', value: store.data.settings.profileName, extra: { maxlength: 60, autocomplete: 'given-name' } }),
      onSubmit: (form) => { A.updateProfile({ profileName: form.profileName.value }); toast('Perfil salvo.'); },
    }),
    'set:persist': async () => {
      const ok = await requestPersistence();
      storageCache = null;
      toast(ok ? 'Armazenamento protegido.' : 'O navegador não permitiu agora. Instalar o app (Adicionar à tela inicial) costuma liberar.', { type: ok ? 'success' : 'info' });
      store.setUI({});
    },
    'set:wipe': async () => {
      const ok = await confirmDialog({
        title: 'Apagar todos os dados',
        message: 'Isso remove TODAS as contas, parcelamentos, metas, categorias e histórico deste aparelho. Não dá para desfazer.',
        confirmLabel: 'Apagar tudo',
        danger: true,
        typed: 'EXCLUIR',
      });
      if (ok) { await store.reset(); toast('Todos os dados foram apagados.'); location.hash = '#/painel'; }
    },
    'pin:set': () => pinDialog(),
    'pin:remove': async () => {
      const ok = await confirmDialog({ title: 'Desativar PIN', message: 'Os dados voltam a ser salvos sem criptografia neste aparelho.', confirmLabel: 'Desativar', danger: true });
      if (ok) { await store.removePin(); toast('PIN desativado.'); store.setUI({}); }
    },
    'pin:auto': (el) => { setAutoLockMinutes(Number(el.dataset.min)); store.setUI({}); },
    'rem:days': (el) => { const r = store.data.settings.reminders || {}; A.setReminders({ enabled: r.enabled, daysBefore: Number(el.dataset.days) }); },
    'agenda:notify': () => enableNotifications(),
    'rule:delete': (el) => { A.deleteRule(el.dataset.id); toast('Regra removida.'); },
    'rule:new': () => ruleDialog(),
    'backup:import': () => importBackup(),
    'backup:export': () => exportBackup(),
    'salary:edit': () => E.editSalaryBase(currentYM()),
    'limit:edit': () => E.editSpendingLimit(),
  },
};

/** "Bruto R$ 5.000 → líquido R$ 4.200 · pago todo dia 5" */
function salaryLine(s) {
  const ym = currentYM();
  const profile = payrollProfileFor(s, ym);
  if (!profile) return `Não informado · pago ${paydayLabel(s)}`;
  const p = payrollFor(s, ym);
  if (p.legacyNet) return `${formatBRL(p.net)} líquido (cadastro antigo — edite para informar o bruto) · pago ${paydayLabel(s)}`;
  const extras = p.additions.length + p.deductions.length;
  return `Bruto ${formatBRL(p.gross)} → líquido ${formatBRL(p.net)}${extras ? ` · ${plural(p.additions.length, 'adicional', 'adicionais')}, ${plural(p.deductions.length, 'desconto')}` : ''} · pago ${paydayLabel(s)}`;
}

function pinDialog() {
  if (!globalThis.crypto?.subtle) {
    toast('Criptografia indisponível: abra o app por https (ou instalado) para usar PIN.', { type: 'error' });
    return;
  }
  openDialog({
    title: store.pinEnabled ? 'Trocar PIN' : 'Criar PIN',
    size: 'sm',
    submitLabel: 'Salvar PIN',
    body: html`
      <p class="dialog__text muted">Use de 4 a 8 números. <strong>Não há como recuperar um PIN esquecido</strong> — guarde um backup atualizado.</p>
      <div class="form-grid">
        ${field({ label: 'Novo PIN', name: 'pin', type: 'password', required: true, extra: { inputmode: 'numeric', pattern: '[0-9]{4,8}', maxlength: 8, autocomplete: 'new-password' } })}
        ${field({ label: 'Repita o PIN', name: 'pin2', type: 'password', required: true, extra: { inputmode: 'numeric', pattern: '[0-9]{4,8}', maxlength: 8, autocomplete: 'new-password' } })}
      </div>`,
    onSubmit: async (form) => {
      const pin = form.pin.value;
      if (!/^\d{4,8}$/.test(pin)) throw new A.ValidationError('O PIN deve ter de 4 a 8 números.', 'pin');
      if (pin !== form.pin2.value) throw new A.ValidationError('Os PINs não conferem.', 'pin2');
      await store.setPin(pin);
      toast('PIN salvo. Os dados agora estão criptografados.');
      store.setUI({});
    },
  });
}

function ruleDialog() {
  const d = store.data;
  openDialog({
    title: 'Nova regra',
    size: 'sm',
    submitLabel: 'Criar regra',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Se a descrição contém', name: 'pattern', required: true, full: true, placeholder: 'Ex.: posto shell', extra: { maxlength: 60, autocomplete: 'off' } })}
        ${categoryFields(d)}
      </div>`,
    onMount: (dlg) => bindCategorySelects(dlg, d),
    onSubmit: (form) => {
      if (!form.categoryId.value) throw new A.ValidationError('Escolha a categoria.', 'categoryId');
      A.saveRule({ pattern: form.pattern.value.trim().toLowerCase(), categoryId: form.categoryId.value, subcategoryId: form.subcategoryId?.value || null });
      toast('Regra criada.');
    },
  });
}
