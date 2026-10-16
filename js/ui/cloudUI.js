// =============================================================
// cloudUI.js — Telas da nuvem: configurar, entrar, frase secreta,
// status no topo e seção em Ajustes.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { field, selectField } from './forms.js';
import { store } from '../core/store.js';
import { cloud, CloudError } from '../core/cloud.js';
import { formatDateBR, todayISO } from '../core/dates.js';
import { formatBRL } from '../core/money.js';

// Cada estado tem ícone E texto curto (nunca só um ícone riscado).
const STATUS = {
  off: { icon: 'cloud-off', label: 'Nuvem desligada', short: 'Nuvem desligada' },
  signedout: { icon: 'log-in', label: 'Nuvem: sem login (toque para entrar)', short: 'Sem login' },
  locked: { icon: 'key-round', label: 'Nuvem: falta a frase secreta', short: 'Falta a frase' },
  idle: { icon: 'cloud', label: 'Sincronizado', short: 'Sincronizado' },
  pending: { icon: 'cloud-upload', label: 'Alterações esperando envio', short: 'Enviando…' },
  syncing: { icon: 'refresh-cw', label: 'Sincronizando…', short: 'Sincronizando…' },
  offline: { icon: 'wifi-off', label: 'Sem internet — salvo no aparelho', short: 'Offline' },
  paused: { icon: 'cloud-alert', label: 'Projeto do Supabase pausado', short: 'Nuvem pausada' },
  error: { icon: 'cloud-alert', label: 'Erro na nuvem', short: 'Erro na nuvem' },
};

const when = (ms) => {
  if (!ms) return 'nunca';
  const d = new Date(ms);
  const sameDay = todayISO(d) === todayISO();
  return `${sameDay ? 'hoje' : formatDateBR(todayISO(d))} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** "agora", "há 2 min", "há 3 h", "ontem", "há 4 dias" */
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return 'nunca';
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`;
  const days = Math.round(s / 86_400);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}

/** Texto do status com detalhes: "Sincronizado há 2 min", "3 alterações pendentes". */
export function statusText(st = cloud.state) {
  if (st.status === 'idle') return `Sincronizado ${timeAgo(st.lastSync)}${st.live ? ' · ao vivo' : ''}`;
  if ((st.status === 'pending' || st.status === 'offline' || st.status === 'error') && st.pending) {
    return `${st.pending} ${st.pending === 1 ? 'alteração pendente' : 'alterações pendentes'}${st.status === 'offline' ? ' (sem internet)' : ''}`;
  }
  return (STATUS[st.status] || STATUS.idle).label;
}

/** Botão de status no topo, com texto (some se a nuvem nunca foi configurada). */
export function cloudButton({ compact = false } = {}) {
  const st = cloud.state;
  if (st.status === 'off' && !cloud.configured) return '';
  const s = STATUS[st.status] || STATUS.idle;
  const text = statusText(st);
  return html`
    <button type="button" class="cloud-btn cloud-btn--${st.status} ${compact ? 'cloud-btn--compact' : ''}" data-action="cloud:open"
      aria-label="Nuvem: ${text}${st.error ? `. ${st.error}` : ''}" title="${text}${st.error ? ` · ${st.error}` : ''}">
      ${icon(s.icon)}<span class="cloud-btn__text">${st.status === 'idle' ? `Sincronizado ${timeAgo(st.lastSync)}` : st.pending && st.status !== 'syncing' ? `${st.pending} pendente${st.pending > 1 ? 's' : ''}` : s.short}</span>
      ${st.conflicts ? html`<span class="cloud-btn__badge" title="Conflitos para resolver">${st.conflicts}</span>` : ''}
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

/** Aviso de pausa do projeto gratuito (Painel e Ajustes). */
export function pauseBanner() {
  const r = cloud.pauseRisk();
  if (!r || (!r.warn && !r.paused)) return '';
  return html`
    <div class="banner banner--warn" role="note">
      ${icon('cloud-alert')}
      <p>${r.paused
        ? html`O projeto gratuito do Supabase <strong>pausou</strong> por falta de uso. Abra <strong>supabase.com</strong> → seu projeto → <strong>Restore project</strong>. Seus dados continuam lá; enquanto isso, tudo fica salvo neste aparelho.`
        : html`A nuvem não é usada há <strong>${r.days} dias</strong>. O Supabase gratuito <strong>pausa projetos após 7 dias sem uso</strong>${r.left ? ` (faltam ${r.left})` : ''}. Sincronize agora para evitar.`}</p>
      ${r.paused ? '' : html`<button type="button" class="btn btn--secondary btn--sm" data-action="cloud:sync">${icon('refresh-cw', 'icon--xs')} Sincronizar</button>`}
    </div>`;
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
        ${field({ label: 'Senha da conta', name: 'password', type: 'password', required: true, full: true,
          hint: mode === 'signup' ? 'Mínimo de 6 caracteres.' : html`<button type="button" class="link" data-forgot>Esqueci minha senha</button>`,
          extra: { autocomplete: mode === 'signin' ? 'current-password' : 'new-password', minlength: 6 } })}
      </div>
      <p class="dialog__switch">${mode === 'signin'
        ? html`Primeira vez? <button type="button" class="link" data-switch="signup">Criar conta</button>`
        : html`Já tem conta? <button type="button" class="link" data-switch="signin">Entrar</button>`}
        · <button type="button" class="link" data-config>Alterar servidor</button></p>`,
    onMount: (dlg) => {
      dlg.querySelector('[data-switch]').addEventListener('click', (ev) => { dlg.close(); setTimeout(() => authDialog(ev.target.dataset.switch), 50); });
      dlg.querySelector('[data-config]').addEventListener('click', () => { dlg.close(); setTimeout(configDialog, 50); });
      dlg.querySelector('[data-forgot]')?.addEventListener('click', () => {
        const email = dlg.querySelector('[name="email"]').value.trim();
        dlg.close();
        setTimeout(() => forgotDialog(email), 50);
      });
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

// ---------- 2b. Esqueci minha senha ----------

/** Pede o e-mail e manda o link de nova senha. */
export function forgotDialog(email = '') {
  openDialog({
    title: 'Recuperar a senha',
    submitLabel: 'Enviar link',
    size: 'sm',
    body: html`
      <p class="dialog__text muted">Enviaremos um link para o seu e-mail. Ao abrir o link, o Dhenors pede uma senha nova para a conta.</p>
      ${field({ label: 'E-mail da conta', name: 'email', type: 'email', value: email, required: true, extra: { autocomplete: 'email', inputmode: 'email' } })}
      <div class="note">${icon('key-round')}<span>Isso troca só a <strong>senha da conta</strong>. A <strong>frase secreta</strong> continua a mesma e não pode ser recuperada por e-mail.</span></div>`,
    onSubmit: async (form) => {
      const value = form.email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(value)) throw new CloudFieldError('E-mail inválido.', 'email');
      try { await cloud.requestPasswordReset(value); } catch (err) { throw wrap(err, 'email'); }
      setTimeout(() => sentDialog(value), 50);
      return undefined;
    },
  });
}

function sentDialog(email) {
  openDialog({
    title: 'Confira o seu e-mail',
    size: 'sm',
    body: html`
      <div class="empty empty--sm">
        ${icon('circle-check', 'icon--lg pos')}
        <p>Se existir uma conta com <strong>${email}</strong>, o link para criar uma nova senha chega em alguns minutos.</p>
      </div>
      <ul class="steps">
        <li>Abra o e-mail <strong>neste aparelho</strong> (ou em qualquer um com o Dhenors).</li>
        <li>Não chegou? Veja a caixa de spam e as promoções.</li>
        <li>O link vale por pouco tempo (normalmente 1 hora) e só funciona uma vez.</li>
      </ul>`,
  });
}

/**
 * Tela aberta pelo link do e-mail: cria a nova senha.
 * recovery = { access_token, refresh_token, expires_in }
 */
export function newPasswordDialog(recovery) {
  openDialog({
    title: 'Criar uma nova senha',
    submitLabel: 'Salvar nova senha',
    size: 'sm',
    body: html`
      <p class="dialog__text muted">Escolha a nova senha da sua conta da nuvem.</p>
      <div class="form-grid">
        ${field({ label: 'Nova senha', name: 'password', type: 'password', required: true, full: true, hint: 'Mínimo de 6 caracteres.', extra: { autocomplete: 'new-password', minlength: 6 } })}
        ${field({ label: 'Repita a nova senha', name: 'password2', type: 'password', required: true, full: true, extra: { autocomplete: 'new-password', minlength: 6 } })}
      </div>
      <div class="note">${icon('key-round')}<span>Depois, o app pede a sua <strong>frase secreta</strong>: é a mesma de antes. Ela não muda com a senha.</span></div>`,
    onSubmit: async (form) => {
      const password = form.password.value;
      if (password.length < 6) throw new CloudFieldError('A senha precisa ter pelo menos 6 caracteres.', 'password');
      if (password !== form.password2.value) throw new CloudFieldError('As senhas não conferem.', 'password2');
      try { await cloud.completePasswordReset(recovery, password); } catch (err) { throw wrap(err, 'password'); }
      toast('Senha alterada! Você já está conectado à nuvem.', { type: 'success' });
      if (cloud.state.status === 'locked') setTimeout(passphraseDialog, 50);
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
        ${field({ label: 'Frase secreta', name: 'pass', type: 'password', required: true, full: true,
          hint: creating ? 'Pelo menos 8 caracteres. Ex.: uma frase curta que só você sabe.'
            : 'Esqueceu? A frase não pode ser recuperada, nem pelo e-mail: "Esqueci minha senha" troca só a senha da conta. Os dados deste aparelho e dos seus backups continuam a salvo.',
          extra: { autocomplete: 'off', minlength: 8 } })}
        ${creating ? field({ label: 'Repita a frase', name: 'pass2', type: 'password', required: true, full: true, extra: { autocomplete: 'off' } }) : ''}
        ${selectField({ label: 'Lembrar a frase neste aparelho', name: 'remember', value: cloud.remember, options: REMEMBER_OPTIONS })}
      </div>
      <p class="field__hint">Com PIN ligado, a frase lembrada fica cifrada pelo PIN. "Só enquanto o app estiver aberto" pede a frase toda vez que você abrir o app.</p>`,
    onSubmit: async (form) => {
      const pass = form.pass.value;
      if (creating && pass !== form.pass2.value) throw new CloudFieldError('As frases não conferem.', 'pass2');
      let result;
      try { result = await cloud.unlock(pass, { remember: form.remember.value }); } catch (err) { throw wrap(err, 'pass'); }
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

const REMEMBER_OPTIONS = [
  { value: 'always', label: 'Sempre (até eu sair da conta)' },
  { value: '30d', label: 'Por 30 dias' },
  { value: 'session', label: 'Só enquanto o app estiver aberto' },
];

async function statusDialog() {
  const st = cloud.state;
  const [conflict, conflicts] = await Promise.all([cloud.conflictBackup(), cloud.conflicts()]);
  const risk = cloud.pauseRisk();
  openDialog({
    title: 'Nuvem',
    body: html`
      <div class="cloud-status cloud-status--${st.status}">
        ${icon((STATUS[st.status] || STATUS.idle).icon)}
        <div><strong>${statusText(st)}</strong>
          <small>${cloud.user?.email || ''} · última sincronização: ${when(st.lastSync)}${st.live ? ' · tempo real ligado' : ' · consulta a cada minuto'}</small>
          ${st.error ? html`<small class="neg">${st.error}</small>` : ''}</div>
      </div>
      ${risk?.warn || risk?.paused ? pauseBanner() : ''}
      ${conflicts.length ? html`
        <div class="note note--warn">${icon('triangle-alert')}<span><strong>${conflicts.length === 1 ? '1 item foi alterado' : `${conflicts.length} itens foram alterados`} em dois aparelhos ao mesmo tempo.</strong> Ficou a versão da nuvem; escolha qual manter.
          <button type="button" class="link" data-conflicts>Resolver agora</button></span></div>` : ''}
      ${conflict ? html`
        <div class="note">${icon('info')}<span>Há uma cópia completa guardada de ${when(conflict.at)} (versão de ${conflict.origin}).
          <button type="button" class="link" data-restore>Restaurar essa cópia</button> · <button type="button" class="link" data-discard>Descartar</button></span></div>` : ''}
      <ul class="sheet-list">
        <li><button type="button" class="sheet-item" data-versions>${icon('history')}<span>Histórico de versões<small>Volte os dados para como estavam (últimas 30 versões)</small></span></button></li>
        <li><button type="button" class="sheet-item" data-devices>${icon('monitor-smartphone')}<span>Aparelhos conectados<small>Veja quem acessa e desconecte à distância</small></span></button></li>
        <li><button type="button" class="sheet-item" data-pass>${icon('key-round')}<span>Trocar a frase secreta<small>Recriptografa tudo com a frase nova</small></span></button></li>
        <li><button type="button" class="sheet-item" data-remember>${icon('smartphone')}<span>Lembrar a frase neste aparelho<small>${REMEMBER_OPTIONS.find((o) => o.value === cloud.remember)?.label}</small></span></button></li>
      </ul>
      <p class="field__hint">Tudo é salvo primeiro neste aparelho e enviado à nuvem em seguida, criptografado. Só as partes que mudaram são enviadas. Sem internet, o app continua funcionando e envia depois.</p>
      <div class="card__actions">
        <button type="button" class="btn btn--primary btn--sm" data-sync>${icon('refresh-cw', 'icon--xs')} Sincronizar agora</button>
        <button type="button" class="btn btn--ghost btn--sm danger" data-logout>${icon('log-out', 'icon--xs')} Sair da conta</button>
      </div>`,
    onMount: (dlg) => {
      const go = (fn) => () => { dlg.close(); setTimeout(fn, 50); };
      dlg.querySelector('[data-sync]').addEventListener('click', async () => { await cloud.syncNow(); dlg.close(); toast(cloud.state.status === 'idle' ? 'Sincronizado.' : cloud.state.error || 'Não foi possível agora.'); });
      dlg.querySelector('[data-conflicts]')?.addEventListener('click', go(conflictsDialog));
      dlg.querySelector('[data-versions]').addEventListener('click', go(versionsDialog));
      dlg.querySelector('[data-devices]').addEventListener('click', go(devicesDialog));
      dlg.querySelector('[data-pass]').addEventListener('click', go(changePassphraseDialog));
      dlg.querySelector('[data-remember]').addEventListener('click', go(rememberDialog));
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

// ---------- Conflitos: os dois lados, você escolhe ----------

const FIELD_LABELS = { cents: 'Valor', description: 'Descrição', dueDate: 'Vencimento', paidAt: 'Pago em', categoryId: 'Categoria', subcategoryId: 'Subcategoria', notes: 'Observação', dueDay: 'Dia', name: 'Nome', targetCents: 'Valor da meta', tags: 'Etiquetas', count: 'Parcelas', date: 'Data' };

function showValue(key, v) {
  if (v == null || v === '') return '—';
  if (/cents$/i.test(key) || key === 'cents') return formatBRL(v);
  if (/date|At$/.test(key) && typeof v === 'string') return formatDateBR(v.slice(0, 10));
  if (key === 'categoryId') return store.data.categories.find((c) => c.id === v)?.name || '—';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v);
}

function sideTable(c) {
  if (!c.local || !c.remote || typeof c.local !== 'object') {
    return html`<div class="conflict__sides"><div><h4>Este aparelho</h4><p>${c.local == null ? 'Apagado aqui' : showValue('', c.local)}</p></div><div><h4>Nuvem (${c.from})</h4><p>${c.remote == null ? 'Apagado lá' : showValue('', c.remote)}</p></div></div>`;
  }
  const keys = (c.fields?.length ? c.fields.map((f) => f.split('.')[0]) : Object.keys({ ...c.local, ...c.remote })).filter((k, i, a) => a.indexOf(k) === i && k !== 'id');
  return html`
    <table class="table table--compact conflict__table">
      <thead><tr><th scope="col">Campo</th><th scope="col">Este aparelho</th><th scope="col">Nuvem</th></tr></thead>
      <tbody>${keys.map((k) => html`<tr class="${JSON.stringify(c.local[k]) !== JSON.stringify(c.remote[k]) ? 'is-diff' : ''}"><th scope="row">${FIELD_LABELS[k] || k}</th><td>${showValue(k, c.local[k])}</td><td>${showValue(k, c.remote[k])}</td></tr>`)}</tbody>
    </table>`;
}

export async function conflictsDialog() {
  const render = async () => {
    const list = await cloud.conflicts();
    if (!list.length) return html`<div class="empty empty--sm">${icon('circle-check', 'icon--lg pos')}<p><strong>Nenhum conflito.</strong></p></div>`;
    return html`
      <p class="dialog__text muted">O mesmo item foi alterado neste aparelho e em outro antes de sincronizar. Por enquanto vale a versão da <strong>nuvem</strong>. Escolha o que fica:</p>
      <ul class="conflicts">
        ${list.map((c) => html`
          <li class="conflict">
            <p class="conflict__title"><strong>${c.label}</strong> <small class="muted">${when(c.at)}</small></p>
            ${sideTable(c)}
            <div class="card__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-keep="local" data-id="${c.id}">Manter a deste aparelho</button>
              <button type="button" class="btn btn--ghost btn--sm" data-keep="remote" data-id="${c.id}">Manter a da nuvem</button>
            </div>
          </li>`)}
      </ul>`;
  };
  const { dialog } = openDialog({ title: 'Conflitos de sincronização', size: 'lg', body: await render(),
    footer: html`<button type="button" class="btn btn--ghost" data-all-remote>Manter tudo como está (nuvem)</button>` });
  const body = dialog.querySelector('.dialog__body');
  dialog.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-keep]');
    if (btn) {
      await cloud.resolveConflict(btn.dataset.id, btn.dataset.keep);
      body.innerHTML = (await render()).toString();
      toast(btn.dataset.keep === 'local' ? 'Versão deste aparelho restaurada (vai para a nuvem).' : 'Mantida a versão da nuvem.');
    }
    if (ev.target.closest('[data-all-remote]')) { await cloud.clearConflicts(); dialog.close(); toast('Conflitos dispensados.'); }
  });
}

// ---------- Histórico de versões ----------

export async function versionsDialog() {
  let list;
  try { list = await cloud.listVersions(); } catch (err) { toast(err.message, { type: 'error' }); return; }
  const { dialog } = openDialog({
    title: 'Histórico de versões',
    body: list.length ? html`
      <p class="dialog__text muted">Cada sincronização guarda uma versão (as últimas 30). Restaurar volta TODOS os dados para aquele momento — e vira uma versão nova, então dá para desfazer.</p>
      <ul class="mini-list">
        ${list.map((v, i) => html`
          <li>
            <span><strong>${when(Date.parse(v.created_at))}</strong> <small class="muted">${v.device || 'aparelho'}${i === 0 ? ' · atual' : ''}</small></span>
            <span class="mini-list__actions">${i === 0 ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-restore="${v.version}">${icon('rotate-ccw', 'icon--xs')} Restaurar</button>`}</span>
          </li>`)}
      </ul>` : html`<p class="muted">Ainda não há versões guardadas. Elas aparecem a partir da próxima sincronização.</p>`,
  });
  dialog.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-restore]');
    if (!btn) return;
    const ok = await confirmDialog({ title: 'Restaurar versão', message: 'Os dados atuais (em todos os aparelhos) voltam para como estavam nessa versão. A versão atual continua no histórico.', confirmLabel: 'Restaurar', danger: true });
    if (!ok) return;
    try { await cloud.restoreVersion(Number(btn.dataset.restore)); dialog.close(); toast('Versão restaurada.'); } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

// ---------- Aparelhos conectados ----------

export async function devicesDialog() {
  const render = async () => {
    let list = [];
    try { list = await cloud.listDevices(); } catch (err) { return html`<p class="neg">${err.message}</p>`; }
    return html`
      <ul class="mini-list">
        ${list.map((d) => html`
          <li class="${d.revoked ? 'is-muted' : ''}">
            <span>${icon(/Android|iPhone/.test(d.name || '') ? 'smartphone' : 'laptop', 'icon--xs')} <strong>${d.name || 'Aparelho'}</strong>${d.current ? html` <span class="badge badge--good">este</span>` : ''}${d.revoked ? html` <span class="badge badge--muted">desconectado</span>` : ''}
              <small class="muted">visto ${timeAgo(Date.parse(d.last_seen))} · v${d.app_version || '?'}</small></span>
            <span class="mini-list__actions">
              ${d.current ? html`<button type="button" class="btn btn--ghost btn--sm" data-rename>Renomear</button>`
                : d.revoked ? html`<button type="button" class="icon-btn icon-btn--sm" data-forget="${d.device_id}" aria-label="Remover da lista">${icon('trash-2')}</button>`
                : html`<button type="button" class="btn btn--ghost btn--sm danger" data-revoke="${d.device_id}">Desconectar</button>`}
            </span>
          </li>`)}
      </ul>
      <p class="field__hint">Desconectar: na próxima vez que aquele aparelho abrir o app, ele sai da nuvem (os dados dele continuam lá, mas param de sincronizar).</p>`;
  };
  const { dialog } = openDialog({ title: 'Aparelhos conectados', body: await render(),
    footer: html`<button type="button" class="btn btn--ghost danger" data-others>Encerrar a sessão de todos os outros</button>` });
  const body = dialog.querySelector('.dialog__body');
  dialog.addEventListener('click', async (ev) => {
    const t = ev.target;
    try {
      if (t.closest('[data-revoke]')) { await cloud.revokeDevice(t.closest('[data-revoke]').dataset.revoke); toast('Aparelho será desconectado.'); }
      else if (t.closest('[data-forget]')) await cloud.forgetDevice(t.closest('[data-forget]').dataset.forget);
      else if (t.closest('[data-rename]')) {
        const name = prompt('Nome deste aparelho', cloud.deviceName);
        if (name) cloud.setDeviceName(name);
        await new Promise((r) => setTimeout(r, 600));
      } else if (t.closest('[data-others]')) {
        const ok = await confirmDialog({ title: 'Encerrar outras sessões', message: 'Todos os outros aparelhos precisarão entrar de novo com e-mail e senha.', confirmLabel: 'Encerrar', danger: true });
        if (ok) { await cloud.signOutOthers(); toast('Sessões dos outros aparelhos encerradas.'); }
      } else return;
      body.innerHTML = (await render()).toString();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

// ---------- Trocar a frase secreta ----------

export function changePassphraseDialog() {
  openDialog({
    title: 'Trocar a frase secreta',
    size: 'sm',
    submitLabel: 'Trocar e recriptografar',
    body: html`
      <p class="dialog__text muted">Todos os dados da nuvem são criptografados de novo com a frase nova. Nos outros aparelhos, o app vai pedir a frase nova.</p>
      <div class="form-grid">
        ${field({ label: 'Frase atual', name: 'current', type: 'password', required: true, full: true, extra: { autocomplete: 'off' } })}
        ${field({ label: 'Frase nova', name: 'next', type: 'password', required: true, full: true, hint: 'Pelo menos 8 caracteres.', extra: { autocomplete: 'off', minlength: 8 } })}
        ${field({ label: 'Repita a frase nova', name: 'next2', type: 'password', required: true, full: true, extra: { autocomplete: 'off' } })}
      </div>
      <div class="note note--warn">${icon('triangle-alert')}<span>Anote a frase nova: ela também não pode ser recuperada.</span></div>`,
    onSubmit: async (form) => {
      if (form.next.value !== form.next2.value) throw new CloudFieldError('As frases não conferem.', 'next2');
      try { await cloud.changePassphrase(form.current.value, form.next.value); } catch (err) { throw wrap(err, 'current'); }
      toast('Frase secreta trocada. Os dados foram recriptografados.');
    },
  });
}

function rememberDialog() {
  openDialog({
    title: 'Lembrar a frase neste aparelho',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      ${selectField({ label: 'Por quanto tempo', name: 'remember', value: cloud.remember, options: REMEMBER_OPTIONS })}
      <p class="field__hint">Num aparelho compartilhado, escolha "Só enquanto o app estiver aberto". Com PIN ligado, a frase lembrada fica cifrada pelo PIN.</p>`,
    onSubmit: async (form) => { await cloud.setRemember(form.remember.value); toast('Preferência salva.'); },
  });
}

// ---------- Ajustes ----------

export function cloudSettingsSection() {
  const st = cloud.state;
  return html`
    <section class="card" id="nuvem">
      <h2 class="card__title">${icon('cloud')} Nuvem</h2>
      ${pauseBanner()}
      ${cloud.linked ? html`
        <div class="setting">
          <div><strong>${statusText(st)}</strong><p class="muted small">${cloud.user?.email} · última sincronização: ${when(st.lastSync)}${st.error ? ` · ${st.error}` : ''}</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--secondary btn--sm" data-action="cloud:sync">${icon('refresh-cw', 'icon--xs')} Sincronizar</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:open">Detalhes</button>
          </div>
        </div>
        ${st.conflicts ? html`
          <div class="setting">
            <div><strong>Conflitos para resolver</strong><p class="muted small">${st.conflicts} item(ns) alterado(s) em dois aparelhos.</p></div>
            <button type="button" class="btn btn--secondary btn--sm" data-action="cloud:conflicts">Resolver</button>
          </div>` : ''}
        <div class="setting">
          <div><strong>Versões e aparelhos</strong><p class="muted small">Restaure uma versão anterior ou desconecte um aparelho à distância.</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:versions">${icon('history', 'icon--xs')} Versões</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:devices">${icon('monitor-smartphone', 'icon--xs')} Aparelhos</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Criptografia</strong><p class="muted small">Ativa: os dados vão para a nuvem cifrados com a sua frase secreta (AES-256).</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:passphrase">${icon('key-round', 'icon--xs')} Trocar frase</button>
        </div>`
      : html`
        <div class="setting">
          <div><strong>Acesse de qualquer lugar</strong><p class="muted small">Salve os dados na nuvem (Supabase, gratuito), criptografados com uma frase que só você sabe, e abra o Dhenors no celular, no trabalho ou em casa com os mesmos dados.</p></div>
          <button type="button" class="btn btn--primary btn--sm" data-action="cloud:open">${icon('cloud-upload', 'icon--xs')} ${!cloud.configured ? 'Conectar' : !cloud.user ? 'Entrar' : 'Concluir'}</button>
        </div>`}
    </section>`;
}

/** Ações da nuvem para o despachante central. */
export const cloudActions = {
  'cloud:conflicts': () => conflictsDialog(),
  'cloud:versions': () => versionsDialog(),
  'cloud:devices': () => devicesDialog(),
  'cloud:passphrase': () => changePassphraseDialog(),
};

// ---------- utilidades ----------

class CloudFieldError extends Error {
  constructor(message, field) { super(message); this.field = field; this.name = 'ValidationError'; }
}
const wrap = (err, fieldName) => (err instanceof CloudError ? new CloudFieldError(err.message, fieldName) : err);
const isEmpty = (d) => !(d.expenses.length || d.recurring.length || d.installments.length || d.goals.length || d.extraIncomes.length || d.settings.salaryHistory.length > 1);
