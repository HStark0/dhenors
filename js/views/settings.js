// =============================================================
// Ajustes — perfil, aparência, segurança, nuvem, lembretes,
// categorias, credores, regras, dados, ajuda, privacidade e novidades
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, categoryFields, bindCategorySelects } from '../ui/forms.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { autoLockMinutes, setAutoLockMinutes, wipeAfter, setWipeAfter } from '../ui/lock.js';
import { pinPad, bindPinPad } from '../ui/pinpad.js';
import { enableNotifications, togglePush } from '../ui/notify.js';
import { cloudSettingsSection } from '../ui/cloudUI.js';
import { toast, toastError } from '../ui/toast.js';
import { GLOSSARY } from '../ui/help.js';
import { canInstall, isStandalone } from '../ui/pwa.js';
import { startDemo, stopDemo, isDemo } from '../ui/onboarding.js';
import { catText } from '../ui/forms.js';
import * as E from '../ui/editors.js';
import { exportBackup, importBackup, download } from '../ui/backup.js';
import { store } from '../core/store.js';
import { requestPersistence, storageInfo } from '../core/storage.js';
import { ACCENTS, isDiscreet, setDiscreet } from '../core/theme.js';
import { passwordStrength, PIN_KDF } from '../core/crypto.js';
import { biometricAvailable, biometricEnabled, enableBiometric, disableBiometric } from '../core/biometric.js';
import { errorLog, clearErrorLog } from '../core/errors.js';
import { openFinanceSettings, saveOpenFinance, connectBank, listAccounts, fetchTransactions } from '../core/openfinance.js';
import { cloud } from '../core/cloud.js';
import { formatBRL, plural } from '../core/money.js';
import { formatDateBR, currentYM, todayISO, addDaysISO, diffDays } from '../core/dates.js';
import { payrollFor, payrollProfileFor, paydayLabel, nextPaydayFrom } from '../domain/payroll.js';
import * as A from '../domain/actions.js';
import { APP_VERSION } from '../version.js';
import { CHANGELOG } from '../changelog.js';
import { renderCategories, renderCreditors, categoryActions } from './settings/categories.js';
import { loadRows } from './importer.js';

const TABS = [
  { id: 'geral', label: 'Geral', icon: 'user-cog' },
  { id: 'seguranca', label: 'Segurança', icon: 'lock-keyhole' },
  { id: 'nuvem', label: 'Nuvem', icon: 'cloud' },
  { id: 'lembretes', label: 'Lembretes', icon: 'bell-ring' },
  { id: 'categorias', label: 'Categorias', icon: 'tags', monthNav: true },
  { id: 'credores', label: 'Credores', icon: 'handshake' },
  { id: 'regras', label: 'Regras', icon: 'wand-sparkles' },
  { id: 'dados', label: 'Dados', icon: 'database' },
  { id: 'ajuda', label: 'Ajuda', icon: 'circle-help' },
  { id: 'privacidade', label: 'Privacidade', icon: 'shield-check' },
  { id: 'novidades', label: 'Novidades', icon: 'sparkles' },
];

let storageCache = null;
let bioCache = null;

export default {
  id: 'ajustes',
  title: 'Ajustes',
  get monthNav() { return currentTab(TABS) === 'categorias'; },

  render() {
    const active = currentTab(TABS);
    const R = {
      geral, seguranca: security, nuvem: () => html`<div class="settings">${cloudSettingsSection()}</div>`, lembretes: reminders,
      categorias: renderCategories, credores: renderCreditors, regras: rules, dados: data, ajuda: help, privacidade: privacy, novidades: news,
    };
    return html`${tabsNav('ajustes', TABS, active)}${R[active]()}`;
  },

  actions: {
    ...categoryActions,
    'set:profile': () => openDialog({
      title: 'Perfil',
      size: 'sm',
      submitLabel: 'Salvar',
      body: field({ label: 'Como quer ser chamado?', name: 'profileName', value: store.data.settings.profileName, extra: { maxlength: 60, autocomplete: 'given-name' } }),
      onSubmit: (form) => { A.updateProfile({ profileName: form.profileName.value }); toast('Perfil salvo.'); },
    }),
    'app:theme': (el) => A.setAppearance({ theme: el.dataset.value }),
    'app:accent': (el) => A.setAppearance({ accent: el.dataset.value }),
    'app:density': (el) => A.setAppearance({ density: el.dataset.value }),
    'app:motion': (el) => A.setAppearance({ motion: el.dataset.value }),
    'app:tabbar': () => tabbarDialog(),
    'app:dashboard': () => { store.setUI({ dashEdit: true }); location.hash = '#/painel'; },
    'app:demo': () => (isDemo() ? stopDemo() : startDemo()),
    'set:persist': async () => {
      const ok = await requestPersistence();
      storageCache = null;
      toast(ok ? 'Armazenamento protegido.' : 'O navegador não permitiu agora. Instalar o app (Adicionar à tela inicial) costuma liberar.', { type: ok ? 'success' : 'info' });
      store.setUI({});
    },
    'set:wipe': async () => {
      const ok = await confirmDialog({
        title: 'Apagar todos os dados',
        message: 'Isso remove TODAS as contas, cartões, parcelamentos, metas, categorias, anexos e histórico deste aparelho. Não dá para desfazer.',
        confirmLabel: 'Apagar tudo',
        danger: true,
        typed: 'EXCLUIR',
      });
      if (ok) { await store.reset(); toast('Todos os dados foram apagados.'); location.hash = '#/painel'; }
    },
    'pin:set': (el) => pinDialog(el.dataset.kind || store.lockKind || 'pin'),
    'pin:remove': async () => {
      const ok = await confirmDialog({ title: 'Desativar a proteção', message: 'Os dados voltam a ser salvos sem criptografia neste aparelho (e a biometria é desligada).', confirmLabel: 'Desativar', danger: true });
      if (ok) { await store.removePin(); bioCache = null; toast('Proteção desativada.'); store.setUI({}); }
    },
    'pin:auto': (el) => { setAutoLockMinutes(Number(el.dataset.min)); store.setUI({}); },
    'pin:wipe': (el) => { setWipeAfter(Number(el.dataset.n)); store.setUI({}); },
    'bio:toggle': async () => {
      try {
        if (await biometricEnabled()) { await disableBiometric(); toast('Biometria desligada.'); } else { await enableBiometric(); toast('Pronto! Na próxima vez, abra com a digital ou o rosto.'); }
      } catch (err) { if (err.name !== 'NotAllowedError') toastError(err.message); }
      bioCache = null;
      store.setUI({});
    },
    'discreet:set': () => { setDiscreet(!isDiscreet()); store.setUI({}); },
    'rem:days': (el) => { const r = store.data.settings.reminders || {}; A.setReminders({ ...r, daysBefore: Number(el.dataset.days) }); },
    'rem:mode': (el) => { const r = store.data.settings.reminders || {}; A.setReminders({ ...r, mode: el.dataset.mode }); },
    'agenda:notify': () => enableNotifications(),
    'rem:push': () => togglePush(),
    'rule:delete': (el) => E.deleteWithUndo(() => A.deleteRule(el.dataset.id), 'Regra removida.'),
    'rule:new': () => ruleDialog(),
    'backup:import': () => importBackup(),
    'backup:export': () => exportBackup(),
    'salary:edit': () => E.editSalaryBase(currentYM()),
    'limit:edit': () => E.editSpendingLimit(),
    'err:export': async () => {
      const log = await errorLog();
      download(`dhenors-erros-${todayISO()}.json`, JSON.stringify({ app: 'Dhenors', version: APP_VERSION, exportedAt: new Date().toISOString(), errors: log }, null, 2), 'application/json');
      toast(`${plural(log.length, 'erro exportado', 'erros exportados')}. Anexe o arquivo numa issue do GitHub.`);
    },
    'err:clear': async () => { await clearErrorLog(); toast('Registro de erros limpo.'); store.setUI({ errors: null }); },
    'of:toggle': () => openFinanceDialog(),
    'of:connect': async () => { try { await connectBank(); } catch (err) { toastError(err.message); } },
    'of:import': (el) => openFinanceImport(el.dataset.item),
  },

  onFilter(name, value) {
    if (name === 'helpQ') store.setUI({ filters: { ...store.ui.filters, helpQ: value } });
  },
};

// ---------- Geral ----------

function salaryLine(s) {
  const ym = currentYM();
  const profile = payrollProfileFor(s, ym);
  if (!profile) return `Não informado · pago ${paydayLabel(s)}`;
  const p = payrollFor(s, ym);
  if (p.legacyNet) return `${formatBRL(p.net)} líquido (cadastro antigo — edite para informar o bruto) · pago ${paydayLabel(s)}`;
  return `Bruto ${formatBRL(p.gross)} → líquido ${formatBRL(p.net)} · pago ${paydayLabel(s)}`;
}

function choice(action, value, current, label, ic) {
  return html`<button type="button" class="segmented__btn" data-action="${action}" data-value="${value}" aria-pressed="${value === current}">${ic ? icon(ic, 'icon--xs') : ''} ${label}</button>`;
}

function geral() {
  const s = store.data.settings;
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('user')} Perfil e renda</h2>
        <div class="setting">
          <div><strong>Nome</strong><p class="muted small">${s.profileName || 'Não informado'}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="set:profile">Editar</button>
        </div>
        <div class="setting">
          <div><strong>Salário</strong><p class="muted small">${salaryLine(s)} · próximo em ${formatDateBR(nextPaydayFrom(s))}</p></div>
          <div class="setting__actions">
            <a class="btn btn--secondary btn--sm" href="#/salario">${icon('banknote', 'icon--xs')} Abrir salário</a>
            <button type="button" class="btn btn--ghost btn--sm" data-action="salary:edit">${icon('calendar-days', 'icon--xs')} Data</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Meta de gastos mensal</strong><p class="muted small">${s.spendingLimitCents ? formatBRL(s.spendingLimitCents) : 'Desativada'}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="limit:edit">Alterar</button>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">${icon('palette')} Aparência</h2>
        <div class="setting setting--stack">
          <strong>Tema</strong>
          <div class="segmented" role="group" aria-label="Tema">
            ${choice('app:theme', 'auto', s.theme, 'Automático', 'sun-moon')}${choice('app:theme', 'light', s.theme, 'Claro', 'sun')}${choice('app:theme', 'dark', s.theme, 'Escuro', 'moon')}${choice('app:theme', 'oled', s.theme, 'Preto (OLED)', 'contrast')}
          </div>
          <p class="muted small">"Preto (OLED)" usa preto puro: economiza bateria em telas OLED.</p>
        </div>
        <div class="setting setting--stack">
          <strong>Cor de destaque</strong>
          <div class="swatches" role="radiogroup" aria-label="Cor de destaque">
            ${Object.entries(ACCENTS).map(([k, a]) => html`<button type="button" class="swatch swatch--btn" style="--swatch:${a.primary}" data-action="app:accent" data-value="${k}" role="radio" aria-checked="${(s.accent || 'azul') === k}" aria-label="${a.label}" title="${a.label}"></button>`)}
          </div>
        </div>
        <div class="setting setting--stack">
          <strong>Densidade</strong>
          <div class="segmented" role="group" aria-label="Densidade">
            ${choice('app:density', 'comfortable', s.density || 'comfortable', 'Confortável', 'rows-3')}${choice('app:density', 'compact', s.density, 'Compacta', 'list')}
          </div>
          <p class="muted small">Compacta mostra mais lançamentos na tela.</p>
        </div>
        <div class="setting setting--stack">
          <strong>Efeitos e animações</strong>
          <div class="segmented" role="group" aria-label="Efeitos">
            ${choice('app:motion', 'full', s.motion || 'full', 'Todos')}${choice('app:motion', 'calm', s.motion, 'Calmos')}${choice('app:motion', 'off', s.motion, 'Desligados')}
          </div>
          <p class="muted small">"Calmos" tira o brilho da logo e os cortes diagonais em movimento; "Desligados" tira todas as animações. O "reduzir movimento" do sistema continua valendo.</p>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">${icon('layout-grid')} Painel e navegação</h2>
        <div class="setting">
          <div><strong>Organizar o Painel</strong><p class="muted small">Reordene, esconda ou fixe os cards.</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="app:dashboard">${icon('sliders-horizontal', 'icon--xs')} Organizar</button>
        </div>
        <div class="setting">
          <div><strong>Atalhos da barra do celular</strong><p class="muted small">${(s.tabbar || []).join(' · ')}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="app:tabbar">Escolher</button>
        </div>
        ${canInstall() || !isStandalone() ? html`
          <div class="setting">
            <div><strong>Instalar o app</strong><p class="muted small">Abre em tela cheia, funciona sem internet e o navegador protege melhor os dados.</p></div>
            <button type="button" class="btn btn--secondary btn--sm" data-action="install:app">${icon('smartphone', 'icon--xs')} Instalar</button>
          </div>` : ''}
        <div class="setting">
          <div><strong>${isDemo() ? 'Modo exemplo ligado' : 'Experimentar com dados de exemplo'}</strong><p class="muted small">${isDemo() ? 'Seus dados estão guardados e voltam ao sair.' : 'Veja o app cheio de dados sem mexer nos seus (nada vai para a nuvem).'}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="app:demo">${isDemo() ? 'Sair do exemplo' : 'Ver exemplo'}</button>
        </div>
      </section>
      <p class="muted small center">Dhenors ${APP_VERSION} · funciona offline</p>
    </div>`;
}

function tabbarDialog() {
  const opts = [['painel', 'Painel'], ['agenda', 'Agenda'], ['contas', 'Contas'], ['carteira', 'Cartões e contas'], ['salario', 'Salário'], ['metas', 'Metas'], ['investimentos', 'Investimentos'], ['planejamento', 'Planejamento'], ['analise', 'Análise'], ['ajustes', 'Ajustes']];
  const cur = store.data.settings.tabbar || ['painel', 'agenda', 'contas'];
  openDialog({
    title: 'Atalhos da barra do celular',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Escolha 3 telas. O botão "+" (novo) e "Mais" ficam sempre.</p>
      <div class="check-list">${opts.map(([id, label]) => html`<label class="check"><input type="checkbox" name="tab" value="${id}" ${cur.includes(id) ? 'checked' : ''}> ${label}</label>`)}</div>`,
    onSubmit: (form) => {
      const ids = [...form.querySelectorAll('[name="tab"]:checked')].map((x) => x.value);
      if (ids.length !== 3) throw new A.ValidationError(`Escolha exatamente 3 (marcados: ${ids.length}).`);
      A.setTabbar(ids);
      toast('Atalhos salvos.');
    },
  });
}

// ---------- Segurança ----------

function security() {
  if (bioCache == null) Promise.all([biometricAvailable(), biometricEnabled()]).then(([avail, on]) => { bioCache = { avail, on }; store.setUI({}); });
  const kind = store.lockKind;
  const weak = store.pinEnabled && kind === 'pin';
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('lock-keyhole')} Bloqueio do app</h2>
        <div class="setting">
          <div>
            <strong>${store.pinEnabled ? (kind === 'password' ? 'Senha ativa' : 'PIN ativo') : 'Sem bloqueio'}</strong>
            <p class="muted small">${store.pinEnabled
              ? html`<span class="badge badge--good">Criptografado</span> Os dados (e as cópias da nuvem e anexos) ficam cifrados (AES-256, ${PIN_KDF.iterations.toLocaleString('pt-BR')} iterações) e o app abre pedindo o ${kind === 'password' ? 'senha' : 'PIN'}.`
              : 'Proteja o app com um PIN (só números) ou uma senha (letras e números). Os dados passam a ser salvos criptografados.'}</p>
          </div>
          <div class="setting__actions">
            ${store.pinEnabled ? html`
              <button type="button" class="btn btn--ghost btn--sm" data-action="pin:set" data-kind="${kind}">Trocar</button>
              <button type="button" class="btn btn--ghost btn--sm danger" data-action="pin:remove">Desativar</button>`
            : html`
              <button type="button" class="btn btn--primary btn--sm" data-action="pin:set" data-kind="password">${icon('key-round', 'icon--xs')} Criar senha</button>
              <button type="button" class="btn btn--ghost btn--sm" data-action="pin:set" data-kind="pin">Criar PIN</button>`}
          </div>
        </div>
        ${weak ? html`<div class="note note--warn">${icon('triangle-alert')}<span><strong>PIN é prático, mas fraco contra quem copiar o banco do navegador:</strong> um PIN de 4 a 6 números pode ser descoberto em minutos testando todas as combinações. Uma <strong>senha com letras e números</strong> é muito mais forte. <button type="button" class="link" data-action="pin:set" data-kind="password">Trocar por senha</button></span></div>` : ''}
        ${store.pinEnabled ? html`
          <div class="setting">
            <div><strong>Digital ou Face ID</strong><p class="muted small">${bioCache?.avail === false ? 'Este aparelho/navegador não oferece biometria para sites.' : 'Atalho para abrir sem digitar. A chave fica guardada protegida pela biometria do aparelho (WebAuthn com PRF).'}</p></div>
            ${bioCache?.avail ? html`<button type="button" class="btn ${bioCache.on ? 'btn--ghost' : 'btn--secondary'} btn--sm" data-action="bio:toggle">${icon('fingerprint', 'icon--xs')} ${bioCache.on ? 'Desligar' : 'Ligar'}</button>` : ''}
          </div>
          <div class="setting setting--stack">
            <strong>Bloquear automaticamente</strong>
            <div class="segmented" role="group" aria-label="Bloquear automaticamente">
              ${[[0, 'Na hora'], [1, '1 min'], [5, '5 min'], [30, '30 min'], [-1, 'Nunca']].map(([m, l]) => html`
                <button type="button" class="segmented__btn" data-action="pin:auto" data-min="${m}" aria-pressed="${autoLockMinutes() === m}">${l}</button>`)}
            </div>
            <p class="muted small">Depois de sair do app por esse tempo.</p>
          </div>
          <div class="setting setting--stack">
            <strong>Tentativas erradas</strong>
            <p class="muted small">A partir da 3ª tentativa errada, o app espera cada vez mais (30 s, 1 min, 2 min…). Você também pode apagar os dados DESTE aparelho depois de várias tentativas (a nuvem e os backups não são afetados).</p>
            <div class="segmented" role="group" aria-label="Apagar dados após tentativas">
              ${[[0, 'Nunca apagar'], [10, 'Após 10'], [20, 'Após 20']].map(([n, l]) => html`
                <button type="button" class="segmented__btn" data-action="pin:wipe" data-n="${n}" aria-pressed="${wipeAfter() === n}">${l}</button>`)}
            </div>
          </div>` : ''}
      </section>
      <section class="card">
        <h2 class="card__title">${icon('eye-off')} Modo discreto</h2>
        <div class="setting">
          <div><strong>Esconder os valores</strong><p class="muted small">Útil em público: os valores ficam borrados até você tocar neles. Atalho: ícone de olho no topo ou tecla D. Vale só neste aparelho.</p></div>
          <button type="button" class="btn ${isDiscreet() ? 'btn--primary' : 'btn--ghost'} btn--sm" data-action="discreet:set" aria-pressed="${isDiscreet()}">${icon(isDiscreet() ? 'eye-off' : 'eye', 'icon--xs')} ${isDiscreet() ? 'Ligado' : 'Desligado'}</button>
        </div>
      </section>
      <section class="card">
        <h2 class="card__title">${icon('shield-check')} Proteções do site</h2>
        <ul class="tips">
          <li>Política de segurança de conteúdo (CSP): o app só carrega arquivos dele mesmo e só conversa com o Supabase (nuvem) e, quando você pede, com as APIs públicas do Banco Central e da brapi.</li>
          <li>Nenhum anúncio, rastreador ou biblioteca de terceiros.</li>
          <li>Backups podem ser criptografados com senha (Dados → Baixar backup).</li>
        </ul>
      </section>
    </div>`;
}

function pinDialog(kind = 'pin') {
  if (!globalThis.crypto?.subtle) {
    toast('Criptografia indisponível: abra o app por https (ou instalado) para usar PIN.', { type: 'error' });
    return;
  }
  if (kind === 'password') {
    openDialog({
      title: store.pinEnabled ? 'Trocar a senha' : 'Criar senha',
      size: 'sm',
      submitLabel: 'Salvar senha',
      body: html`
        <p class="dialog__text muted">Use letras e números (8 ou mais). É bem mais forte que um PIN se alguém copiar os dados do navegador.</p>
        <div class="form-grid">
          ${field({ label: 'Senha', name: 'pass', type: 'password', required: true, full: true, extra: { autocomplete: 'new-password', minlength: 8 } })}
          ${field({ label: 'Repita a senha', name: 'pass2', type: 'password', required: true, full: true, extra: { autocomplete: 'new-password' } })}
          <p class="field__hint field--full" data-strength aria-live="polite"></p>
        </div>
        <p class="field__hint"><strong>Não há como recuperar uma senha esquecida</strong>: mantenha um backup ou a nuvem ligada.</p>`,
      onMount: (dlg) => dlg.querySelector('[name="pass"]').addEventListener('input', (ev) => {
        const s = passwordStrength(ev.target.value);
        dlg.querySelector('[data-strength]').textContent = ev.target.value ? `Força: ${s.label} (~${s.bits} bits)` : '';
      }),
      onSubmit: async (form) => {
        const p = form.pass.value;
        if (p.length < 8 || !/[a-zA-Z]/.test(p) || !/\d/.test(p)) throw new A.ValidationError('Use pelo menos 8 caracteres, com letras e números.', 'pass');
        if (p !== form.pass2.value) throw new A.ValidationError('As senhas não conferem.', 'pass2');
        await store.setPin(p, 'password');
        bioCache = null;
        toast('Senha salva. Os dados agora estão criptografados.');
        store.setUI({});
      },
    });
    return;
  }
  // Dois passos no teclado da tela (sem o teclado do celular): digitar e repetir
  let first = null;
  let pad;
  let dlg;
  const STEP = {
    1: { text: html`<strong>Passo 1 de 2</strong> · Digite um PIN de 4 a 8 números (prefira 6 ou mais).`, button: 'Continuar' },
    2: { text: html`<strong>Passo 2 de 2</strong> · Digite o mesmo PIN de novo para confirmar.`, button: 'Salvar PIN' },
  };
  const goTo = (n) => {
    dlg.querySelector('[data-pin-step]').innerHTML = STEP[n].text.toString();
    dlg.querySelector('[type="submit"]').textContent = STEP[n].button;
    pad.clear();
    pad.focus();
  };
  openDialog({
    title: store.pinEnabled ? 'Trocar PIN' : 'Criar PIN',
    size: 'sm',
    submitLabel: STEP[1].button,
    body: html`
      <p class="dialog__text" data-pin-step aria-live="polite">${STEP[1].text}</p>
      ${pinPad({ ok: false })}
      <p class="field__hint pin-dialog__hint"><strong>Não há como recuperar um PIN esquecido</strong>: guarde um backup atualizado. Para mais segurança, use uma senha.</p>`,
    onMount: (d) => {
      dlg = d;
      d.classList.add('pin-dialog');
      pad = bindPinPad(d, { keyTarget: d, onEnter: () => d.querySelector('form').requestSubmit() });
      setTimeout(() => pad.focus());
    },
    onSubmit: async () => {
      const pin = pad.value;
      if (pin.length < 4) { pad.error('O PIN deve ter de 4 a 8 números.'); return true; }
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) { pad.error('PIN fácil demais (repetido ou em sequência).'); return true; }
      if (first == null) { first = pin; goTo(2); return true; }
      if (pin !== first) {
        first = null;
        goTo(1);
        pad.error('Os PINs não conferem. Comece de novo.');
        return true;
      }
      await store.setPin(pin, 'pin');
      pad.destroy();
      bioCache = null;
      toast('PIN salvo. Os dados agora estão criptografados.');
      store.setUI({});
      return undefined;
    },
  });
}

// ---------- Lembretes ----------

function reminders() {
  const r = store.data.settings.reminders || {};
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('bell-ring')} Lembretes de vencimento</h2>
        <div class="setting">
          <div><strong>Avisos ao abrir o app</strong><p class="muted small">${r.enabled ? 'Ligados.' : 'Desligados'}</p></div>
          <button type="button" class="btn ${r.enabled ? 'btn--ghost' : 'btn--secondary'} btn--sm" data-action="agenda:notify">${r.enabled ? 'Desligar' : 'Ligar'}</button>
        </div>
        <div class="setting setting--stack">
          <strong>Como avisar</strong>
          <div class="segmented" role="group" aria-label="Modo dos lembretes">
            ${[['daily', 'Um resumo por dia'], ['weekly', 'Resumo aos domingos'], ['each', 'Uma por conta']].map(([m, l]) => html`
              <button type="button" class="segmented__btn" data-action="rem:mode" data-mode="${m}" aria-pressed="${(r.mode || 'daily') === m}">${l}</button>`)}
          </div>
          <p class="muted small">O resumo evita várias notificações seguidas.</p>
        </div>
        <div class="setting setting--stack">
          <strong>Avisar com antecedência</strong>
          <div class="segmented" role="group" aria-label="Antecedência dos lembretes">
            ${[[0, 'No dia'], [1, '1 dia'], [3, '3 dias'], [7, '7 dias']].map(([n, l]) => html`
              <button type="button" class="segmented__btn" data-action="rem:days" data-days="${n}" aria-pressed="${(r.daysBefore ?? 1) === n}">${l}</button>`)}
          </div>
        </div>
        <div class="setting">
          <div><strong>Com o app fechado (push)</strong><p class="muted small">Chega "Você tem 2 contas amanhã" mesmo com o app fechado. O servidor recebe só QUANTAS contas vencem por dia — nunca valores ou nomes. Requer a nuvem e a função de lembretes publicada (docs/NUVEM.md).</p></div>
          <button type="button" class="btn ${r.push ? 'btn--ghost' : 'btn--secondary'} btn--sm" data-action="rem:push" ${cloud.linked ? '' : 'disabled'}>${r.push ? 'Desligar' : 'Ligar'}</button>
        </div>
        <div class="setting">
          <div><strong>Calendário do celular</strong><p class="muted small">Exporte os vencimentos com alarme para Google Agenda, iPhone ou Outlook.</p></div>
          <a class="btn btn--ghost btn--sm" href="#/agenda">${icon('calendar-days', 'icon--xs')} Abrir agenda</a>
        </div>
      </section>
    </div>`;
}

// ---------- Regras ----------

function rules() {
  const d = store.data;
  const s = d.settings;
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('wand-sparkles')} Regras de categorização</h2>
        <p class="muted small">Quando a descrição contém o texto, a categoria é escolhida sozinha na importação de extratos, no lançamento rápido e nas compras. O app também pergunta "Sempre colocar UBER em Transporte?" quando você troca a categoria de um gasto.</p>
        ${(s.rules || []).length ? html`
          <ul class="mini-list">
            ${s.rules.map((rule) => {
              const cat = d.categories.find((c) => c.id === rule.categoryId);
              return html`
                <li>
                  <span class="rule"><code>${rule.pattern}</code> ${icon('arrow-right', 'icon--xs')} ${cat ? catText(cat) : 'categoria removida'}</span>
                  <span class="mini-list__actions"><button type="button" class="icon-btn icon-btn--sm danger" data-action="rule:delete" data-id="${rule.id}" aria-label="Remover regra ${rule.pattern}">${icon('trash-2')}</button></span>
                </li>`;
            })}
          </ul>` : html`<p class="muted small">Nenhuma regra ainda.</p>`}
        <div class="card__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="rule:new">${icon('plus', 'icon--xs')} Nova regra</button>
          <a class="btn btn--ghost btn--sm" href="#/importar">${icon('file-up', 'icon--xs')} Importar extrato</a>
        </div>
      </section>
    </div>`;
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
      const n = A.learnRule({ pattern: form.pattern.value.trim(), categoryId: form.categoryId.value, subcategoryId: form.subcategoryId?.value || null });
      toast(`Regra criada${n ? ` e aplicada em ${plural(n, 'lançamento')} sem categoria` : ''}.`);
    },
  });
}

// ---------- Dados ----------

function data() {
  const d = store.data;
  if (!storageCache) storageInfo().then((info) => { storageCache = info; store.setUI({}); });
  if (store.ui.errors == null) errorLog().then((l) => store.setUI({ errors: l }));
  const st = storageCache;
  const errors = store.ui.errors || [];
  const last = d.lastBackupAt ? diffDays(todayISO(new Date(d.lastBackupAt)), todayISO()) : null;
  const of = openFinanceSettings();
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('database')} Seus dados</h2>
        <p class="muted small">Tudo é salvo <strong>primeiro neste aparelho</strong> (funciona offline). Com a nuvem ligada, uma cópia criptografada vai para a sua conta.</p>
        <div class="setting">
          <div><strong>Backup</strong><p class="muted small ${last != null && last > 30 ? 'state--warn' : ''}">${last == null ? 'Nenhum backup feito ainda' : `Último: ${formatDateBR(todayISO(new Date(d.lastBackupAt)))} (${last === 0 ? 'hoje' : `há ${last} dias`})`} · pode ser protegido com senha</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--primary btn--sm" data-action="backup:export">${icon('download', 'icon--xs')} Baixar backup</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="backup:import">${icon('upload', 'icon--xs')} Restaurar</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Planilhas, holerites e relatório</strong><p class="muted small">Contracheques, resumo mensal, investimentos, relatório do mês em PDF.</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="export:open" data-kind="summary">${icon('file-spreadsheet', 'icon--xs')} Baixar dados</button>
        </div>
        <div class="setting">
          <div><strong>Importar extrato ou fatura</strong><p class="muted small">OFX, CSV ou PDF da fatura do cartão. Liga as transações às contas já lançadas (conciliação).</p></div>
          <a class="btn btn--ghost btn--sm" href="#/importar">${icon('file-up', 'icon--xs')} Importar</a>
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

      <section class="card">
        <h2 class="card__title">${icon('landmark')} Open Finance (opcional)</h2>
        <p class="muted small">Puxa as transações direto do banco, pela Pluggy (regulada pelo Banco Central). <strong>Vai contra o princípio "nada sai do aparelho"</strong>: as transações passam pela Pluggy e por uma função no SEU Supabase. Fica desligado até você ligar.</p>
        <div class="setting">
          <div><strong>${of.enabled ? 'Ligado' : 'Desligado'}</strong><p class="muted small">${of.items.length ? `${of.items.length} conexão(ões)` : 'Nenhum banco conectado'}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="of:toggle">${of.enabled ? 'Configurar' : 'Ligar'}</button>
        </div>
        ${of.enabled ? html`
          <div class="card__actions">
            <button type="button" class="btn btn--secondary btn--sm" data-action="of:connect" ${cloud.linked ? '' : 'disabled'}>${icon('link', 'icon--xs')} Conectar banco</button>
            ${of.items.map((it) => html`<button type="button" class="btn btn--ghost btn--sm" data-action="of:import" data-item="${it.id}">${icon('download', 'icon--xs')} Importar ${it.name}</button>`)}
          </div>` : ''}
      </section>

      <section class="card">
        <h2 class="card__title">${icon('activity')} Registro de erros</h2>
        <div class="setting">
          <div><strong>${errors.length ? plural(errors.length, 'erro registrado', 'erros registrados') : 'Nenhum erro registrado'}</strong>
            <p class="muted small">Fica só neste aparelho, sem valores dos seus dados. Exporte e anexe numa issue para ajudar a corrigir.${errors.length ? ` Último: ${errors[errors.length - 1].message}` : ''}</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="err:export" ${errors.length ? '' : 'disabled'}>${icon('download', 'icon--xs')} Exportar</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="err:clear" ${errors.length ? '' : 'disabled'}>Limpar</button>
          </div>
        </div>
      </section>

      <section class="card card--danger">
        <h2 class="card__title">${icon('triangle-alert')} Zona de perigo</h2>
        <div class="setting">
          <div><strong>Apagar todos os dados</strong><p class="muted small">Remove tudo deste aparelho. Faça um backup antes.</p></div>
          <button type="button" class="btn btn--danger btn--sm" data-action="set:wipe">Apagar tudo</button>
        </div>
      </section>
    </div>`;
}

function openFinanceDialog() {
  const of = openFinanceSettings();
  openDialog({
    title: 'Open Finance',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <div class="note note--warn">${icon('triangle-alert')}<span>As transações do banco passam pela Pluggy e pela função <code>open-finance</code> no seu Supabase (veja docs/NUVEM.md). Nada é lançado sem a sua revisão.</span></div>
      <label class="check"><input type="checkbox" name="enabled" ${of.enabled ? 'checked' : ''}> Ligar o Open Finance neste aparelho</label>
      ${field({ label: 'ID da conexão (item) da Pluggy', name: 'item', placeholder: 'Aparece depois de conectar o banco', full: true })}
      ${field({ label: 'Nome para lembrar', name: 'name', placeholder: 'Ex.: Itaú', full: true })}
      ${of.items.length ? html`<p class="small muted">Conexões: ${of.items.map((i) => i.name).join(', ')}</p>` : ''}`,
    onSubmit: (form) => {
      const next = { ...of, enabled: form.enabled.checked };
      if (form.item.value.trim()) next.items = [...of.items.filter((i) => i.id !== form.item.value.trim()), { id: form.item.value.trim(), name: form.name.value.trim() || 'Banco' }];
      saveOpenFinance(next);
      store.setUI({});
      toast(next.enabled ? 'Open Finance ligado.' : 'Open Finance desligado.');
    },
  });
}

async function openFinanceImport(itemId) {
  try {
    const accounts = await listAccounts(itemId);
    if (!accounts.length) return toastError('Nenhuma conta encontrada nessa conexão.');
    const acc = accounts[0];
    const rows = await fetchTransactions(acc.id, addDaysISO(todayISO(), -60), todayISO());
    loadRows(rows, `Open Finance · ${acc.name}`, 'Open Finance');
  } catch (err) { toastError(err.message); }
}

// ---------- Ajuda, privacidade e novidades ----------

function help() {
  const q = (store.ui.filters.helpQ || '').toLowerCase();
  const entries = Object.entries(GLOSSARY).filter(([, g]) => !q || g.term.toLowerCase().includes(q) || g.text.toLowerCase().includes(q));
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('book-open')} Glossário</h2>
        <div class="search">${icon('search')}<label class="sr-only" for="help-q">Buscar no glossário</label><input id="help-q" class="input" type="search" placeholder="Buscar: DSR, competência, frase secreta…" value="${store.ui.filters.helpQ || ''}" data-filter="helpQ"></div>
        <dl class="glossary">${entries.map(([id, g]) => html`<div id="g-${id}"><dt>${g.term}</dt><dd>${g.text}</dd></div>`)}</dl>
      </section>
      <section class="card">
        <h2 class="card__title">${icon('keyboard')} Atalhos de teclado</h2>
        <ul class="mini-list">
          <li><span><kbd>Ctrl</kbd> + <kbd>K</kbd> ou <kbd>/</kbd></span><span>Buscar ou lançar</span></li>
          <li><span><kbd>N</kbd></span><span>Novo lançamento</span></li>
          <li><span><kbd>D</kbd></span><span>Modo discreto</span></li>
          <li><span><kbd>Ctrl</kbd> + <kbd>Z</kbd></span><span>Desfazer a última exclusão</span></li>
          <li><span><kbd>↑</kbd> <kbd>↓</kbd> nas listas</span><span>Andar entre as contas</span></li>
          <li><span><kbd>Enter</kbd> / <kbd>Espaço</kbd> / <kbd>M</kbd></span><span>Pagar… / pagar hoje / menu</span></li>
        </ul>
      </section>
      <section class="card">
        <h2 class="card__title">${icon('smartphone')} No celular</h2>
        <ul class="tips">
          <li>Deslize uma conta para a <strong>direita</strong> para pagar e para a <strong>esquerda</strong> para ver as opções.</li>
          <li>No topo da página, <strong>puxe para baixo</strong> para atualizar e sincronizar.</li>
          <li>Toque e segure o ícone do app para os atalhos "Novo gasto" e "Plantão".</li>
          <li>Use "Compartilhar" de outro app (foto de comprovante, PDF da fatura, extrato) e escolha o Dhenors.</li>
        </ul>
      </section>
    </div>`;
}

function privacy() {
  return html`
    <div class="settings">
      <section class="card prose">
        <h2 class="card__title">${icon('shield-check')} Política de privacidade (curta)</h2>
        <p><strong>O que o Dhenors guarda:</strong> só o que você digita (contas, salário, metas…), no <strong>seu aparelho</strong> (IndexedDB do navegador). Não há cadastro obrigatório, anúncios, rastreadores nem análise de uso.</p>
        <p><strong>Nuvem (opcional):</strong> se você ligar, os dados vão para a SUA conta do Supabase <strong>criptografados no aparelho</strong> com uma frase que só você sabe. O servidor guarda blocos ilegíveis, a lista de aparelhos conectados (nome e data) e o e-mail da conta.</p>
        <p><strong>Notificações push (opcional):</strong> o servidor recebe só quantas contas vencem por dia, sem valores nem nomes.</p>
        <p><strong>Serviços externos, só quando você usa:</strong> Banco Central (CDI, Selic, IPCA — nada é enviado), brapi (só os códigos dos ativos, ex.: PETR4), reconhecimento de voz do navegador (o áudio pode ser processado pelo fornecedor do navegador) e Open Finance pela Pluggy (desligado por padrão).</p>
        <p><strong>Anexos</strong> (fotos de comprovantes) ficam só no aparelho; com PIN, cifrados.</p>
        <p><strong>Seus direitos (LGPD):</strong> você pode exportar tudo (backup), apagar tudo (Dados → Apagar tudo) e apagar a conta da nuvem (Supabase → Authentication → Users).</p>
        <p class="muted small">Dúvidas: abra uma issue em github.com/HStark0/dhenors.</p>
      </section>
    </div>`;
}

function news() {
  return html`
    <div class="settings">
      ${CHANGELOG.map((c) => html`
        <section class="card">
          <h2 class="card__title">${icon('sparkles')} ${c.title} <span class="muted small">· ${formatDateBR(c.date)}${c.version === APP_VERSION ? ' · versão atual' : ''}</span></h2>
          ${c.groups.map((g) => html`<h3 class="dialog__subtitle">${g.title}</h3><ul class="tips">${g.items.map((t) => html`<li>${t}</li>`)}</ul>`)}
        </section>`)}
    </div>`;
}


