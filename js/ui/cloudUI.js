// =============================================================
// cloudUI.js — Telas da nuvem: configurar, entrar, frase secreta,
// status no topo e seção em Ajustes.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { field } from './forms.js';
import { store } from '../core/store.js';
import { cloud, CloudError } from '../core/cloud.js';
import { formatDateBR, todayISO } from '../core/dates.js';

const STATUS = {
  off: { icon: 'cloud-off', label: 'Nuvem desligada' },
  signedout: { icon: 'cloud-off', label: 'Entrar na nuvem' },
  locked: { icon: 'key-round', label: 'Falta a frase secreta' },
  idle: { icon: 'cloud', label: 'Sincronizado' },
  syncing: { icon: 'refresh-cw', label: 'Sincronizando…' },
  offline: { icon: 'cloud-off', label: 'Sem internet — salvo no aparelho' },
  error: { icon: 'cloud-alert', label: 'Erro na nuvem' },
};

const when = (ms) => {
  if (!ms) return 'nunca';
  const d = new Date(ms);
  const sameDay = todayISO(d) === todayISO();
  return `${sameDay ? 'hoje' : formatDateBR(todayISO(d))} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Botão de status no topo (some se a nuvem nunca foi configurada). */
export function cloudButton() {
  const st = cloud.state;
  if (st.status === 'off' && !cloud.configured) return '';
  const s = STATUS[st.status] || STATUS.idle;
  return html`
    <button type="button" class="icon-btn cloud-btn cloud-btn--${st.status}" data-action="cloud:open"
      aria-label="${s.label}" title="${s.label}${st.status === 'idle' && st.lastSync ? ` · ${when(st.lastSync)}` : ''}${st.error ? ` · ${st.error}` : ''}">
      ${icon(s.icon)}
    </button>`;
}

/** Abre o passo certo conforme a situação. */
export function openCloud() {
  if (!cloud.configured) return configDialog();
  const st = cloud.state.status;
  if (!cloud.user || st === 'signedout') return authDialog();
  if (!cloud.linked) return passphraseDialog();
  return statusDialog();
}

// ---------- 1. Configurar o Supabase ----------

export function configDialog() {
  const c = cloud.config;
  openDialog({
    title: 'Conectar à nuvem',
    submitLabel: 'Continuar',
    body: html`
      <p class="dialog__text muted">Use um projeto <strong>gratuito</strong> do Supabase. O passo a passo completo está no arquivo <code>docs/NUVEM.md</code>. Em resumo:</p>
      <ol class="steps">
        <li>Crie o projeto em <strong>supabase.com</strong>.</li>
        <li>No <em>SQL Editor</em>, rode o arquivo <code>supabase/schema.sql</code>.</li>
        <li>Em <em>Project Settings → API</em>, copie a URL e a chave <strong>anon/publishable</strong> e cole aqui.</li>
      </ol>
      <div class="form-grid">
        ${field({ label: 'URL do projeto', name: 'url', value: c.url, required: true, full: true, placeholder: 'https://abcdefgh.supabase.co', extra: { autocomplete: 'off', spellcheck: 'false', inputmode: 'url' } })}
        ${field({ label: 'Chave pública (anon / publishable)', name: 'anonKey', value: c.anonKey, required: true, full: true, placeholder: 'eyJhbGciOi… ou sb_publishable_…', extra: { autocomplete: 'off', spellcheck: 'false' } })}
      </div>
      <p class="field__hint">Essa chave é pública por natureza. Seus dados ficam protegidos pelo login e pela criptografia com a sua frase secreta.</p>`,
    onSubmit: (form) => {
      try { cloud.setConfig({ url: form.url.value, anonKey: form.anonKey.value }); } catch (err) { throw wrap(err, 'url'); }
      setTimeout(authDialog, 50);
    },
  });
}

// ---------- 2. Entrar / criar conta ----------

export function authDialog(mode = 'signin') {
  openDialog({
    title: mode === 'signin' ? 'Entrar na nuvem' : 'Criar conta na nuvem',
    submitLabel: mode === 'signin' ? 'Entrar' : 'Criar conta',
    size: 'sm',
    body: html`
      <p class="dialog__text muted">${mode === 'signin'
        ? 'Use a mesma conta em todos os aparelhos para ver os mesmos dados.'
        : 'A conta guarda os seus dados criptografados. Use um e-mail que você acessa.'}</p>
      <div class="form-grid">
        ${field({ label: 'E-mail', name: 'email', type: 'email', required: true, full: true, extra: { autocomplete: 'email', inputmode: 'email' } })}
        ${field({ label: 'Senha da conta', name: 'password', type: 'password', required: true, full: true, hint: mode === 'signup' ? 'Mínimo de 6 caracteres.' : '', extra: { autocomplete: mode === 'signin' ? 'current-password' : 'new-password', minlength: 6 } })}
      </div>
      <p class="dialog__switch">${mode === 'signin'
        ? html`Primeira vez? <button type="button" class="link" data-switch="signup">Criar conta</button>`
        : html`Já tem conta? <button type="button" class="link" data-switch="signin">Entrar</button>`}
        · <button type="button" class="link" data-config>Alterar servidor</button></p>`,
    onMount: (dlg) => {
      dlg.querySelector('[data-switch]').addEventListener('click', (ev) => { dlg.close(); setTimeout(() => authDialog(ev.target.dataset.switch), 50); });
      dlg.querySelector('[data-config]').addEventListener('click', () => { dlg.close(); setTimeout(configDialog, 50); });
    },
    onSubmit: async (form) => {
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new CloudFieldError('E-mail inválido.', 'email');
      try {
        if (mode === 'signup') {
          const r = await cloud.signUp(email, password);
          if (r.needsConfirm) {
            toast('Conta criada! Abra o e-mail de confirmação que o Supabase enviou e depois entre aqui.', { duration: 9000 });
            setTimeout(() => authDialog('signin'), 50);
            return undefined;
          }
        } else {
          await cloud.signIn(email, password);
        }
      } catch (err) { throw wrap(err, 'password'); }
      setTimeout(passphraseDialog, 50);
      return undefined;
    },
  });
}

// ---------- 3. Frase secreta ----------

export async function passphraseDialog() {
  let info;
  try { info = await cloud.remoteInfo(); } catch (err) { toast(err.message, { type: 'error' }); return; }
  const creating = !info.exists;
  openDialog({
    title: creating ? 'Crie a sua frase secreta' : 'Digite a sua frase secreta',
    submitLabel: creating ? 'Criar e enviar' : 'Desbloquear',
    size: 'sm',
    body: html`
      ${creating
        ? html`<p class="dialog__text">Os dados são <strong>criptografados no aparelho</strong> com esta frase antes de ir para a nuvem. Nem o Supabase consegue lê-los.</p>
          <div class="note note--warn">${icon('triangle-alert')}<span><strong>Anote em lugar seguro.</strong> Sem a frase, os dados da nuvem não podem ser recuperados por ninguém. Você vai digitá-la uma vez em cada aparelho novo.</span></div>`
        : html`<p class="dialog__text">Esta conta já tem dados na nuvem${info.device ? ` (último envio: ${info.device}, ${formatDateBR(String(info.updatedAt).slice(0, 10))})` : ''}. Digite a frase que você criou no primeiro aparelho.</p>`}
      <div class="form-grid">
        ${field({ label: 'Frase secreta', name: 'pass', type: 'password', required: true, full: true, hint: creating ? 'Pelo menos 8 caracteres. Ex.: uma frase curta que só você sabe.' : '', extra: { autocomplete: 'off', minlength: 8 } })}
        ${creating ? field({ label: 'Repita a frase', name: 'pass2', type: 'password', required: true, full: true, extra: { autocomplete: 'off' } }) : ''}
      </div>`,
    onSubmit: async (form) => {
      const pass = form.pass.value;
      if (creating && pass !== form.pass2.value) throw new CloudFieldError('As frases não conferem.', 'pass2');
      let result;
      try { result = await cloud.unlock(pass); } catch (err) { throw wrap(err, 'pass'); }
      if (!result.remote) {
        await cloud.link('local', null, null);
        toast('Pronto! Seus dados agora ficam salvos na nuvem, criptografados.');
        return undefined;
      }
      if (isEmpty(store.data)) {
        await cloud.link('cloud', result.remote, result.version);
        toast('Dados da nuvem carregados neste aparelho.');
        return undefined;
      }
      setTimeout(() => chooseDialog(result), 50);
      return undefined;
    },
  });
}

/** Este aparelho já tem dados e a nuvem também: qual fica? */
function chooseDialog({ remote, version }) {
  const count = (d) => d.expenses.length + d.recurring.length + d.installments.length + d.goals.length + d.extraIncomes.length;
  openDialog({
    title: 'Quais dados manter?',
    size: 'sm',
    body: html`
      <p class="dialog__text">Este aparelho e a nuvem têm dados diferentes.</p>
      <div class="choice">
        <button type="button" class="choice__opt" data-pick="cloud">
          ${icon('cloud-download')}<span><strong>Usar os dados da nuvem</strong>
          <small>${count(remote)} lançamentos · alterados em ${formatDateBR(String(remote.updatedAt || '').slice(0, 10)) || '—'}. Os deste aparelho são substituídos.</small></span>
        </button>
        <button type="button" class="choice__opt" data-pick="local">
          ${icon('cloud-upload')}<span><strong>Enviar os dados deste aparelho</strong>
          <small>${count(store.data)} lançamentos. Substituem o que está na nuvem.</small></span>
        </button>
      </div>
      <p class="field__hint">Dica: na dúvida, baixe um backup antes (Ajustes → Baixar backup).</p>`,
    onMount: (dlg) => {
      dlg.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
        dlg.close();
        await cloud.link(b.dataset.pick, remote, version);
        toast(b.dataset.pick === 'cloud' ? 'Dados da nuvem carregados.' : 'Dados deste aparelho enviados para a nuvem.');
      }));
    },
  });
}

// ---------- 4. Status ----------

async function statusDialog() {
  const st = cloud.state;
  const conflict = await cloud.conflictBackup();
  openDialog({
    title: 'Nuvem',
    size: 'sm',
    body: html`
      <div class="cloud-status cloud-status--${st.status}">
        ${icon((STATUS[st.status] || STATUS.idle).icon)}
        <div><strong>${(STATUS[st.status] || STATUS.idle).label}</strong>
          <small>${cloud.user?.email || ''} · última sincronização: ${when(st.lastSync)}</small>
          ${st.error ? html`<small class="neg">${st.error}</small>` : ''}</div>
      </div>
      <p class="field__hint">Tudo é salvo primeiro neste aparelho e enviado à nuvem em seguida. Sem internet, o app continua funcionando e envia depois.</p>
      ${conflict ? html`
        <div class="note">${icon('info')}<span>Há uma cópia guardada de ${when(conflict.at)} (versão de ${conflict.origin}) de quando dois aparelhos mudaram ao mesmo tempo.
          <button type="button" class="link" data-restore>Restaurar essa cópia</button> · <button type="button" class="link" data-discard>Descartar</button></span></div>` : ''}
      <div class="card__actions">
        <button type="button" class="btn btn--primary btn--sm" data-sync>${icon('refresh-cw', 'icon--xs')} Sincronizar agora</button>
        <button type="button" class="btn btn--ghost btn--sm danger" data-logout>${icon('log-out', 'icon--xs')} Sair da conta</button>
      </div>`,
    onMount: (dlg) => {
      dlg.querySelector('[data-sync]').addEventListener('click', async () => { await cloud.syncNow(); dlg.close(); toast(cloud.state.status === 'idle' ? 'Sincronizado.' : cloud.state.error || 'Não foi possível agora.'); });
      dlg.querySelector('[data-logout]').addEventListener('click', async () => {
        dlg.close();
        const ok = await confirmDialog({ title: 'Sair da nuvem', message: 'Os dados continuam neste aparelho, mas deixam de sincronizar. Para voltar, entre de novo e digite a frase secreta.', confirmLabel: 'Sair' });
        if (ok) { await cloud.signOut(); toast('Você saiu da nuvem.'); }
      });
      dlg.querySelector('[data-restore]')?.addEventListener('click', async () => {
        dlg.close();
        const ok = await confirmDialog({ title: 'Restaurar cópia', message: 'Os dados atuais serão substituídos pela cópia guardada (em todos os aparelhos).', confirmLabel: 'Restaurar' });
        if (ok) { await store.replace(conflict.data); await cloud.clearConflict(); toast('Cópia restaurada.'); }
      });
      dlg.querySelector('[data-discard]')?.addEventListener('click', async () => { await cloud.clearConflict(); dlg.close(); toast('Cópia descartada.'); });
    },
  });
}

// ---------- Ajustes ----------

export function cloudSettingsSection() {
  const st = cloud.state;
  const s = STATUS[st.status] || STATUS.idle;
  return html`
    <section class="card" id="nuvem">
      <h2 class="card__title">${icon('cloud')} Nuvem</h2>
      ${cloud.linked ? html`
        <div class="setting">
          <div><strong>${s.label}</strong><p class="muted small">${cloud.user?.email} · última sincronização: ${when(st.lastSync)}${st.error ? ` · ${st.error}` : ''}</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--secondary btn--sm" data-action="cloud:sync">${icon('refresh-cw', 'icon--xs')} Sincronizar</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:open">Detalhes</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Criptografia</strong><p class="muted small">Ativa: os dados vão para a nuvem cifrados com a sua frase secreta (AES-256).</p></div>
          <span class="badge badge--good">${icon('lock-keyhole', 'icon--xs')} Protegido</span>
        </div>`
      : html`
        <div class="setting">
          <div><strong>Acesse de qualquer lugar</strong><p class="muted small">Salve os dados na nuvem (Supabase, gratuito), criptografados com uma frase que só você sabe, e abra o Dhenors no celular, no trabalho ou em casa com os mesmos dados.</p></div>
          <button type="button" class="btn btn--primary btn--sm" data-action="cloud:open">${icon('cloud-upload', 'icon--xs')} ${!cloud.configured ? 'Conectar' : !cloud.user ? 'Entrar' : 'Concluir'}</button>
        </div>`}
    </section>`;
}

// ---------- utilidades ----------

class CloudFieldError extends Error {
  constructor(message, field) { super(message); this.field = field; this.name = 'ValidationError'; }
}
const wrap = (err, fieldName) => (err instanceof CloudError ? new CloudFieldError(err.message, fieldName) : err);
const isEmpty = (d) => !(d.expenses.length || d.recurring.length || d.installments.length || d.goals.length || d.extraIncomes.length || d.settings.salaryHistory.length > 1);
